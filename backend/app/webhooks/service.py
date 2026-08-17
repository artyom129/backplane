import hashlib
import hmac
import secrets
import time
import uuid
from datetime import UTC, datetime

import httpx
import structlog
from arq import ArqRedis
from redis.exceptions import RedisError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import publish_activity
from app.config import settings
from app.core.encryption import decrypt_value
from app.core.errors import AppError
from app.core.network import validate_outbound_url
from app.core.redis import redis_client
from app.incidents.models import (
    Incident,
    IncidentSeverity,
    IncidentStatus,
    IncidentTimelineEvent,
)
from app.projects.models import Project
from app.webhooks.models import (
    DeliveryStatus,
    SignatureStatus,
    WebhookDelivery,
    WebhookDestination,
    WebhookEndpoint,
    WebhookEvent,
)

logger = structlog.get_logger()
RETRY_DELAYS = [60, 300, 900]


def public_id() -> str:
    return secrets.token_urlsafe(18).replace("-", "").replace("_", "")[:24]


def signature_status(
    endpoint: WebhookEndpoint,
    body: bytes,
    signature: str | None,
) -> SignatureStatus:
    if not endpoint.signing_secret_encrypted:
        return SignatureStatus.NOT_CONFIGURED
    if not signature:
        return SignatureStatus.INVALID
    secret = decrypt_value(endpoint.signing_secret_encrypted)
    digest = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    provided = signature.removeprefix("sha256=")
    return (
        SignatureStatus.VERIFIED
        if hmac.compare_digest(digest, provided)
        else SignatureStatus.INVALID
    )


def infer_event_type(headers: dict[str, str], payload: object | None) -> str:
    for header in ("x-event-type", "x-github-event", "x-webhook-event"):
        if value := headers.get(header):
            return value[:160]
    if isinstance(payload, dict):
        for key in ("type", "event", "event_type"):
            if value := payload.get(key):
                return str(value)[:160]
    return "unknown"


async def enforce_rate_limit(public_id_value: str, source_ip: str) -> bool:
    key = f"hook-rate:{public_id_value}:{source_ip}"
    try:
        count = await redis_client().incr(key)
        if count == 1:
            await redis_client().expire(key, 60)
        return count <= settings.webhook_rate_limit
    except RedisError as exc:
        logger.warning("webhook_rate_limit_unavailable", error=str(exc))
        return True


async def enqueue_event_deliveries(
    session: AsyncSession,
    queue: ArqRedis,
    event: WebhookEvent,
) -> int:
    destinations = list(
        await session.scalars(
            select(WebhookDestination).where(
                WebhookDestination.webhook_endpoint_id == event.endpoint_id,
                WebhookDestination.is_active.is_(True),
            )
        )
    )
    now = datetime.now(UTC)
    for destination in destinations:
        delivery = WebhookDelivery(
            event_id=event.id,
            destination_id=destination.id,
            status=DeliveryStatus.PENDING,
            attempt_number=1,
            created_at=now,
        )
        session.add(delivery)
        await session.flush()
        await queue.enqueue_job("deliver_webhook", str(delivery.id))
    return len(destinations)


async def create_delivery_incident(
    session: AsyncSession,
    *,
    event: WebhookEvent,
    destination: WebhookDestination,
    error: str,
) -> None:
    existing = await session.scalar(
        select(Incident.id).where(
            Incident.project_id == event.project_id,
            Incident.source == "webhook_delivery",
            Incident.source_id == str(destination.id),
            Incident.status != IncidentStatus.RESOLVED,
        )
    )
    if existing:
        return
    incident = Incident(
        project_id=event.project_id,
        title=f"Webhook delivery to {destination.name} exhausted retries",
        severity=IncidentSeverity.HIGH,
        status=IncidentStatus.OPEN,
        source="webhook_delivery",
        source_id=str(destination.id),
        description=error,
    )
    session.add(incident)
    await session.flush()
    session.add(
        IncidentTimelineEvent(
            incident_id=incident.id,
            kind="incident.created",
            message="Incident created after webhook delivery entered the dead-letter queue.",
            metadata_={"event_id": str(event.id), "destination_id": str(destination.id)},
            created_at=datetime.now(UTC),
        )
    )
    project = await session.get(Project, event.project_id)
    if project:
        await publish_activity(
            session,
            organization_id=project.organization_id,
            project_id=project.id,
            kind="incident.created",
            title=incident.title,
            detail="Delivery retries exhausted",
            status="error",
            resource_id=str(incident.id),
        )


async def deliver_webhook(
    session: AsyncSession,
    queue: ArqRedis,
    delivery_id: uuid.UUID,
) -> None:
    delivery = await session.get(WebhookDelivery, delivery_id)
    if not delivery or delivery.status == DeliveryStatus.DELIVERED:
        return
    event = await session.get(WebhookEvent, delivery.event_id)
    destination = await session.get(WebhookDestination, delivery.destination_id)
    if not event or not destination or not destination.is_active:
        return

    headers = dict(destination.headers)
    headers["X-Backplane-Event-ID"] = str(event.id)
    if destination.secret_encrypted:
        secret = decrypt_value(destination.secret_encrypted)
        signature = hmac.new(secret.encode(), event.raw_body.encode(), hashlib.sha256).hexdigest()
        headers["X-Backplane-Signature"] = f"sha256={signature}"

    started = time.perf_counter()
    error: str | None = None
    status_code: int | None = None
    response_body: str | None = None
    try:
        validate_outbound_url(destination.url)
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(destination.timeout_seconds),
            follow_redirects=False,
        ) as client:
            response = await client.request(
                destination.method,
                destination.url,
                headers=headers,
                content=event.raw_body.encode(),
            )
        status_code = response.status_code
        response_body = response.text[:16_384]
        if response.status_code >= 400:
            error = f"Destination returned HTTP {response.status_code}."
    except (httpx.RequestError, AppError, ValueError) as exc:
        error = f"Delivery failed: {exc.__class__.__name__}."

    delivery.duration_ms = round((time.perf_counter() - started) * 1000, 2)
    delivery.status_code = status_code
    delivery.response_body = response_body
    delivery.error = error
    if error is None:
        delivery.status = DeliveryStatus.DELIVERED
        project = await session.get(Project, event.project_id)
        if project:
            await publish_activity(
                session,
                organization_id=project.organization_id,
                project_id=project.id,
                kind="webhook.delivered",
                title=f"Webhook delivered to {destination.name}",
                detail=f"HTTP {status_code} · {delivery.duration_ms:.0f} ms",
                status="success",
                resource_id=str(event.id),
            )
    elif delivery.attempt_number < len(RETRY_DELAYS):
        delivery.status = DeliveryStatus.FAILED
        next_attempt = delivery.attempt_number + 1
        retry = WebhookDelivery(
            event_id=event.id,
            destination_id=destination.id,
            status=DeliveryStatus.RETRYING,
            attempt_number=next_attempt,
            created_at=datetime.now(UTC),
        )
        session.add(retry)
        await session.flush()
        delay = RETRY_DELAYS[delivery.attempt_number - 1]
        await queue.enqueue_job("deliver_webhook", str(retry.id), _defer_by=delay)
    else:
        delivery.status = DeliveryStatus.DEAD_LETTER
        await create_delivery_incident(
            session,
            event=event,
            destination=destination,
            error=error,
        )
    await session.commit()
