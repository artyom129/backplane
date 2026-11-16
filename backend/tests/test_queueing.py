import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.errors import AppError
from app.jobs.models import Job, JobStatus, ScheduledJob
from app.jobs.router import retry_job
from app.jobs.service import execute_job
from app.webhooks.models import (
    SignatureStatus,
    WebhookDestination,
    WebhookEndpoint,
    WebhookEvent,
)
from app.workers import scheduler
from tests.conftest import FakeQueue, TenantData


class CommitAwareQueue(FakeQueue):
    """Records whether the producing session still held an open transaction."""

    def __init__(self, session: AsyncSession) -> None:
        super().__init__()
        self.session = session
        self.enqueued_inside_transaction: list[bool] = []
        self.closed = False

    async def enqueue_job(self, name: str, *args: object, **kwargs: object) -> None:
        self.enqueued_inside_transaction.append(self.session.in_transaction())
        await super().enqueue_job(name, *args, **kwargs)

    async def aclose(self) -> None:
        self.closed = True


def make_job(tenant: TenantData, **values: object) -> Job:
    defaults: dict[str, object] = {
        "project_id": tenant.project.id,
        "environment_id": tenant.environment.id,
        "type": "endpoint.check",
        "status": JobStatus.QUEUED,
        "payload": {"endpoint_id": str(uuid.uuid4())},
        "created_at": datetime.now(UTC),
        "max_attempts": 3,
    }
    defaults.update(values)
    return Job(**defaults)


async def test_retry_is_queued_only_after_the_job_row_is_committed(
    session: AsyncSession,
    tenant: TenantData,
) -> None:
    job = make_job(tenant)
    session.add(job)
    await session.commit()

    queue = CommitAwareQueue(session)
    await execute_job(session, queue, job.id)

    assert job.status == JobStatus.RETRYING
    assert [name for name, _, _ in queue.jobs] == ["execute_job"]
    assert queue.enqueued_inside_transaction == [False]


async def test_webhook_replay_job_publishes_deliveries_after_commit(
    session: AsyncSession,
    tenant: TenantData,
) -> None:
    endpoint = WebhookEndpoint(project_id=tenant.project.id, name="Source", public_id="src123")
    session.add(endpoint)
    await session.flush()
    event = WebhookEvent(
        project_id=tenant.project.id,
        endpoint_id=endpoint.id,
        method="POST",
        headers={},
        query_params={},
        payload={},
        raw_body="{}",
        source_ip="203.0.113.5",
        event_type="test",
        signature_status=SignatureStatus.NOT_CONFIGURED,
        size_bytes=2,
        received_at=datetime.now(UTC),
    )
    destination = WebhookDestination(
        project_id=tenant.project.id,
        environment_id=tenant.environment.id,
        webhook_endpoint_id=endpoint.id,
        name="Receiver",
        url="https://receiver.example.com/hook",
        method="POST",
        headers={},
        timeout_seconds=5,
    )
    session.add_all([event, destination])
    await session.flush()
    job = make_job(tenant, type="webhook.replay", payload={"event_id": str(event.id)})
    session.add(job)
    await session.commit()

    queue = CommitAwareQueue(session)
    await execute_job(session, queue, job.id)

    assert job.status == JobStatus.COMPLETED
    assert [name for name, _, _ in queue.jobs] == ["deliver_webhook"]
    assert queue.enqueued_inside_transaction == [False]


async def test_unexpected_error_does_not_leave_job_running(
    session: AsyncSession,
    tenant: TenantData,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    job = make_job(tenant, max_attempts=1)
    session.add(job)
    await session.commit()

    async def explode(*_: object) -> dict[str, object]:
        raise KeyError("status_code")

    monkeypatch.setattr("app.jobs.service._run_endpoint_check", explode)
    await execute_job(session, FakeQueue(), job.id)

    assert job.status == JobStatus.FAILED
    assert job.finished_at is not None
    assert job.error


@pytest.mark.parametrize("status", [JobStatus.RUNNING, JobStatus.RETRYING, JobStatus.COMPLETED])
async def test_only_failed_jobs_can_be_retried(
    session: AsyncSession,
    tenant: TenantData,
    status: JobStatus,
) -> None:
    job = make_job(tenant, status=status, attempts=1)
    session.add(job)
    await session.commit()
    queue = FakeQueue()

    with pytest.raises(AppError) as raised:
        await retry_job(job.id, tenant.project, None, session, queue)  # type: ignore[arg-type]

    assert raised.value.status_code == 409
    assert queue.jobs == []


async def test_failed_job_retry_is_queued_after_commit(
    session: AsyncSession,
    tenant: TenantData,
) -> None:
    job = make_job(tenant, status=JobStatus.FAILED, attempts=3, error="boom")
    session.add(job)
    await session.commit()
    queue = CommitAwareQueue(session)

    await retry_job(job.id, tenant.project, None, session, queue)  # type: ignore[arg-type]

    assert job.status == JobStatus.QUEUED
    assert job.attempts == 0
    assert queue.enqueued_inside_transaction == [False]


async def test_scheduler_queues_after_commit_and_closes_its_pool(
    session: AsyncSession,
    tenant: TenantData,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    schedule = ScheduledJob(
        project_id=tenant.project.id,
        environment_id=tenant.environment.id,
        name="Nightly check",
        cron_expression="0 3 * * *",
        timezone="UTC",
        action={"type": "endpoint.check", "payload": {"endpoint_id": str(uuid.uuid4())}},
        enabled=True,
        next_run_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    session.add(schedule)
    await session.commit()

    scheduler_session = async_sessionmaker(session.bind, expire_on_commit=False)()
    queue = CommitAwareQueue(scheduler_session)

    async def fake_pool() -> CommitAwareQueue:
        return queue

    monkeypatch.setattr(scheduler, "arq_pool", fake_pool)
    monkeypatch.setattr(scheduler, "SessionFactory", lambda: scheduler_session)

    assert await scheduler.dispatch_due_schedules() == 1

    assert [name for name, _, _ in queue.jobs] == ["execute_job"]
    assert queue.enqueued_inside_transaction == [False]
    assert queue.closed is True
    created = await session.scalar(select(Job).where(Job.type == "endpoint.check"))
    assert created is not None
