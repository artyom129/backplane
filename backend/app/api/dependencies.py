import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Header, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api_keys.models import APIKey
from app.auth.models import User
from app.core.errors import AppError, ForbiddenError, NotFoundError
from app.core.security import decode_token, hash_credential
from app.core.time import as_utc
from app.db.session import get_session
from app.environments.models import Environment
from app.organizations.models import Organization, OrganizationMember, OrganizationRole
from app.projects.models import Project

bearer_scheme = HTTPBearer(auto_error=False)
type SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def get_current_user(
    request: Request,
    session: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> User:
    if not credentials:
        raise AppError("not_authenticated", "Authentication is required.", 401)
    credential = credentials.credentials
    if credential.startswith("bp_live_"):
        api_key = await session.scalar(
            select(APIKey).where(APIKey.key_hash == hash_credential(credential))
        )
        now = datetime.now(UTC)
        if (
            not api_key
            or api_key.revoked_at is not None
            or (api_key.expires_at is not None and as_utc(api_key.expires_at) <= now)
        ):
            raise AppError("invalid_api_key", "The API key is invalid or revoked.", 401)
        scope = required_api_key_scope(request)
        if scope is None or scope not in api_key.scopes:
            raise ForbiddenError("The API key does not include the required scope.")
        request.state.api_key_organization_id = api_key.organization_id
        api_key.last_used_at = now
        user = await session.get(User, api_key.created_by_id)
        await session.commit()
        if not user or not user.is_active:
            raise AppError("not_authenticated", "The API key owner is unavailable.", 401)
        return user

    payload = decode_token(credential, "access")
    user = await session.get(User, uuid.UUID(payload["sub"]))
    if not user or not user.is_active:
        raise AppError("not_authenticated", "The account is unavailable.", 401)
    return user


def required_api_key_scope(request: Request) -> str | None:
    path = request.url.path
    operation = "read" if request.method == "GET" else "write"
    if path.startswith("/api/v1/requests"):
        return f"requests:{operation}"
    if path.startswith("/api/v1/webhooks"):
        return f"webhooks:{operation}"
    if path.startswith("/api/v1/jobs") or path.startswith("/api/v1/scheduled-jobs"):
        return f"jobs:{operation}"
    return None


type CurrentUser = Annotated[User, Depends(get_current_user)]


@dataclass(frozen=True)
class OrganizationContext:
    organization: Organization
    membership: OrganizationMember


async def get_organization_context(
    request: Request,
    session: SessionDep,
    user: CurrentUser,
    organization_id: Annotated[uuid.UUID, Header(alias="X-Organization-ID")],
) -> OrganizationContext:
    key_organization_id = getattr(request.state, "api_key_organization_id", None)
    if key_organization_id is not None and key_organization_id != organization_id:
        raise ForbiddenError("The API key belongs to a different organization.")
    row = (
        await session.execute(
            select(Organization, OrganizationMember)
            .join(
                OrganizationMember,
                OrganizationMember.organization_id == Organization.id,
            )
            .where(
                Organization.id == organization_id,
                OrganizationMember.user_id == user.id,
            )
        )
    ).one_or_none()
    if not row:
        raise NotFoundError("organization_not_found", "Organization was not found.")
    organization, membership = row
    return OrganizationContext(organization=organization, membership=membership)


type OrganizationDep = Annotated[OrganizationContext, Depends(get_organization_context)]


ROLE_RANK = {
    OrganizationRole.VIEWER: 0,
    OrganizationRole.DEVELOPER: 1,
    OrganizationRole.ADMIN: 2,
    OrganizationRole.OWNER: 3,
}


def require_role(minimum: OrganizationRole):
    async def check(context: OrganizationDep) -> OrganizationContext:
        if ROLE_RANK[context.membership.role] < ROLE_RANK[minimum]:
            raise ForbiddenError()
        return context

    return check


type DeveloperOrganization = Annotated[
    OrganizationContext,
    Depends(require_role(OrganizationRole.DEVELOPER)),
]
type AdminOrganization = Annotated[
    OrganizationContext,
    Depends(require_role(OrganizationRole.ADMIN)),
]


async def get_current_project(
    session: SessionDep,
    context: OrganizationDep,
    project_id: Annotated[uuid.UUID, Header(alias="X-Project-ID")],
) -> Project:
    project = await session.scalar(
        select(Project).where(
            Project.id == project_id,
            Project.organization_id == context.organization.id,
        )
    )
    if not project:
        raise NotFoundError("project_not_found", "Project was not found.")
    return project


type CurrentProject = Annotated[Project, Depends(get_current_project)]


async def get_current_environment(
    session: SessionDep,
    project: CurrentProject,
    environment_id: Annotated[uuid.UUID, Header(alias="X-Environment-ID")],
) -> Environment:
    environment = await session.scalar(
        select(Environment).where(
            Environment.id == environment_id,
            Environment.project_id == project.id,
        )
    )
    if not environment:
        raise NotFoundError("environment_not_found", "Environment was not found.")
    return environment


type CurrentEnvironment = Annotated[Environment, Depends(get_current_environment)]
