import uuid

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.organizations.models import OrganizationRole


class OrganizationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    role: OrganizationRole


class MemberResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    email: EmailStr
    full_name: str
    role: OrganizationRole


class AddMemberRequest(BaseModel):
    email: EmailStr
    role: OrganizationRole = OrganizationRole.DEVELOPER


class UpdateMemberRequest(BaseModel):
    role: OrganizationRole


class UpdateOrganizationRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
