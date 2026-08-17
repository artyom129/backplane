import asyncio
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import structlog
from croniter import croniter
from sqlalchemy import select

from app.core.logging import configure_logging
from app.core.redis import arq_pool
from app.db.session import SessionFactory
from app.jobs.models import Job, JobStatus, ScheduledJob

logger = structlog.get_logger()


async def dispatch_due_schedules() -> int:
    now = datetime.now(UTC)
    queue = await arq_pool()
    async with SessionFactory() as session:
        schedules = list(
            await session.scalars(
                select(ScheduledJob)
                .where(
                    ScheduledJob.enabled.is_(True),
                    ScheduledJob.next_run_at <= now,
                )
                .with_for_update(skip_locked=True)
                .limit(100)
            )
        )
        for schedule in schedules:
            job_type = str(schedule.action.get("type", ""))
            payload = schedule.action.get("payload", {})
            if not isinstance(payload, dict):
                payload = {}
            payload = {**payload, "schedule_id": str(schedule.id)}
            job = Job(
                project_id=schedule.project_id,
                environment_id=schedule.environment_id,
                type=job_type,
                status=JobStatus.QUEUED,
                payload=payload,
                created_at=now,
                max_attempts=3,
            )
            session.add(job)
            await session.flush()
            schedule.last_run_at = now
            schedule.last_status = JobStatus.QUEUED
            localized = now.astimezone(ZoneInfo(schedule.timezone))
            schedule.next_run_at = (
                croniter(
                    schedule.cron_expression,
                    localized,
                )
                .get_next(datetime)
                .astimezone(UTC)
            )
            await queue.enqueue_job("execute_job", str(job.id))
        await session.commit()
        return len(schedules)


async def run_scheduler() -> None:
    configure_logging()
    logger.info("scheduler_started")
    while True:
        try:
            count = await dispatch_due_schedules()
            if count:
                logger.info("scheduled_jobs_dispatched", count=count)
        except Exception as exc:
            logger.exception("scheduler_iteration_failed", error_type=type(exc).__name__)
        await asyncio.sleep(15)


if __name__ == "__main__":
    asyncio.run(run_scheduler())
