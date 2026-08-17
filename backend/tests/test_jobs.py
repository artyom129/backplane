from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.endpoints.models import AuthenticationType, Endpoint, HTTPMethod
from app.incidents.models import Incident
from app.jobs.models import Job, JobStatus
from app.jobs.service import execute_job, validate_job_payload
from tests.conftest import FakeQueue, TenantData


async def test_job_retries_then_creates_incident(
    session: AsyncSession,
    tenant: TenantData,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    endpoint = Endpoint(
        project_id=tenant.project.id,
        environment_id=tenant.environment.id,
        name="Unhealthy API",
        base_url="https://api.example.com",
        method=HTTPMethod.GET,
        path="/health",
        headers={},
        authentication_type=AuthenticationType.NONE,
        timeout_seconds=5,
        tags=[],
    )
    session.add(endpoint)
    await session.flush()
    await validate_job_payload(
        session,
        job_type="endpoint.check",
        payload={"endpoint_id": str(endpoint.id)},
        project_id=tenant.project.id,
        environment_id=tenant.environment.id,
    )
    job = Job(
        project_id=tenant.project.id,
        environment_id=tenant.environment.id,
        type="endpoint.check",
        status=JobStatus.QUEUED,
        payload={"endpoint_id": str(endpoint.id)},
        created_at=datetime.now(UTC),
        max_attempts=2,
    )
    session.add(job)
    await session.commit()

    async def fail(*_: object) -> dict[str, object]:
        raise RuntimeError("upstream unavailable")

    monkeypatch.setattr("app.jobs.service._run_endpoint_check", fail)
    queue = FakeQueue()
    await execute_job(session, queue, job.id)
    await session.refresh(job)
    assert job.status == JobStatus.RETRYING
    assert queue.jobs[-1][2]["_defer_by"] == 60

    await execute_job(session, queue, job.id)
    await session.refresh(job)
    assert job.status == JobStatus.FAILED
    assert job.attempts == 2
    assert await session.scalar(select(Incident.id)) is not None
