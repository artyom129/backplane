import uuid
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from croniter import croniter
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.jobs.models import JobStatus


class JobCreate(BaseModel):
    type: str = Field(pattern=r"^(endpoint\.check|webhook\.replay)$")
    payload: dict[str, object]
    max_attempts: int = Field(default=3, ge=1, le=5)


class JobListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    type: str
    status: JobStatus
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    attempts: int
    max_attempts: int
    error: str | None


class JobDetail(JobListItem):
    environment_id: uuid.UUID
    payload: dict[str, object]
    result: object | None


class ScheduledJobCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    cron_expression: str = Field(max_length=80)
    timezone: str = "UTC"
    action: dict[str, object]
    enabled: bool = True

    @field_validator("cron_expression")
    @classmethod
    def valid_cron(cls, value: str) -> str:
        if not croniter.is_valid(value):
            raise ValueError("Invalid cron expression")
        return value

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("Unknown timezone") from exc
        return value


class ScheduledJobUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    cron_expression: str | None = Field(default=None, max_length=80)
    timezone: str | None = None
    action: dict[str, object] | None = None
    enabled: bool | None = None

    @field_validator("cron_expression")
    @classmethod
    def valid_cron(cls, value: str | None) -> str | None:
        if value is not None and not croniter.is_valid(value):
            raise ValueError("Invalid cron expression")
        return value

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str | None) -> str | None:
        if value:
            try:
                ZoneInfo(value)
            except ZoneInfoNotFoundError as exc:
                raise ValueError("Unknown timezone") from exc
        return value


class ScheduledJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    cron_expression: str
    timezone: str
    action: dict[str, object]
    enabled: bool
    last_run_at: datetime | None
    next_run_at: datetime
    last_status: JobStatus | None
    created_at: datetime
