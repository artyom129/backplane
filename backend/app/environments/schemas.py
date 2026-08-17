import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.environments.models import EnvironmentStatus


class EnvironmentCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    variables: dict[str, str] = Field(default_factory=dict)


class EnvironmentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    status: EnvironmentStatus | None = None
    variables: dict[str, str] | None = None


class EnvironmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    slug: str
    status: EnvironmentStatus
    variables: dict[str, str]
    created_at: datetime
    updated_at: datetime
