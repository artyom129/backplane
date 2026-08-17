import uuid

from fastapi import APIRouter, status
from sqlalchemy import select

from app.api.dependencies import (
    CurrentUser,
    DeveloperOrganization,
    OrganizationDep,
    SessionDep,
)
from app.audit.service import publish_activity, record_action
from app.auth.service import slugify
from app.core.errors import ConflictError, NotFoundError
from app.environments.models import Environment
from app.projects.models import Project
from app.projects.schemas import ProjectCreate, ProjectResponse, ProjectUpdate

router = APIRouter(prefix="/projects", tags=["Projects"])


@router.get("", response_model=list[ProjectResponse])
async def list_projects(
    context: OrganizationDep,
    session: SessionDep,
) -> list[Project]:
    return list(
        await session.scalars(
            select(Project)
            .where(Project.organization_id == context.organization.id)
            .order_by(Project.name)
        )
    )


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreate,
    context: DeveloperOrganization,
    user: CurrentUser,
    session: SessionDep,
) -> Project:
    slug = slugify(payload.name)
    exists = await session.scalar(
        select(Project.id).where(
            Project.organization_id == context.organization.id,
            Project.slug == slug,
        )
    )
    if exists:
        raise ConflictError("project_slug_taken", "A project with a similar name already exists.")
    project = Project(
        organization_id=context.organization.id,
        name=payload.name.strip(),
        slug=slug,
        description=payload.description,
    )
    session.add(project)
    await session.flush()
    if payload.create_default_environments:
        session.add_all(
            [
                Environment(project_id=project.id, name="Development", slug="development"),
                Environment(project_id=project.id, name="Staging", slug="staging"),
                Environment(project_id=project.id, name="Production", slug="production"),
            ]
        )
    await record_action(
        session,
        actor_id=user.id,
        organization_id=context.organization.id,
        project_id=project.id,
        action="project.created",
        resource_type="project",
        resource_id=str(project.id),
    )
    await publish_activity(
        session,
        organization_id=context.organization.id,
        project_id=project.id,
        kind="project.created",
        title=f"Project {project.name} created",
        resource_id=str(project.id),
    )
    await session.commit()
    return project


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: uuid.UUID,
    payload: ProjectUpdate,
    context: DeveloperOrganization,
    user: CurrentUser,
    session: SessionDep,
) -> Project:
    project = await session.scalar(
        select(Project).where(
            Project.id == project_id,
            Project.organization_id == context.organization.id,
        )
    )
    if not project:
        raise NotFoundError("project_not_found", "Project was not found.")
    if payload.name is not None:
        project.name = payload.name.strip()
    if "description" in payload.model_fields_set:
        project.description = payload.description
    await record_action(
        session,
        actor_id=user.id,
        organization_id=context.organization.id,
        project_id=project.id,
        action="project.updated",
        resource_type="project",
        resource_id=str(project.id),
    )
    await session.commit()
    return project


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: uuid.UUID,
    context: DeveloperOrganization,
    session: SessionDep,
) -> None:
    project = await session.scalar(
        select(Project).where(
            Project.id == project_id,
            Project.organization_id == context.organization.id,
        )
    )
    if not project:
        raise NotFoundError("project_not_found", "Project was not found.")
    await session.delete(project)
    await session.commit()
