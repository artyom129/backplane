import enum
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Enum, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.projects.models import Project


class EnvironmentStatus(enum.StrEnum):
    OPERATIONAL = "operational"
    DEGRADED = "degraded"
    DISABLED = "disabled"


class Environment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "environments"
    __table_args__ = (UniqueConstraint("project_id", "slug", name="uq_environment_project_slug"),)

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(String(80))
    slug: Mapped[str] = mapped_column(String(60))
    status: Mapped[EnvironmentStatus] = mapped_column(
        Enum(EnvironmentStatus, name="environment_status", native_enum=False),
        default=EnvironmentStatus.OPERATIONAL,
    )
    variables: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)

    project: Mapped["Project"] = relationship(back_populates="environments")  # noqa: F821
