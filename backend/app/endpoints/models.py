import enum
import uuid

from sqlalchemy import JSON, Enum, Float, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class HTTPMethod(enum.StrEnum):
    GET = "GET"
    POST = "POST"
    PUT = "PUT"
    PATCH = "PATCH"
    DELETE = "DELETE"


class AuthenticationType(enum.StrEnum):
    NONE = "none"
    BEARER = "bearer"
    API_KEY = "api_key"
    BASIC = "basic"


class Endpoint(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "endpoints"
    __table_args__ = (
        UniqueConstraint("environment_id", "name", name="uq_endpoint_environment_name"),
    )

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        index=True,
    )
    environment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("environments.id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(String(120))
    base_url: Mapped[str] = mapped_column(String(2048))
    method: Mapped[HTTPMethod] = mapped_column(
        Enum(HTTPMethod, name="http_method", native_enum=False)
    )
    path: Mapped[str] = mapped_column(String(1024), default="/")
    headers: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)
    authentication_type: Mapped[AuthenticationType] = mapped_column(
        Enum(AuthenticationType, name="authentication_type", native_enum=False),
        default=AuthenticationType.NONE,
    )
    encrypted_auth_config: Mapped[str | None] = mapped_column(Text, nullable=True)
    timeout_seconds: Mapped[float] = mapped_column(Float, default=15.0)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
