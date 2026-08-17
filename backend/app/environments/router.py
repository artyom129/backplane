import uuid

from fastapi import APIRouter, status
from sqlalchemy import select

from app.api.dependencies import CurrentProject, CurrentUser, DeveloperOrganization, SessionDep
from app.audit.service import publish_activity, record_action
from app.auth.service import slugify
from app.core.errors import ConflictError, NotFoundError
from app.environments.models import Environment
from app.environments.schemas import EnvironmentCreate, EnvironmentResponse, EnvironmentUpdate

router = APIRouter(prefix="/environments", tags=["Environments"])


@router.get("", response_model=list[EnvironmentResponse])
async def list_environments(
    project: CurrentProject,
    session: SessionDep,
) -> list[Environment]:
    return list(
        await session.scalars(
            select(Environment)
            .where(Environment.project_id == project.id)
            .order_by(Environment.name)
        )
    )


@router.post("", response_model=EnvironmentResponse, status_code=status.HTTP_201_CREATED)
async def create_environment(
    payload: EnvironmentCreate,
    project: CurrentProject,
    context: DeveloperOrganization,
    user: CurrentUser,
    session: SessionDep,
) -> Environment:
    slug = slugify(payload.name)
    if await session.scalar(
        select(Environment.id).where(
            Environment.project_id == project.id,
            Environment.slug == slug,
        )
    ):
        raise ConflictError("environment_slug_taken", "This environment already exists.")
    environment = Environment(
        project_id=project.id,
        name=payload.name.strip(),
        slug=slug,
        variables=payload.variables,
    )
    session.add(environment)
    await session.flush()
    await record_action(
        session,
        actor_id=user.id,
        organization_id=context.organization.id,
        project_id=project.id,
        action="environment.created",
        resource_type="environment",
        resource_id=str(environment.id),
    )
    await session.commit()
    return environment


@router.patch("/{environment_id}", response_model=EnvironmentResponse)
async def update_environment(
    environment_id: uuid.UUID,
    payload: EnvironmentUpdate,
    project: CurrentProject,
    context: DeveloperOrganization,
    user: CurrentUser,
    session: SessionDep,
) -> Environment:
    environment = await session.scalar(
        select(Environment).where(
            Environment.id == environment_id,
            Environment.project_id == project.id,
        )
    )
    if not environment:
        raise NotFoundError("environment_not_found", "Environment was not found.")
    for field in payload.model_fields_set:
        value = getattr(payload, field)
        if value is not None:
            setattr(environment, field, value)
    await record_action(
        session,
        actor_id=user.id,
        organization_id=context.organization.id,
        project_id=project.id,
        action="environment.updated",
        resource_type="environment",
        resource_id=str(environment.id),
        metadata={"fields": sorted(payload.model_fields_set)},
    )
    await publish_activity(
        session,
        organization_id=context.organization.id,
        project_id=project.id,
        kind="environment.updated",
        title=f"{environment.name} environment updated",
        resource_id=str(environment.id),
    )
    await session.commit()
    return environment


@router.delete("/{environment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_environment(
    environment_id: uuid.UUID,
    project: CurrentProject,
    _: DeveloperOrganization,
    session: SessionDep,
) -> None:
    environment = await session.scalar(
        select(Environment).where(
            Environment.id == environment_id,
            Environment.project_id == project.id,
        )
    )
    if not environment:
        raise NotFoundError("environment_not_found", "Environment was not found.")
    await session.delete(environment)
    await session.commit()
