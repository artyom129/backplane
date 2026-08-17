import asyncio
import uuid
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from redis.asyncio.client import PubSub
from sqlalchemy import func, select
from starlette.responses import StreamingResponse

from app.api.dependencies import OrganizationDep, SessionDep
from app.audit.models import ActivityEvent, AuditEvent
from app.audit.schemas import ActivityEventResponse, AuditEventResponse
from app.auth.models import User
from app.core.pagination import Page, PageParams, pagination_params
from app.core.redis import redis_client
from app.projects.models import Project

router = APIRouter(tags=["Audit & Activity"])


@router.get("/audit", response_model=Page[AuditEventResponse])
async def list_audit_events(
    context: OrganizationDep,
    session: SessionDep,
    params: Annotated[PageParams, Depends(pagination_params)],
    action: Annotated[str | None, Query()] = None,
    actor_id: Annotated[uuid.UUID | None, Query()] = None,
    project_id: Annotated[uuid.UUID | None, Query()] = None,
) -> Page[AuditEventResponse]:
    filters = [AuditEvent.organization_id == context.organization.id]
    if action:
        filters.append(AuditEvent.action.ilike(f"%{action}%"))
    if actor_id:
        filters.append(AuditEvent.actor_id == actor_id)
    if project_id:
        filters.append(AuditEvent.project_id == project_id)
    total = await session.scalar(select(func.count()).select_from(AuditEvent).where(*filters))
    rows = (
        await session.execute(
            select(AuditEvent, User.full_name, Project.name)
            .outerjoin(User, User.id == AuditEvent.actor_id)
            .outerjoin(Project, Project.id == AuditEvent.project_id)
            .where(*filters)
            .order_by(AuditEvent.created_at.desc())
            .offset(params.offset)
            .limit(params.page_size)
        )
    ).all()
    items = [
        AuditEventResponse(
            id=event.id,
            actor_id=event.actor_id,
            actor_name=actor_name,
            organization_id=event.organization_id,
            project_id=event.project_id,
            project_name=project_name,
            action=event.action,
            resource_type=event.resource_type,
            resource_id=event.resource_id,
            metadata=event.metadata_,
            created_at=event.created_at,
        )
        for event, actor_name, project_name in rows
    ]
    return Page[AuditEventResponse].from_items(items, total or 0, params)


@router.get("/activity", response_model=list[ActivityEventResponse])
async def list_activity(
    context: OrganizationDep,
    session: SessionDep,
    project_id: Annotated[uuid.UUID | None, Query()] = None,
) -> list[ActivityEvent]:
    filters = [ActivityEvent.organization_id == context.organization.id]
    if project_id:
        filters.append(ActivityEvent.project_id == project_id)
    return list(
        await session.scalars(
            select(ActivityEvent)
            .where(*filters)
            .order_by(ActivityEvent.created_at.desc())
            .limit(50)
        )
    )


async def activity_stream(
    request: Request,
    pubsub: PubSub,
    project_id: uuid.UUID | None,
) -> AsyncIterator[str]:
    try:
        yield "event: connected\ndata: {}\n\n"
        while not await request.is_disconnected():
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=15)
            if message and message["type"] == "message":
                data = message["data"]
                if isinstance(data, bytes):
                    data = data.decode()
                if project_id and f'"project_id": "{project_id}"' not in data:
                    continue
                yield f"event: activity\ndata: {data}\n\n"
            else:
                yield ": heartbeat\n\n"
            await asyncio.sleep(0.1)
    finally:
        await pubsub.unsubscribe()
        await pubsub.aclose()


@router.get("/activity/stream")
async def stream_activity(
    request: Request,
    context: OrganizationDep,
    project_id: Annotated[uuid.UUID | None, Query()] = None,
) -> StreamingResponse:
    pubsub = redis_client().pubsub()
    await pubsub.subscribe(f"activity:{context.organization.id}")
    return StreamingResponse(
        activity_stream(request, pubsub, project_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
