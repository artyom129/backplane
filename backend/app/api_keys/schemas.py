import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

ALLOWED_SCOPES = {
    "requests:read",
    "requests:write",
    "webhooks:read",
    "webhooks:write",
    "jobs:read",
    "jobs:write",
}


class APIKeyCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    scopes: list[str] = Field(min_length=1)

    @classmethod
    def validate_scopes(cls, scopes: list[str]) -> list[str]:
        invalid = set(scopes) - ALLOWED_SCOPES
        if invalid:
            raise ValueError(f"Unknown scopes: {', '.join(sorted(invalid))}")
        return sorted(set(scopes))


class APIKeyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    prefix: str
    scopes: list[str]
    created_at: datetime
    last_used_at: datetime | None
    expires_at: datetime | None
    revoked_at: datetime | None


class APIKeyCreated(APIKeyResponse):
    key: str
