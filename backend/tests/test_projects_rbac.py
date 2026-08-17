import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import OrganizationContext, get_current_project, require_role
from app.core.errors import ForbiddenError, NotFoundError
from app.organizations.models import Organization, OrganizationRole
from app.projects.models import Project
from tests.conftest import TenantData


async def test_role_dependency_enforces_minimum_role(tenant: TenantData) -> None:
    tenant.membership.role = OrganizationRole.VIEWER
    context = OrganizationContext(
        organization=tenant.organization,
        membership=tenant.membership,
    )
    dependency = require_role(OrganizationRole.DEVELOPER)

    with pytest.raises(ForbiddenError):
        await dependency(context)

    tenant.membership.role = OrganizationRole.ADMIN
    assert await dependency(context) == context


async def test_project_lookup_is_scoped_to_organization(
    session: AsyncSession,
    tenant: TenantData,
) -> None:
    other_organization = Organization(name="Other", slug="other")
    session.add(other_organization)
    await session.flush()
    foreign_project = Project(
        organization_id=other_organization.id,
        name="Foreign",
        slug="foreign",
    )
    session.add(foreign_project)
    await session.flush()
    context = OrganizationContext(
        organization=tenant.organization,
        membership=tenant.membership,
    )

    found = await get_current_project(session, context, tenant.project.id)
    assert found.id == tenant.project.id
    with pytest.raises(NotFoundError):
        await get_current_project(session, context, foreign_project.id)
    with pytest.raises(NotFoundError):
        await get_current_project(session, context, uuid.uuid4())
