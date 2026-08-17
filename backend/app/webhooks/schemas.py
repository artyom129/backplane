import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.webhooks.models import DeliveryStatus, SignatureStatus


class WebhookEndpointCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    signing_secret: str | None = Field(default=None, min_length=16, max_length=512)
    signature_header: str = Field(default="X-Webhook-Signature", max_length=120)


class WebhookEndpointResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    public_id: str
    url: str
    signature_header: str
    has_signing_secret: bool
    is_active: bool
    created_at: datetime


class DestinationCreate(BaseModel):
    webhook_endpoint_id: uuid.UUID
    name: str = Field(min_length=2, max_length=120)
    url: str = Field(max_length=2048)
    method: str = Field(default="POST", pattern=r"^(POST|PUT|PATCH)$")
    headers: dict[str, str] = Field(default_factory=dict)
    secret: str | None = Field(default=None, min_length=16, max_length=512)
    timeout_seconds: float = Field(default=15.0, ge=1, le=60)


class DestinationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    webhook_endpoint_id: uuid.UUID
    name: str
    url: str
    method: str
    headers: dict[str, str]
    has_secret: bool
    timeout_seconds: float
    is_active: bool
    created_at: datetime


class DeliveryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    destination_id: uuid.UUID
    destination_name: str
    status: DeliveryStatus
    status_code: int | None
    response_body: str | None
    duration_ms: float | None
    attempt_number: int
    error: str | None
    created_at: datetime


class WebhookEventListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    endpoint_id: uuid.UUID
    endpoint_name: str
    event_type: str
    method: str
    source_ip: str
    signature_status: SignatureStatus
    size_bytes: int
    received_at: datetime
    delivery_status: DeliveryStatus | None


class WebhookEventDetail(BaseModel):
    id: uuid.UUID
    endpoint_id: uuid.UUID
    endpoint_name: str
    event_type: str
    method: str
    headers: dict[str, str]
    query_params: dict[str, str]
    payload: object | None
    raw_body: str
    source_ip: str
    signature_status: SignatureStatus
    size_bytes: int
    received_at: datetime
    deliveries: list[DeliveryResponse]


class WebhookAccepted(BaseModel):
    event_id: uuid.UUID
    accepted: bool = True
