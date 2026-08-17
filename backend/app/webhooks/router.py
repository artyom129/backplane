import json
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Annotated

from arq import ArqRedis
from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import func, select

from app.api.dependencies import (
    CurrentEnvironment,
    CurrentProject,
    CurrentUser,
    DeveloperOrganization,
    SessionDep,
)
from app.audit.service import publish_activity, record_action
from app.config import settings
from app.core.encryption import encrypt_value
from app.core.errors import AppError, NotFoundError
from app.core.network import validate_outbound_url
from app.core.pagination import Page, PageParams, pagination_params
from app.core.redis import arq_pool
from app.projects.models import Project
from app.webhooks.models import (
    DeliveryStatus,
    SignatureStatus,
    WebhookDelivery,
    WebhookDestination,
    WebhookEndpoint,
    WebhookEvent,
)
from app.webhooks.schemas import (
    DeliveryResponse,
    DestinationCreate,
    DestinationResponse,
    WebhookAccepted,
    WebhookEndpointCreate,
    WebhookEndpointResponse,
    WebhookEventDetail,
    WebhookEventListItem,
)
from app.webhooks.service import (
    enforce_rate_limit,
    enqueue_event_deliveries,
    infer_event_type,
    public_id,
    signature_status,
)

router = APIRouter(tags=["Webhooks"])


def endpoint_response(endpoint: WebhookEndpoint) -> WebhookEndpointResponse:
    return WebhookEndpointResponse(
        id=endpoint.id,
        project_id=endpoint.project_id,
        name=endpoint.name,
        public_id=endpoint.public_id,
        url=f"{settings.public_api_url}{settings.api_prefix}/hooks/{endpoint.public_id}",
        signature_header=endpoint.signature_header,
        has_signing_secret=endpoint.signing_secret_encrypted is not None,
        is_active=endpoint.is_active,
        created_at=endpoint.created_at,
    )


def destination_response(destination: WebhookDestination) -> DestinationResponse:
    return DestinationResponse(
        id=destination.id,
        webhook_endpoint_id=destination.webhook_endpoint_id,
        name=destination.name,
        url=destination.url,
        method=destination.method,
        headers=destination.headers,
        has_secret=destination.secret_encrypted is not None,
        timeout_seconds=destination.timeout_seconds,
        is_active=destination.is_active,
        created_at=destination.created_at,
    )


async def _queue() -> AsyncIterator[ArqRedis]:
    queue = await arq_pool()
    try:
        yield queue
    finally:
        await queue.aclose()


type QueueDep = Annotated[ArqRedis, Depends(_queue)]


