import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Query, status
from sqlalchemy import select

from app.api.dependencies import (
    CurrentProject,
    CurrentUser,
    DeveloperOrganization,
    SessionDep,
)
from app.audit.service import publish_activity, record_action
from app.core.errors import NotFoundError
from app.incidents.models import Incident, IncidentStatus, IncidentTimelineEvent
from app.incidents.schemas import (
    IncidentCreate,
    IncidentDetail,
    IncidentResponse,
    IncidentUpdate,
    TimelineEventResponse,
)

router = APIRouter(prefix="/incidents", tags=["Incidents"])


@router.get("", response_model=list[IncidentResponse])
async def list_incidents(
    project: CurrentProject,
    session: SessionDep,
    incident_status: Annotated[IncidentStatus | None, Query(alias="status")] = None,
) -> list[Incident]:
    filters = [Incident.project_id == project.id]
    if incident_status:
        filters.append(Incident.status == incident_status)
    return list(
        await session.scalars(
            select(Incident).where(*filters).order_by(Incident.created_at.desc()).limit(100)
        )
    )


@router.post("", response_model=IncidentResponse, status_code=status.HTTP_201_CREATED)
async def create_incident(
    payload: IncidentCreate,
    project: CurrentProject,
    context: DeveloperOrganization,
    user: CurrentUser,
    session: SessionDep,
) -> Incident:
    now = datetime.now(UTC)
    incident = Incident(
        project_id=project.id,
        title=payload.title,
        severity=payload.severity,
        status=IncidentStatus.OPEN,
        source="manual",
        description=payload.description,
    )
    session.add(incident)
    await session.flush()
    session.add(
        IncidentTimelineEvent(
            incident_id=incident.id,
            kind="incident.created",
            message="Incident created manually.",
            metadata_={"actor_id": str(user.id)},
            created_at=now,
        )
    )
    await record_action(
        session,
        actor_id=user.id,
        organization_id=context.organization.id,
        project_id=project.id,
        action="incident.created",
        resource_type="incident",
        resource_id=str(incident.id),
        metadata={"severity": incident.severity.value},
    )
    await publish_activity(
        session,
        organization_id=context.organization.id,
        project_id=project.id,
        kind="incident.created",
        title=incident.title,
        status="error",
        resource_id=str(incident.id),
    )
    await session.commit()
    return incident


@router.get("/{incident_id}", response_model=IncidentDetail)
async def get_incident(
    incident_id: uuid.UUID,
    project: CurrentProject,
    session: SessionDep,
) -> IncidentDetail:
    incident = await session.scalar(
        select(Incident).where(
            Incident.id == incident_id,
            Incident.project_id == project.id,
        )
    )
    if not incident:
        raise NotFoundError("incident_not_found", "Incident was not found.")
    events = list(
        await session.scalars(
            select(IncidentTimelineEvent)
            .where(IncidentTimelineEvent.incident_id == incident.id)
            .order_by(IncidentTimelineEvent.created_at)
        )
    )
    return IncidentDetail(
        **IncidentResponse.model_validate(incident).model_dump(),
        timeline=[
            TimelineEventResponse(
                id=event.id,
                kind=event.kind,
                message=event.message,
                metadata=event.metadata_,
                created_at=event.created_at,
            )
            for event in events
        ],
    )


@router.patch("/{incident_id}", response_model=IncidentResponse)
async def update_incident(
    incident_id: uuid.UUID,
    payload: IncidentUpdate,
    project: CurrentProject,
    context: DeveloperOrganization,
    user: CurrentUser,
    session: SessionDep,
) -> Incident:
    incident = await session.scalar(
        select(Incident).where(
            Incident.id == incident_id,
            Incident.project_id == project.id,
        )
    )
    if not incident:
        raise NotFoundError("incident_not_found", "Incident was not found.")
    now = datetime.now(UTC)
    if payload.status is not None and payload.status != incident.status:
        previous = incident.status
        incident.status = payload.status
        incident.resolved_at = now if payload.status == IncidentStatus.RESOLVED else None
        session.add(
            IncidentTimelineEvent(
                incident_id=incident.id,
                kind=f"incident.{payload.status.value}",
                message=payload.note
                or f"Status changed from {previous.value} to {payload.status.value}.",
                metadata_={"actor_id": str(user.id), "previous_status": previous.value},
                created_at=now,
            )
        )
    elif payload.note:
        session.add(
            IncidentTimelineEvent(
                incident_id=incident.id,
                kind="incident.note_added",
                message=payload.note,
                metadata_={"actor_id": str(user.id)},
                created_at=now,
            )
        )
    if payload.severity is not None:
        incident.severity = payload.severity
    action = (
        "incident.resolved" if payload.status == IncidentStatus.RESOLVED else "incident.updated"
    )
    await record_action(
        session,
        actor_id=user.id,
        organization_id=context.organization.id,
        project_id=project.id,
        action=action,
        resource_type="incident",
        resource_id=str(incident.id),
        metadata={"status": incident.status.value},
    )
    await publish_activity(
        session,
        organization_id=context.organization.id,
        project_id=project.id,
        kind=action,
        title=f"Incident {incident.status.value}: {incident.title}",
        status="success" if incident.status == IncidentStatus.RESOLVED else "warning",
        resource_id=str(incident.id),
    )
    await session.commit()
    return incident
