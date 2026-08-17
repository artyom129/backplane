import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class SecretCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160, pattern=r"^[A-Z][A-Z0-9_]*$")
    value: str = Field(min_length=1, max_length=16_384)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return value.upper()


class SecretRotate(BaseModel):
    value: str = Field(min_length=1, max_length=16_384)


class SecretResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    environment_id: uuid.UUID
    name: str
    version: int
    created_at: datetime
    updated_at: datetime
