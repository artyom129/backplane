import uuid

from fastapi import APIRouter, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import (
    CurrentEnvironment,
    CurrentProject,
    CurrentUser,
    DeveloperOrganization,
    SessionDep,
)
from app.audit.service import record_action
from app.core.encryption import encrypt_value
from app.core.errors import ConflictError, NotFoundError
from app.secrets.models import Secret
from app.secrets.schemas import SecretCreate, SecretResponse, SecretRotate

router = APIRouter(prefix="/secrets", tags=["Secrets"])


@router.get("", response_model=list[SecretResponse])
async def list_secrets(
    environment: CurrentEnvironment,
    session: SessionDep,
) -> list[Secret]:
    return list(
        await session.scalars(
            select(Secret).where(Secret.environment_id == environment.id).order_by(Secret.name)
        )
    )


@router.post("", response_model=SecretResponse, status_code=status.HTTP_201_CREATED)
async def create_secret(
    payload: SecretCreate,
    environment: CurrentEnvironment,
    project: CurrentProject,
    context: DeveloperOrganization,
    user: CurrentUser,
    session: SessionDep,
) -> Secret:
    secret = Secret(
        organization_id=context.organization.id,
        project_id=project.id,
        environment_id=environment.id,
        name=payload.name,
        encrypted_value=encrypt_value(payload.value),
    )
    session.add(secret)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise ConflictError("secret_exists", "A secret with this name already exists.") from exc
    await record_action(
        session,
        actor_id=user.id,
        organization_id=context.organization.id,
        project_id=project.id,
        action="secret.created",
        resource_type="secret",
        resource_id=str(secret.id),
        metadata={"name": secret.name, "environment_id": str(environment.id)},
    )
    await session.commit()
    return secret


@router.post("/{secret_id}/rotate", response_model=SecretResponse)
async def rotate_secret(
    secret_id: uuid.UUID,
    payload: SecretRotate,
    environment: CurrentEnvironment,
    project: CurrentProject,
    context: DeveloperOrganization,
    user: CurrentUser,
    session: SessionDep,
) -> Secret:
    secret = await session.scalar(
        select(Secret).where(
            Secret.id == secret_id,
            Secret.environment_id == environment.id,
        )
    )
    if not secret:
        raise NotFoundError("secret_not_found", "Secret was not found.")
    secret.encrypted_value = encrypt_value(payload.value)
    secret.version += 1
    await record_action(
        session,
        actor_id=user.id,
        organization_id=context.organization.id,
        project_id=project.id,
        action="secret.rotated",
        resource_type="secret",
        resource_id=str(secret.id),
        metadata={"name": secret.name, "version": secret.version},
    )
    await session.commit()
    return secret


@router.delete("/{secret_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_secret(
    secret_id: uuid.UUID,
    environment: CurrentEnvironment,
    project: CurrentProject,
    context: DeveloperOrganization,
    user: CurrentUser,
    session: SessionDep,
) -> None:
    secret = await session.scalar(
        select(Secret).where(
            Secret.id == secret_id,
            Secret.environment_id == environment.id,
        )
    )
    if not secret:
        raise NotFoundError("secret_not_found", "Secret was not found.")
    await record_action(
        session,
        actor_id=user.id,
        organization_id=context.organization.id,
        project_id=project.id,
        action="secret.deleted",
        resource_type="secret",
        resource_id=str(secret.id),
        metadata={"name": secret.name},
    )
    await session.delete(secret)
    await session.commit()
