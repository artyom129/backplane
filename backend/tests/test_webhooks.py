import hashlib
import hmac
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.encryption import encrypt_value
from app.incidents.models import Incident
from app.webhooks.models import (
    DeliveryStatus,
    SignatureStatus,
    WebhookDelivery,
    WebhookDestination,
    WebhookEndpoint,
    WebhookEvent,
)
from app.webhooks.service import deliver_webhook, enqueue_event_deliveries, signature_status
from tests.conftest import FakeQueue, TenantData


async def webhook_data(
    session: AsyncSession,
    tenant: TenantData,
) -> tuple[WebhookEndpoint, WebhookDestination, WebhookEvent]:
    endpoint = WebhookEndpoint(
        project_id=tenant.project.id,
        name="Signed source",
        public_id="signedSource123",
        signing_secret_encrypted=encrypt_value("a-long-signing-secret"),
    )
    session.add(endpoint)
    await session.flush()
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
    event = WebhookEvent(
        project_id=tenant.project.id,
        endpoint_id=endpoint.id,
        method="POST",
        headers={},
        query_params={},
        payload={"type": "test.event"},
        raw_body='{"type":"test.event"}',
        source_ip="203.0.113.12",
        event_type="test.event",
        signature_status=SignatureStatus.VERIFIED,
        size_bytes=21,
        received_at=datetime.now(UTC),
    )
    session.add_all([destination, event])
    await session.flush()
    return endpoint, destination, event


async def test_hmac_signature_verification_and_delivery_enqueue(
    session: AsyncSession,
    tenant: TenantData,
) -> None:
    endpoint, _, event = await webhook_data(session, tenant)
    body = b'{"type":"test.event"}'
    digest = hmac.new(b"a-long-signing-secret", body, hashlib.sha256).hexdigest()

    assert signature_status(endpoint, body, f"sha256={digest}") == SignatureStatus.VERIFIED
    assert signature_status(endpoint, body, "sha256=invalid") == SignatureStatus.INVALID

    queue = FakeQueue()
    assert await enqueue_event_deliveries(session, queue, event) == 1
    delivery = await session.scalar(select(WebhookDelivery))
    assert delivery is not None
    assert delivery.status == DeliveryStatus.PENDING
    assert queue.jobs[0][0] == "deliver_webhook"


async def test_final_webhook_failure_enters_dlq_and_creates_incident(
    session: AsyncSession,
    tenant: TenantData,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, destination, event = await webhook_data(session, tenant)
    delivery = WebhookDelivery(
        event_id=event.id,
        destination_id=destination.id,
        status=DeliveryStatus.RETRYING,
        attempt_number=3,
        created_at=datetime.now(UTC),
    )
    session.add(delivery)
    await session.commit()

    class FakeResponse:
        status_code = 503
        text = "unavailable"

    class FakeClient:
        def __init__(self, **_: object) -> None:
            pass

        async def __aenter__(self) -> "FakeClient":
            return self

        async def __aexit__(self, *_: object) -> None:
            pass

        async def request(self, *_: object, **__: object) -> FakeResponse:
            return FakeResponse()

    monkeypatch.setattr("app.webhooks.service.validate_outbound_url", lambda value: value)
    monkeypatch.setattr("app.webhooks.service.httpx.AsyncClient", FakeClient)
    await deliver_webhook(session, FakeQueue(), delivery.id)

    await session.refresh(delivery)
    assert delivery.status == DeliveryStatus.DEAD_LETTER
    assert await session.scalar(select(Incident.id)) is not None
