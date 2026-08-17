import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.endpoints.models import HTTPMethod
from app.requests.models import RequestOutcome


class ExecuteRequest(BaseModel):
    endpoint_id: uuid.UUID | None = None
    method: HTTPMethod | None = None
    url: str | None = Field(default=None, max_length=2048)
    headers: dict[str, str] = Field(default_factory=dict)
    query: dict[str, str] = Field(default_factory=dict)
    body: object | None = None

    @model_validator(mode="after")
    def endpoint_or_url(self) -> "ExecuteRequest":
        if self.endpoint_id is None and not self.url:
            raise ValueError("Either endpoint_id or url is required")
        return self


class RequestResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    endpoint_id: uuid.UUID | None
    method: str
    url: str
    request_headers: dict[str, str]
    request_body: object | None
    status_code: int | None
    response_headers: dict[str, str]
    response_body: object | None
    response_text: str | None
    response_size: int
    duration_ms: float
    outcome: RequestOutcome
    error: str | None
    created_at: datetime


class RequestListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    endpoint_id: uuid.UUID | None
    method: str
    url: str
    status_code: int | None
    response_size: int
    duration_ms: float
    outcome: RequestOutcome
    error: str | None
    created_at: datetime
