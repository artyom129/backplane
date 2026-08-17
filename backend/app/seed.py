import asyncio
import json
from datetime import UTC, datetime, timedelta

import structlog
from croniter import croniter
from sqlalchemy import select

from app import models  # noqa: F401
from app.audit.models import ActivityEvent, AuditEvent
from app.auth.models import User
from app.core.encryption import encrypt_value
from app.core.logging import configure_logging
from app.core.security import hash_password
from app.db.session import SessionFactory
from app.endpoints.models import AuthenticationType, Endpoint, HTTPMethod
from app.environments.models import Environment
from app.incidents.models import (
    Incident,
    IncidentSeverity,
    IncidentStatus,
    IncidentTimelineEvent,
)
from app.jobs.models import Job, JobStatus, ScheduledJob
from app.organizations.models import Organization, OrganizationMember, OrganizationRole
from app.projects.models import Project
from app.requests.models import RequestOutcome, RequestRecord
from app.secrets.models import Secret
from app.webhooks.models import (
    DeliveryStatus,
    SignatureStatus,
    WebhookDelivery,
    WebhookDestination,
    WebhookEndpoint,
    WebhookEvent,
)

logger = structlog.get_logger()


async def seed() -> None:
    now = datetime.now(UTC)
    async with SessionFactory() as session:
        existing = await session.scalar(select(User.id).where(User.email == "demo@backplane.dev"))
        if existing:
            logger.info("seed_skipped", reason="demo account already exists")
            return

        user = User(
            email="demo@backplane.dev",
            full_name="Artyom Volkov",
            password_hash=hash_password("backplane-demo"),
        )
        organization = Organization(name="Acme Systems", slug="acme-systems")
        session.add_all([user, organization])
        await session.flush()
        session.add(
            OrganizationMember(
                organization_id=organization.id,
                user_id=user.id,
                role=OrganizationRole.OWNER,
            )
        )
        project = Project(
            organization_id=organization.id,
            name="Payments Platform",
            slug="payments-platform",
            description="Payment APIs, webhook delivery and operational automation.",
        )
        session.add(project)
        await session.flush()

        production = Environment(
            project_id=project.id,
            name="Production",
            slug="production",
            variables={"REGION": "eu-west-1", "LOG_LEVEL": "info"},
        )
        staging = Environment(
            project_id=project.id,
            name="Staging",
            slug="staging",
            variables={"REGION": "eu-west-1", "LOG_LEVEL": "debug"},
        )
        session.add_all([production, staging])
        await session.flush()

        endpoints = [
            Endpoint(
                project_id=project.id,
                environment_id=production.id,
                name="Stripe API",
                base_url="https://api.stripe.com",
                method=HTTPMethod.GET,
                path="/v1/balance",
                headers={"Accept": "application/json"},
                authentication_type=AuthenticationType.BEARER,
                encrypted_auth_config=encrypt_value(json.dumps({"token": "sk_test_demo_value"})),
                timeout_seconds=10,
                tags=["payments", "external"],
            ),
            Endpoint(
                project_id=project.id,
                environment_id=production.id,
                name="CRM API",
                base_url="https://api.example.com",
                method=HTTPMethod.GET,
                path="/v2/customers",
                headers={"Accept": "application/json"},
                authentication_type=AuthenticationType.API_KEY,
                encrypted_auth_config=encrypt_value(
                    json.dumps({"header_name": "X-API-Key", "value": "demo_crm_key"})
                ),
                timeout_seconds=15,
                tags=["customers", "external"],
            ),
            Endpoint(
                project_id=project.id,
                environment_id=production.id,
                name="Notification API",
                base_url="https://notify.example.com",
                method=HTTPMethod.POST,
                path="/v1/messages",
                headers={"Content-Type": "application/json"},
                authentication_type=AuthenticationType.NONE,
                timeout_seconds=8,
                tags=["internal"],
            ),
        ]
        session.add_all(endpoints)
        await session.flush()

        hook = WebhookEndpoint(
            project_id=project.id,
            name="Stripe events",
            public_id="demoStripeWebhook8f3k2",
            signing_secret_encrypted=encrypt_value("whsec_demo_not_a_real_secret"),
            signature_header="Stripe-Signature",
        )
        session.add(hook)
        await session.flush()
        destination = WebhookDestination(
            project_id=project.id,
            environment_id=production.id,
            webhook_endpoint_id=hook.id,
            name="Payments worker",
            url="https://payments.example.com/webhooks/stripe",
            method="POST",
            headers={"Content-Type": "application/json"},
            secret_encrypted=encrypt_value("destination_demo_secret"),
            timeout_seconds=12,
        )
        session.add(destination)
        await session.flush()

        event_specs = [
            ("payment_intent.succeeded", DeliveryStatus.DELIVERED, 200, 84.2),
            ("charge.refunded", DeliveryStatus.DELIVERED, 202, 96.8),
            ("invoice.payment_failed", DeliveryStatus.DEAD_LETTER, 503, 1_208.4),
        ]
        for index, (event_type, delivery_status, status_code, latency) in enumerate(event_specs):
            received_at = now - timedelta(minutes=12 + index * 19)
            payload = {
                "id": f"evt_demo_{index + 1:02d}",
                "type": event_type,
                "livemode": False,
                "data": {"object": {"id": f"pi_demo_{index + 1:02d}"}},
            }
            raw_body = json.dumps(payload, separators=(",", ":"))
            event = WebhookEvent(
                project_id=project.id,
                endpoint_id=hook.id,
                method="POST",
                headers={"content-type": "application/json", "user-agent": "Stripe/1.0"},
                query_params={},
                payload=payload,
                raw_body=raw_body,
                source_ip=f"198.51.100.{20 + index}",
                event_type=event_type,
                signature_status=SignatureStatus.VERIFIED,
                size_bytes=len(raw_body.encode()),
                received_at=received_at,
            )
            session.add(event)
            await session.flush()
            session.add(
                WebhookDelivery(
                    event_id=event.id,
                    destination_id=destination.id,
                    status=delivery_status,
                    status_code=status_code,
                    response_body='{"accepted":true}'
                    if status_code < 400
                    else "upstream unavailable",
                    duration_ms=latency,
                    attempt_number=3 if delivery_status == DeliveryStatus.DEAD_LETTER else 1,
                    error=(
                        "Destination returned HTTP 503."
                        if delivery_status == DeliveryStatus.DEAD_LETTER
                        else None
                    ),
                    created_at=received_at + timedelta(seconds=1),
                )
            )

        request_durations = [
            92.0,
            108.5,
            84.1,
            121.8,
            96.4,
            310.2,
            101.0,
            88.7,
            115.3,
            93.2,
            610.0,
            105.6,
        ]
        request_statuses = [200, 200, 201, 200, 200, 429, 200, 204, 200, 200, 502, 200]
        for index, (duration, status_code) in enumerate(
            zip(request_durations, request_statuses, strict=False)
        ):
            created_at = now - timedelta(hours=22 - index * 1.8)
            outcome = RequestOutcome.SUCCESS if status_code < 400 else RequestOutcome.ERROR
            session.add(
                RequestRecord(
                    organization_id=organization.id,
                    project_id=project.id,
                    environment_id=production.id,
                    endpoint_id=endpoints[index % len(endpoints)].id,
                    actor_id=user.id,
                    method=endpoints[index % len(endpoints)].method.value,
                    url=(
                        f"{endpoints[index % len(endpoints)].base_url}"
                        f"{endpoints[index % len(endpoints)].path}"
                    ),
                    request_headers={"Accept": "application/json"},
                    request_body=None,
                    status_code=status_code,
                    response_headers={"content-type": "application/json"},
                    response_body={"ok": outcome == RequestOutcome.SUCCESS},
                    response_size=128 + index * 13,
                    duration_ms=duration,
                    outcome=outcome,
                    error=None if outcome == RequestOutcome.SUCCESS else f"HTTP {status_code}",
                    created_at=created_at,
                )
            )

        completed_job = Job(
            project_id=project.id,
            environment_id=production.id,
            type="endpoint.check",
            status=JobStatus.COMPLETED,
            payload={"endpoint_id": str(endpoints[0].id)},
            result={"status_code": 200},
            created_at=now - timedelta(minutes=38),
            started_at=now - timedelta(minutes=37, seconds=58),
            finished_at=now - timedelta(minutes=37, seconds=57),
            attempts=1,
            max_attempts=3,
        )
        running_job = Job(
            project_id=project.id,
            environment_id=production.id,
            type="endpoint.check",
            status=JobStatus.RUNNING,
            payload={"endpoint_id": str(endpoints[1].id)},
            created_at=now - timedelta(seconds=24),
            started_at=now - timedelta(seconds=21),
            attempts=1,
            max_attempts=3,
        )
        session.add_all([completed_job, running_job])
        schedule = ScheduledJob(
            project_id=project.id,
            environment_id=production.id,
            name="Stripe availability check",
            cron_expression="*/15 * * * *",
            timezone="UTC",
            action={"type": "endpoint.check", "payload": {"endpoint_id": str(endpoints[0].id)}},
            enabled=True,
            last_run_at=now - timedelta(minutes=15),
            next_run_at=croniter("*/15 * * * *", now).get_next(datetime),
            last_status=JobStatus.COMPLETED,
        )
        session.add(schedule)

        incident = Incident(
            project_id=project.id,
            title="Webhook delivery to Payments worker exhausted retries",
            severity=IncidentSeverity.HIGH,
            status=IncidentStatus.INVESTIGATING,
            source="webhook_delivery",
            source_id=str(destination.id),
            description="The destination returned HTTP 503 for three consecutive attempts.",
        )
        session.add(incident)
        await session.flush()
        session.add_all(
            [
                IncidentTimelineEvent(
                    incident_id=incident.id,
                    kind="incident.created",
                    message="Incident created after delivery entered the dead-letter queue.",
                    metadata_={"destination_id": str(destination.id)},
                    created_at=now - timedelta(minutes=49),
                ),
                IncidentTimelineEvent(
                    incident_id=incident.id,
                    kind="incident.investigating",
                    message="Investigation started by the on-call developer.",
                    metadata_={"actor_id": str(user.id)},
                    created_at=now - timedelta(minutes=41),
                ),
            ]
        )

        session.add_all(
            [
                Secret(
                    organization_id=organization.id,
                    project_id=project.id,
                    environment_id=production.id,
                    name="STRIPE_SECRET",
                    encrypted_value=encrypt_value("sk_demo_not_a_real_key"),
                ),
                Secret(
                    organization_id=organization.id,
                    project_id=project.id,
                    environment_id=production.id,
                    name="CRM_API_TOKEN",
                    encrypted_value=encrypt_value("crm_demo_not_a_real_token"),
                ),
                Secret(
                    organization_id=organization.id,
                    project_id=project.id,
                    environment_id=production.id,
                    name="OPENAI_API_KEY",
                    encrypted_value=encrypt_value("demo_value_not_a_real_api_key"),
                ),
            ]
        )

        activity_specs = [
            (
                "request.completed",
                "Stripe balance request completed",
                "HTTP 200 · 92 ms",
                "success",
            ),
            (
                "webhook.received",
                "payment_intent.succeeded webhook received",
                "Stripe events",
                "success",
            ),
            ("job.completed", "endpoint.check job completed", "HTTP 200", "success"),
            ("incident.created", incident.title, "Delivery retries exhausted", "error"),
        ]
        for index, (kind, title, detail, event_status) in enumerate(activity_specs):
            session.add(
                ActivityEvent(
                    organization_id=organization.id,
                    project_id=project.id,
                    kind=kind,
                    title=title,
                    detail=detail,
                    status=event_status,
                    created_at=now - timedelta(minutes=index * 9 + 2),
                )
            )
        session.add(
            AuditEvent(
                actor_id=user.id,
                organization_id=organization.id,
                project_id=project.id,
                action="project.created",
                resource_type="project",
                resource_id=str(project.id),
                metadata_={"source": "demo_seed"},
                created_at=now - timedelta(days=7),
            )
        )
        await session.commit()
        logger.info("seed_complete", email=user.email, project=project.name)


if __name__ == "__main__":
    configure_logging()
    asyncio.run(seed())
