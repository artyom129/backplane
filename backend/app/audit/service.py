import json
import uuid
from datetime import UTC, datetime

import structlog
from redis.exceptions import RedisError
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.models import ActivityEvent, AuditEvent
from app.core.redis import redis_client

logger = structlog.get_logger()


async def record_action(
    session: AsyncSession,
    *,
    actor_id: uuid.UUID | None,
    organization_id: uuid.UUID,
    project_id: uuid.UUID | None,
    action: str,
    resource_type: str,
    resource_id: str,
    metadata: dict[str, object] | None = None,
) -> AuditEvent:
    event = AuditEvent(
        actor_id=actor_id,
        organization_id=organization_id,
        project_id=project_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        metadata_=metadata or {},
        created_at=datetime.now(UTC),
    )
    session.add(event)
    return event


async def publish_activity(
    session: AsyncSession,
    *,
    organization_id: uuid.UUID,
    project_id: uuid.UUID | None,
    kind: str,
    title: str,
    detail: str | None = None,
    status: str = "info",
    resource_id: str | None = None,
) -> ActivityEvent:
    event = ActivityEvent(
        organization_id=organization_id,
        project_id=project_id,
        kind=kind,
        title=title,
        detail=detail,
        status=status,
        resource_id=resource_id,
        created_at=datetime.now(UTC),
    )
    session.add(event)
    await session.flush()

    payload = {
        "id": str(event.id),
        "kind": event.kind,
        "title": event.title,
        "detail": event.detail,
        "status": event.status,
        "resource_id": event.resource_id,
        "project_id": str(event.project_id) if event.project_id else None,
        "created_at": event.created_at.isoformat(),
    }
    try:
        await redis_client().publish(
            f"activity:{organization_id}",
            json.dumps(payload),
        )
    except RedisError as exc:
        logger.warning("activity_publish_failed", error=str(exc))
    return event
