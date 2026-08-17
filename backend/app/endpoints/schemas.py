import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.endpoints.models import AuthenticationType, HTTPMethod


class EndpointWrite(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    base_url: str = Field(max_length=2048)
    method: HTTPMethod = HTTPMethod.GET
    path: str = Field(default="/", max_length=1024)
    headers: dict[str, str] = Field(default_factory=dict)
    authentication_type: AuthenticationType = AuthenticationType.NONE
    auth_config: dict[str, str] | None = None
    timeout_seconds: float = Field(default=15.0, ge=1, le=60)
    tags: list[str] = Field(default_factory=list, max_length=12)


class EndpointUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    base_url: str | None = Field(default=None, max_length=2048)
    method: HTTPMethod | None = None
    path: str | None = Field(default=None, max_length=1024)
    headers: dict[str, str] | None = None
    authentication_type: AuthenticationType | None = None
    auth_config: dict[str, str] | None = None
    timeout_seconds: float | None = Field(default=None, ge=1, le=60)
    tags: list[str] | None = Field(default=None, max_length=12)


class EndpointResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    environment_id: uuid.UUID
    name: str
    base_url: str
    method: HTTPMethod
    path: str
    headers: dict[str, str]
    authentication_type: AuthenticationType
    has_auth_config: bool
    timeout_seconds: float
    tags: list[str]
    created_at: datetime
    updated_at: datetime
