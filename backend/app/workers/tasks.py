import uuid
from typing import Any

from app.db.session import SessionFactory
from app.jobs.service import execute_job as execute_job_service
from app.webhooks.service import deliver_webhook as deliver_webhook_service


async def deliver_webhook(ctx: dict[str, Any], delivery_id: str) -> None:
    async with SessionFactory() as session:
        await deliver_webhook_service(session, ctx["redis"], uuid.UUID(delivery_id))


async def execute_job(ctx: dict[str, Any], job_id: str) -> None:
    async with SessionFactory() as session:
        await execute_job_service(session, ctx["redis"], uuid.UUID(job_id))
