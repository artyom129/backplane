import uuid
from datetime import UTC, datetime
from urllib.parse import urljoin

import httpx
from arq import ArqRedis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import publish_activity
from app.core.errors import AppError
from app.core.network import validate_outbound_url
from app.endpoints.models import Endpoint
from app.incidents.models import (
    Incident,
    IncidentSeverity,
    IncidentStatus,
    IncidentTimelineEvent,
)
from app.jobs.models import Job, JobStatus
from app.projects.models import Project
from app.requests.service import endpoint_auth_headers
from app.webhooks.models import WebhookEvent
from app.webhooks.service import enqueue_event_deliveries

RETRY_DELAYS = [60, 300, 900]


async def validate_job_payload(
    session: AsyncSession,
    *,
    job_type: str,
    payload: dict[str, object],
    project_id: uuid.UUID,
    environment_id: uuid.UUID,
) -> None:
    if job_type == "endpoint.check":
        try:
            endpoint_id = uuid.UUID(str(payload["endpoint_id"]))
        except (KeyError, ValueError) as exc:
            raise AppError("invalid_job_payload", "endpoint_id is required.") from exc
        exists = await session.scalar(
            select(Endpoint.id).where(
                Endpoint.id == endpoint_id,
                Endpoint.project_id == project_id,
                Endpoint.environment_id == environment_id,
            )
        )
        if not exists:
            raise AppError("invalid_job_payload", "The selected endpoint was not found.")
    elif job_type == "webhook.replay":
        try:
            event_id = uuid.UUID(str(payload["event_id"]))
        except (KeyError, ValueError) as exc:
            raise AppError("invalid_job_payload", "event_id is required.") from exc
        exists = await session.scalar(
            select(WebhookEvent.id).where(
                WebhookEvent.id == event_id,
                WebhookEvent.project_id == project_id,
            )
        )
        if not exists:
            raise AppError("invalid_job_payload", "The selected webhook event was not found.")
    else:
        raise AppError("unsupported_job_type", "This job type is not supported.")


async def _run_endpoint_check(session: AsyncSession, job: Job) -> dict[str, object]:
    endpoint_id = uuid.UUID(str(job.payload["endpoint_id"]))
    endpoint = await session.get(Endpoint, endpoint_id)
    if not endpoint:
        raise RuntimeError("Endpoint no longer exists")
    url = urljoin(f"{endpoint.base_url}/", endpoint.path.lstrip("/"))
    validate_outbound_url(url)
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(endpoint.timeout_seconds),
        follow_redirects=False,
    ) as client:
        response = await client.request(
            endpoint.method.value,
            url,
            headers={**endpoint.headers, **endpoint_auth_headers(endpoint)},
        )
    if response.status_code >= 500:
        raise RuntimeError(f"Endpoint returned HTTP {response.status_code}")
    return {"status_code": response.status_code, "url": url}


async def _run_webhook_replay(
    session: AsyncSession,
    queue: ArqRedis,
    job: Job,
) -> dict[str, object]:
    event = await session.get(WebhookEvent, uuid.UUID(str(job.payload["event_id"])))
    if not event:
        raise RuntimeError("Webhook event no longer exists")
    count = await enqueue_event_deliveries(session, queue, event)
    return {"deliveries_enqueued": count}


async def create_job_incident(
    session: AsyncSession,
    job: Job,
) -> None:
    existing = await session.scalar(
        select(Incident.id).where(
            Incident.project_id == job.project_id,
            Incident.source == "job",
            Incident.source_id == str(job.id),
            Incident.status != IncidentStatus.RESOLVED,
        )
    )
    if existing:
        return
    incident = Incident(
        project_id=job.project_id,
        title=f"Background job {job.type} failed",
        severity=IncidentSeverity.MEDIUM,
        status=IncidentStatus.OPEN,
        source="job",
        source_id=str(job.id),
        description=job.error,
    )
    session.add(incident)
    await session.flush()
    session.add(
        IncidentTimelineEvent(
            incident_id=incident.id,
            kind="incident.created",
            message="Incident created after the job exhausted all retry attempts.",
            metadata_={"job_id": str(job.id)},
            created_at=datetime.now(UTC),
        )
    )


async def execute_job(
    session: AsyncSession,
    queue: ArqRedis,
    job_id: uuid.UUID,
) -> None:
    job = await session.scalar(select(Job).where(Job.id == job_id).with_for_update())
    if not job or job.status == JobStatus.COMPLETED:
        return
    job.status = JobStatus.RUNNING
    job.started_at = datetime.now(UTC)
    job.attempts += 1
    await session.commit()

    error: str | None = None
    try:
        if job.type == "endpoint.check":
            result = await _run_endpoint_check(session, job)
        elif job.type == "webhook.replay":
            result = await _run_webhook_replay(session, queue, job)
        else:
            raise RuntimeError(f"Unsupported job type: {job.type}")
        job.result = result
        job.status = JobStatus.COMPLETED
        job.finished_at = datetime.now(UTC)
    except (httpx.RequestError, AppError, RuntimeError, ValueError) as exc:
        error = str(exc)
        job.error = error
        if job.attempts < job.max_attempts:
            job.status = JobStatus.RETRYING
            delay = RETRY_DELAYS[min(job.attempts - 1, len(RETRY_DELAYS) - 1)]
            await queue.enqueue_job("execute_job", str(job.id), _defer_by=delay)
        else:
            job.status = JobStatus.FAILED
            job.finished_at = datetime.now(UTC)
            await create_job_incident(session, job)

    project = await session.get(Project, job.project_id)
    if project:
        await publish_activity(
            session,
            organization_id=project.organization_id,
            project_id=project.id,
            kind=f"job.{job.status.value}",
            title=f"{job.type} job {job.status.value}",
            detail=error,
            status="error" if job.status == JobStatus.FAILED else "success",
            resource_id=str(job.id),
        )
    await session.commit()