@router.post(
    "/hooks/{public_id_value}",
    response_model=WebhookAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
async def receive_webhook(
    public_id_value: str,
    request: Request,
    session: SessionDep,
    queue: QueueDep,
) -> WebhookAccepted:
    endpoint = await session.scalar(
        select(WebhookEndpoint).where(
            WebhookEndpoint.public_id == public_id_value,
            WebhookEndpoint.is_active.is_(True),
        )
    )
    if not endpoint:
        raise NotFoundError("webhook_endpoint_not_found", "Webhook endpoint was not found.")

    source_ip = request.client.host if request.client else "unknown"
    if not await enforce_rate_limit(public_id_value, source_ip):
        raise AppError("rate_limit_exceeded", "Webhook rate limit exceeded.", 429)

    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > settings.max_webhook_bytes:
        raise AppError("payload_too_large", "Webhook payload is too large.", 413)
    body = await request.body()
    if len(body) > settings.max_webhook_bytes:
        raise AppError("payload_too_large", "Webhook payload is too large.", 413)

    headers = {key.lower(): value for key, value in request.headers.items()}
    raw_body = body.decode("utf-8", errors="replace")
    try:
        payload: object | None = json.loads(raw_body) if raw_body else None
    except json.JSONDecodeError:
        payload = None

    signature = headers.get(endpoint.signature_header.lower())
    verified = signature_status(endpoint, body, signature)
    event = WebhookEvent(
        project_id=endpoint.project_id,
        endpoint_id=endpoint.id,
        method=request.method,
        headers=headers,
        query_params=dict(request.query_params),
        payload=payload,
        raw_body=raw_body,
        source_ip=source_ip,
        event_type=infer_event_type(headers, payload),
        signature_status=verified,
        size_bytes=len(body),
        received_at=datetime.now(UTC),
    )
    session.add(event)
    await session.flush()
    project = await session.get(Project, endpoint.project_id)
    if project:
        await publish_activity(
            session,
            organization_id=project.organization_id,
            project_id=project.id,
            kind="webhook.received",
            title=f"{event.event_type} webhook received",
            detail=f"{endpoint.name} · {event.size_bytes} bytes",
            status="error" if verified == SignatureStatus.INVALID else "success",
            resource_id=str(event.id),
        )
    if verified != SignatureStatus.INVALID:
        await enqueue_event_deliveries(session, queue, event)
    await session.commit()
    return WebhookAccepted(event_id=event.id)


@router.get("/webhooks/endpoints", response_model=list[WebhookEndpointResponse])
async def list_webhook_endpoints(
    project: CurrentProject,
    session: SessionDep,
) -> list[WebhookEndpointResponse]:
    endpoints = await session.scalars(
        select(WebhookEndpoint)
        .where(WebhookEndpoint.project_id == project.id)
        .order_by(WebhookEndpoint.name)
    )
    return [endpoint_response(endpoint) for endpoint in endpoints]


@router.post(
    "/webhooks/endpoints",
    response_model=WebhookEndpointResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_webhook_endpoint(
    payload: WebhookEndpointCreate,
    project: CurrentProject,
    context: DeveloperOrganization,
    user: CurrentUser,
    session: SessionDep,
) -> WebhookEndpointResponse:
    endpoint = WebhookEndpoint(
        project_id=project.id,
        name=payload.name.strip(),
        public_id=public_id(),
        signing_secret_encrypted=(
            encrypt_value(payload.signing_secret) if payload.signing_secret else None
        ),
        signature_header=payload.signature_header,
    )
    session.add(endpoint)
    await session.flush()
    await record_action(
        session,
        actor_id=user.id,
        organization_id=context.organization.id,
        project_id=project.id,
        action="webhook_endpoint.created",
        resource_type="webhook_endpoint",
        resource_id=str(endpoint.id),
        metadata={"name": endpoint.name},
    )
    await session.commit()
    return endpoint_response(endpoint)


@router.delete("/webhooks/endpoints/{endpoint_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_webhook_endpoint(
    endpoint_id: uuid.UUID,
    project: CurrentProject,
    _: DeveloperOrganization,
    session: SessionDep,
) -> None:
    endpoint = await session.scalar(
        select(WebhookEndpoint).where(
            WebhookEndpoint.id == endpoint_id,
            WebhookEndpoint.project_id == project.id,
        )
    )
    if not endpoint:
        raise NotFoundError("webhook_endpoint_not_found", "Webhook endpoint was not found.")
    await session.delete(endpoint)
    await session.commit()


@router.get("/webhooks/destinations", response_model=list[DestinationResponse])
async def list_destinations(
    environment: CurrentEnvironment,
    session: SessionDep,
) -> list[DestinationResponse]:
    destinations = await session.scalars(
        select(WebhookDestination)
        .where(WebhookDestination.environment_id == environment.id)
        .order_by(WebhookDestination.name)
    )
    return [destination_response(destination) for destination in destinations]


@router.post(
    "/webhooks/destinations",
    response_model=DestinationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_destination(
    payload: DestinationCreate,
    environment: CurrentEnvironment,
    project: CurrentProject,
    context: DeveloperOrganization,
    user: CurrentUser,
    session: SessionDep,
) -> DestinationResponse:
    validate_outbound_url(payload.url)
    endpoint_exists = await session.scalar(
        select(WebhookEndpoint.id).where(
            WebhookEndpoint.id == payload.webhook_endpoint_id,
            WebhookEndpoint.project_id == project.id,
        )
    )
    if not endpoint_exists:
        raise NotFoundError("webhook_endpoint_not_found", "Webhook endpoint was not found.")
    destination = WebhookDestination(
        project_id=project.id,
        environment_id=environment.id,
        webhook_endpoint_id=payload.webhook_endpoint_id,
        name=payload.name.strip(),
        url=payload.url,
        method=payload.method,
        headers=payload.headers,
        secret_encrypted=encrypt_value(payload.secret) if payload.secret else None,
        timeout_seconds=payload.timeout_seconds,
    )
    session.add(destination)
    await session.flush()
    await record_action(
        session,
        actor_id=user.id,
        organization_id=context.organization.id,
        project_id=project.id,
        action="webhook_destination.created",
        resource_type="webhook_destination",
        resource_id=str(destination.id),
        metadata={"name": destination.name},
    )
    await session.commit()
    return destination_response(destination)


@router.get("/webhooks/events", response_model=Page[WebhookEventListItem])
async def list_events(
    project: CurrentProject,
    session: SessionDep,
    params: Annotated[PageParams, Depends(pagination_params)],
    signature: Annotated[SignatureStatus | None, Query()] = None,
) -> Page[WebhookEventListItem]:
    filters = [WebhookEvent.project_id == project.id]
    if signature:
        filters.append(WebhookEvent.signature_status == signature)
    total = await session.scalar(select(func.count()).select_from(WebhookEvent).where(*filters))
    latest_delivery = (
        select(WebhookDelivery.status)
        .where(WebhookDelivery.event_id == WebhookEvent.id)
        .order_by(WebhookDelivery.created_at.desc())
        .limit(1)
        .scalar_subquery()
    )
    rows = (
        await session.execute(
            select(WebhookEvent, WebhookEndpoint.name, latest_delivery)
            .join(WebhookEndpoint, WebhookEndpoint.id == WebhookEvent.endpoint_id)
            .where(*filters)
            .order_by(WebhookEvent.received_at.desc())
            .offset(params.offset)
            .limit(params.page_size)
        )
    ).all()
    items = [
        WebhookEventListItem(
            id=event.id,
            endpoint_id=event.endpoint_id,
            endpoint_name=endpoint_name,
            event_type=event.event_type,
            method=event.method,
            source_ip=event.source_ip,
            signature_status=event.signature_status,
            size_bytes=event.size_bytes,
            received_at=event.received_at,
            delivery_status=delivery_status,
        )
        for event, endpoint_name, delivery_status in rows
    ]
    return Page[WebhookEventListItem].from_items(items, total or 0, params)


@router.get("/webhooks/events/{event_id}", response_model=WebhookEventDetail)
async def get_event(
    event_id: uuid.UUID,
    project: CurrentProject,
    session: SessionDep,
) -> WebhookEventDetail:
    row = (
        await session.execute(
            select(WebhookEvent, WebhookEndpoint.name)
            .join(WebhookEndpoint, WebhookEndpoint.id == WebhookEvent.endpoint_id)
            .where(WebhookEvent.id == event_id, WebhookEvent.project_id == project.id)
        )
    ).one_or_none()
    if not row:
        raise NotFoundError("webhook_event_not_found", "Webhook event was not found.")
    event, endpoint_name = row
    deliveries = (
        await session.execute(
            select(WebhookDelivery, WebhookDestination.name)
            .join(WebhookDestination, WebhookDestination.id == WebhookDelivery.destination_id)
            .where(WebhookDelivery.event_id == event.id)
            .order_by(WebhookDelivery.created_at)
        )
    ).all()
    return WebhookEventDetail(
        id=event.id,
        endpoint_id=event.endpoint_id,
        endpoint_name=endpoint_name,
        event_type=event.event_type,
        method=event.method,
        headers=event.headers,
        query_params=event.query_params,
        payload=event.payload,
        raw_body=event.raw_body,
        source_ip=event.source_ip,
        signature_status=event.signature_status,
        size_bytes=event.size_bytes,
        received_at=event.received_at,
        deliveries=[
            DeliveryResponse(
                id=delivery.id,
                destination_id=delivery.destination_id,
                destination_name=destination_name,
                status=delivery.status,
                status_code=delivery.status_code,
                response_body=delivery.response_body,
                duration_ms=delivery.duration_ms,
                attempt_number=delivery.attempt_number,
                error=delivery.error,
                created_at=delivery.created_at,
            )
            for delivery, destination_name in deliveries
        ],
    )


@router.post("/webhooks/events/{event_id}/replay", status_code=status.HTTP_202_ACCEPTED)
async def replay_event(
    event_id: uuid.UUID,
    project: CurrentProject,
    context: DeveloperOrganization,
    user: CurrentUser,
    session: SessionDep,
    queue: QueueDep,
) -> dict[str, int]:
    event = await session.scalar(
        select(WebhookEvent).where(
            WebhookEvent.id == event_id,
            WebhookEvent.project_id == project.id,
        )
    )
    if not event:
        raise NotFoundError("webhook_event_not_found", "Webhook event was not found.")
    count = await enqueue_event_deliveries(session, queue, event)
    await record_action(
        session,
        actor_id=user.id,
        organization_id=context.organization.id,
        project_id=project.id,
        action="webhook.replayed",
        resource_type="webhook_event",
        resource_id=str(event.id),
        metadata={"destinations": count},
    )
    await session.commit()
    return {"deliveries_enqueued": count}


@router.post("/webhooks/deliveries/{delivery_id}/retry", status_code=status.HTTP_202_ACCEPTED)
async def retry_delivery(
    delivery_id: uuid.UUID,
    project: CurrentProject,
    _: DeveloperOrganization,
    session: SessionDep,
    queue: QueueDep,
) -> dict[str, str]:
    row = (
        await session.execute(
            select(WebhookDelivery, WebhookEvent)
            .join(WebhookEvent, WebhookEvent.id == WebhookDelivery.event_id)
            .where(
                WebhookDelivery.id == delivery_id,
                WebhookEvent.project_id == project.id,
            )
        )
    ).one_or_none()
    if not row:
        raise NotFoundError("webhook_delivery_not_found", "Webhook delivery was not found.")
    delivery, event = row
    retry = WebhookDelivery(
        event_id=event.id,
        destination_id=delivery.destination_id,
        status=DeliveryStatus.RETRYING,
        attempt_number=1,
        created_at=datetime.now(UTC),
    )
    session.add(retry)
    await session.flush()
    await queue.enqueue_job("deliver_webhook", str(retry.id))
    await session.commit()
    return {"delivery_id": str(retry.id)}
