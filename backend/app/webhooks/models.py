import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class SignatureStatus(enum.StrEnum):
    NOT_CONFIGURED = "not_configured"
    VERIFIED = "verified"
    INVALID = "invalid"


class DeliveryStatus(enum.StrEnum):
    PENDING = "pending"
    DELIVERED = "delivered"
    FAILED = "failed"
    RETRYING = "retrying"
    DEAD_LETTER = "dead_letter"


class WebhookEndpoint(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "webhook_endpoints"

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(String(120))
    public_id: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    signing_secret_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    signature_header: Mapped[str] = mapped_column(String(120), default="X-Webhook-Signature")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class WebhookEvent(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "webhook_events"
    __table_args__ = (Index("ix_webhook_event_project_received", "project_id", "received_at"),)

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        index=True,
    )
    endpoint_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("webhook_endpoints.id", ondelete="CASCADE"),
        index=True,
    )
    method: Mapped[str] = mapped_column(String(10))
    headers: Mapped[dict[str, str]] = mapped_column(JSON)
    query_params: Mapped[dict[str, str]] = mapped_column(JSON)
    payload: Mapped[object | None] = mapped_column(JSON, nullable=True)
    raw_body: Mapped[str] = mapped_column(Text)
    source_ip: Mapped[str] = mapped_column(String(64))
    event_type: Mapped[str] = mapped_column(String(160), default="unknown")
    signature_status: Mapped[SignatureStatus] = mapped_column(
        Enum(SignatureStatus, name="signature_status", native_enum=False)
    )
    size_bytes: Mapped[int] = mapped_column(Integer)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class WebhookDestination(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "webhook_destinations"

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        index=True,
    )
    environment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("environments.id", ondelete="CASCADE"),
        index=True,
    )
    webhook_endpoint_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("webhook_endpoints.id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(String(120))
    url: Mapped[str] = mapped_column(String(2048))
    method: Mapped[str] = mapped_column(String(10), default="POST")
    headers: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)
    secret_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    timeout_seconds: Mapped[float] = mapped_column(Float, default=15.0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class WebhookDelivery(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "webhook_deliveries"
    __table_args__ = (Index("ix_delivery_event_attempt", "event_id", "attempt_number"),)

    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("webhook_events.id", ondelete="CASCADE"),
        index=True,
    )
    destination_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("webhook_destinations.id", ondelete="CASCADE"),
        index=True,
    )
    status: Mapped[DeliveryStatus] = mapped_column(
        Enum(DeliveryStatus, name="delivery_status", native_enum=False),
        index=True,
    )
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    attempt_number: Mapped[int] = mapped_column(Integer, default=1)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
