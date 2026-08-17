from datetime import UTC, datetime, timedelta

from fastapi import APIRouter
from sqlalchemy import case, func, select

from app.api.dependencies import CurrentProject, SessionDep
from app.incidents.models import Incident, IncidentStatus
from app.jobs.models import Job, JobStatus
from app.requests.models import RequestOutcome, RequestRecord
from app.telemetry.schemas import (
    DashboardResponse,
    DashboardStats,
    HealthComponent,
    RequestMetricPoint,
)
from app.webhooks.models import DeliveryStatus, WebhookDelivery, WebhookEvent

router = APIRouter(prefix="/telemetry", tags=["Telemetry"])


@router.get("/dashboard", response_model=DashboardResponse)
async def dashboard(project: CurrentProject, session: SessionDep) -> DashboardResponse:
    since = datetime.now(UTC) - timedelta(hours=24)
    request_stats = (
        await session.execute(
            select(
                func.count(RequestRecord.id),
                func.sum(case((RequestRecord.outcome == RequestOutcome.SUCCESS, 1), else_=0)),
                func.avg(RequestRecord.duration_ms),
            ).where(
                RequestRecord.project_id == project.id,
                RequestRecord.created_at >= since,
            )
        )
    ).one()
    request_count = request_stats[0] or 0
    success_count = request_stats[1] or 0
    average_latency = request_stats[2]

    failed_deliveries = await session.scalar(
        select(func.count(WebhookDelivery.id))
        .join(WebhookEvent, WebhookEvent.id == WebhookDelivery.event_id)
        .where(
            WebhookEvent.project_id == project.id,
            WebhookDelivery.created_at >= since,
            WebhookDelivery.status.in_([DeliveryStatus.FAILED, DeliveryStatus.DEAD_LETTER]),
        )
    )
    active_incidents = await session.scalar(
        select(func.count(Incident.id)).where(
            Incident.project_id == project.id,
            Incident.status != IncidentStatus.RESOLVED,
        )
    )
    jobs_running = await session.scalar(
        select(func.count(Job.id)).where(
            Job.project_id == project.id,
            Job.status.in_([JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.RETRYING]),
        )
    )

    bucket = func.date_trunc("hour", RequestRecord.created_at)
    metric_rows = (
        await session.execute(
            select(
                bucket.label("timestamp"),
                func.count(RequestRecord.id),
                func.sum(case((RequestRecord.outcome == RequestOutcome.ERROR, 1), else_=0)),
                func.avg(RequestRecord.duration_ms),
            )
            .where(
                RequestRecord.project_id == project.id,
                RequestRecord.created_at >= since,
            )
            .group_by(bucket)
            .order_by(bucket)
        )
    ).all()
    request_activity = [
        RequestMetricPoint(
            timestamp=timestamp,
            requests=count,
            errors=errors or 0,
            average_latency_ms=round(float(latency or 0), 2),
        )
        for timestamp, count, errors, latency in metric_rows
    ]

    request_error_rate = (
        0.0 if request_count == 0 else (request_count - success_count) / request_count
    )
    delivery_failures = failed_deliveries or 0
    health = [
        HealthComponent(
            name="API requests",
            status="operational" if request_error_rate < 0.05 else "degraded",
            detail=(
                "No traffic in the last 24 hours"
                if request_count == 0
                else f"{request_error_rate * 100:.1f}% error rate"
            ),
        ),
        HealthComponent(
            name="Webhook delivery",
            status="operational" if delivery_failures == 0 else "degraded",
            detail=f"{delivery_failures} failed attempts in 24h",
        ),
        HealthComponent(
            name="Background jobs",
            status="operational" if (active_incidents or 0) == 0 else "degraded",
            detail=f"{jobs_running or 0} currently active",
        ),
    ]
    return DashboardResponse(
        stats=DashboardStats(
            requests_24h=request_count,
            success_rate=(round(success_count / request_count * 100, 2) if request_count else None),
            average_latency_ms=(
                round(float(average_latency), 2) if average_latency is not None else None
            ),
            failed_deliveries=delivery_failures,
            active_incidents=active_incidents or 0,
            jobs_running=jobs_running or 0,
        ),
        request_activity=request_activity,
        health=health,
    )
