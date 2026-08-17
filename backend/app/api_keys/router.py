import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, status
from sqlalchemy import select

from app.api.dependencies import AdminOrganization, CurrentUser, OrganizationDep, SessionDep
from app.api_keys.models import APIKey
from app.api_keys.schemas import APIKeyCreate, APIKeyCreated, APIKeyResponse
from app.audit.service import publish_activity, record_action
from app.core.errors import NotFoundError
from app.core.security import new_api_key

router = APIRouter(prefix="/api-keys", tags=["API Keys"])


@router.get("", response_model=list[APIKeyResponse])
async def list_api_keys(
    context: OrganizationDep,
    session: SessionDep,
) -> list[APIKey]:
    return list(
        await session.scalars(
            select(APIKey)
            .where(APIKey.organization_id == context.organization.id)
            .order_by(APIKey.created_at.desc())
        )
    )


@router.post("", response_model=APIKeyCreated, status_code=status.HTTP_201_CREATED)
async def create_api_key(
    payload: APIKeyCreate,
    context: AdminOrganization,
    user: CurrentUser,
    session: SessionDep,
) -> APIKeyCreated:
    scopes = APIKeyCreate.validate_scopes(payload.scopes)
    raw, prefix, key_hash = new_api_key()
    key = APIKey(
        organization_id=context.organization.id,
        created_by_id=user.id,
        name=payload.name.strip(),
        prefix=prefix,
        key_hash=key_hash,
        scopes=scopes,
    )
    session.add(key)
    await session.flush()
    await record_action(
        session,
        actor_id=user.id,
        organization_id=context.organization.id,
        project_id=None,
        action="api_key.created",
        resource_type="api_key",
        resource_id=str(key.id),
        metadata={"name": key.name, "scopes": scopes},
    )
    await publish_activity(
        session,
        organization_id=context.organization.id,
        project_id=None,
        kind="api_key.created",
        title=f"API key {key.name} created",
        resource_id=str(key.id),
    )
    await session.commit()
    return APIKeyCreated(
        **APIKeyResponse.model_validate(key).model_dump(),
        key=raw,
    )


@router.post("/{key_id}/revoke", response_model=APIKeyResponse)
async def revoke_api_key(
    key_id: uuid.UUID,
    context: AdminOrganization,
    user: CurrentUser,
    session: SessionDep,
) -> APIKey:
    key = await session.scalar(
        select(APIKey).where(
            APIKey.id == key_id,
            APIKey.organization_id == context.organization.id,
        )
    )
    if not key:
        raise NotFoundError("api_key_not_found", "API key was not found.")
    if key.revoked_at is None:
        key.revoked_at = datetime.now(UTC)
        await record_action(
            session,
            actor_id=user.id,
            organization_id=context.organization.id,
            project_id=None,
            action="api_key.revoked",
            resource_type="api_key",
            resource_id=str(key.id),
            metadata={"name": key.name},
        )
        await session.commit()
    return key
