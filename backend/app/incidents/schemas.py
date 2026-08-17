import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.incidents.models import IncidentSeverity, IncidentStatus


class IncidentCreate(BaseModel):
    title: str = Field(min_length=3, max_length=240)
    severity: IncidentSeverity
    description: str | None = Field(default=None, max_length=4_000)


class IncidentUpdate(BaseModel):
    status: IncidentStatus | None = None
    severity: IncidentSeverity | None = None
    note: str | None = Field(default=None, max_length=500)


class TimelineEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: str
    message: str
    metadata: dict[str, object]
    created_at: datetime


class IncidentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    title: str
    severity: IncidentSeverity
    status: IncidentStatus
    source: str
    source_id: str | None
    description: str | None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None


class IncidentDetail(IncidentResponse):
    timeline: list[TimelineEventResponse]
