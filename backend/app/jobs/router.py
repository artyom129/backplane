import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from arq import ArqRedis
from croniter import croniter
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select

from app.api.dependencies import (
    CurrentEnvironment,
    CurrentProject,
    CurrentUser,
    DeveloperOrganization,
    SessionDep,
)
from app.audit.service import record_action
from app.core.errors import NotFoundError
from app.core.pagination import Page, PageParams, pagination_params
from app.core.redis import arq_pool
from app.jobs.models import Job, JobStatus, ScheduledJob
from app.jobs.schemas import (
    JobCreate,
    JobDetail,
    JobListItem,
    ScheduledJobCreate,
    ScheduledJobResponse,
    ScheduledJobUpdate,
)
from app.jobs.service import validate_job_payload

router = APIRouter(tags=["Jobs"])


async def _queue() -> AsyncIterator[ArqRedis]:
    queue = await arq_pool()
    try:
        yield queue
    finally:
        await queue.aclose()


type QueueDep = Annotated[ArqRedis, Depends(_queue)]


def next_run(cron_expression: str, timezone: str) -> datetime:
    now = datetime.now(ZoneInfo(timezone))
    return croniter(cron_expression, now).get_next(datetime).astimezone(UTC)


@router.get("/jobs", response_model=Page[JobListItem])
async def list_jobs(
    project: CurrentProject,
    session: SessionDep,
    params: Annotated[PageParams, Depends(pagination_params)],
    job_status: Annotated[JobStatus | None, Query(alias="status")] = None,
) -> Page[JobListItem]:
    filters = [Job.project_id == project.id]
    if job_status:
        filters.append(Job.status == job_status)
    total = await session.scalar(select(func.count()).select_from(Job).where(*filters))
    jobs = list(
        await session.scalars(
            select(Job)
            .where(*filters)
            .order_by(Job.created_at.desc())
            .offset(params.offset)
            .limit(params.page_size)
        )
    )
    return Page[JobListItem].from_items(
        [JobListItem.model_validate(job) for job in jobs],
        total or 0,
        params,
    )


@router.post("/jobs", response_model=JobDetail, status_code=status.HTTP_202_ACCEPTED)
async def create_job(
    payload: JobCreate,
    environment: CurrentEnvironment,
    project: CurrentProject,
    context: DeveloperOrganization,
    user: CurrentUser,
    session: SessionDep,
    queue: QueueDep,
) -> Job:
    await validate_job_payload(
        session,
        job_type=payload.type,
        payload=payload.payload,
        project_id=project.id,
        environment_id=environment.id,
    )
    job = Job(
        project_id=project.id,
        environment_id=environment.id,
        type=payload.type,
        status=JobStatus.QUEUED,
        payload=payload.payload,
        created_at=datetime.now(UTC),
        max_attempts=payload.max_attempts,
    )
    session.add(job)
    await session.flush()
    await queue.enqueue_job("execute_job", str(job.id))
    await record_action(
        session,
        actor_id=user.id,
        organization_id=context.organization.id,
        project_id=project.id,
        action="job.created",
        resource_type="job",
        resource_id=str(job.id),
        metadata={"type": job.type},
    )
    await session.commit()
    return job


@router.get("/jobs/{job_id}", response_model=JobDetail)
async def get_job(
    job_id: uuid.UUID,
    project: CurrentProject,
    session: SessionDep,
) -> Job:
    job = await session.scalar(select(Job).where(Job.id == job_id, Job.project_id == project.id))
    if not job:
        raise NotFoundError("job_not_found", "Job was not found.")
    return job


@router.post("/jobs/{job_id}/retry", response_model=JobDetail)
async def retry_job(
    job_id: uuid.UUID,
    project: CurrentProject,
    _: DeveloperOrganization,
    session: SessionDep,
    queue: QueueDep,
) -> Job:
    job = await session.scalar(select(Job).where(Job.id == job_id, Job.project_id == project.id))
    if not job:
        raise NotFoundError("job_not_found", "Job was not found.")
    job.status = JobStatus.QUEUED
    job.attempts = 0
    job.error = None
    job.finished_at = None
    await queue.enqueue_job("execute_job", str(job.id))
    await session.commit()
    return job


@router.get("/scheduled-jobs", response_model=list[ScheduledJobResponse])
async def list_scheduled_jobs(
    project: CurrentProject,
    session: SessionDep,
) -> list[ScheduledJob]:
    return list(
        await session.scalars(
            select(ScheduledJob)
            .where(ScheduledJob.project_id == project.id)
            .order_by(ScheduledJob.name)
        )
    )


@router.post(
    "/scheduled-jobs",
    response_model=ScheduledJobResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_scheduled_job(
    payload: ScheduledJobCreate,
    environment: CurrentEnvironment,
    project: CurrentProject,
    context: DeveloperOrganization,
    user: CurrentUser,
    session: SessionDep,
) -> ScheduledJob:
    job_type = str(payload.action.get("type", ""))
    action_payload = payload.action.get("payload", {})
    if not isinstance(action_payload, dict):
        action_payload = {}
    await validate_job_payload(
        session,
        job_type=job_type,
        payload=action_payload,
        project_id=project.id,
        environment_id=environment.id,
    )
    scheduled = ScheduledJob(
        project_id=project.id,
        environment_id=environment.id,
        name=payload.name.strip(),
        cron_expression=payload.cron_expression,
        timezone=payload.timezone,
        action=payload.action,
        enabled=payload.enabled,
        next_run_at=next_run(payload.cron_expression, payload.timezone),
    )
    session.add(scheduled)
    await session.flush()
    await record_action(
        session,
        actor_id=user.id,
        organization_id=context.organization.id,
        project_id=project.id,
        action="scheduled_job.created",
        resource_type="scheduled_job",
        resource_id=str(scheduled.id),
        metadata={"cron": scheduled.cron_expression},
    )
    await session.commit()
    return scheduled


@router.patch("/scheduled-jobs/{schedule_id}", response_model=ScheduledJobResponse)
async def update_scheduled_job(
    schedule_id: uuid.UUID,
    payload: ScheduledJobUpdate,
    project: CurrentProject,
    _: DeveloperOrganization,
    session: SessionDep,
) -> ScheduledJob:
    scheduled = await session.scalar(
        select(ScheduledJob).where(
            ScheduledJob.id == schedule_id,
            ScheduledJob.project_id == project.id,
        )
    )
    if not scheduled:
        raise NotFoundError("scheduled_job_not_found", "Scheduled job was not found.")
    for field in payload.model_fields_set:
        value = getattr(payload, field)
        if value is not None:
            setattr(scheduled, field, value)
    if {"cron_expression", "timezone"} & payload.model_fields_set:
        scheduled.next_run_at = next_run(scheduled.cron_expression, scheduled.timezone)
    await session.commit()
    return scheduled


@router.delete("/scheduled-jobs/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_scheduled_job(
    schedule_id: uuid.UUID,
    project: CurrentProject,
    _: DeveloperOrganization,
    session: SessionDep,
) -> None:
    scheduled = await session.scalar(
        select(ScheduledJob).where(
            ScheduledJob.id == schedule_id,
            ScheduledJob.project_id == project.id,
        )
    )
    if not scheduled:
        raise NotFoundError("scheduled_job_not_found", "Scheduled job was not found.")
    await session.delete(scheduled)
    await session.commit()
