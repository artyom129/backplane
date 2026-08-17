import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AuditEventResponse(BaseModel):
    id: uuid.UUID
    actor_id: uuid.UUID | None
    actor_name: str | None
    organization_id: uuid.UUID
    project_id: uuid.UUID | None
    project_name: str | None
    action: str
    resource_type: str
    resource_id: str
    metadata: dict[str, object]
    created_at: datetime


class ActivityEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID | None
    kind: str
    title: str
    detail: str | None
    status: str
    resource_id: str | None
    created_at: datetime
