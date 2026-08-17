from collections.abc import AsyncIterator
from dataclasses import dataclass

import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app import models  # noqa: F401
from app.auth.models import User
from app.core.security import hash_password
from app.db.base import Base
from app.environments.models import Environment
from app.organizations.models import Organization, OrganizationMember, OrganizationRole
from app.projects.models import Project


@pytest_asyncio.fixture
async def session() -> AsyncIterator[AsyncSession]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as database_session:
        yield database_session
    await engine.dispose()


@dataclass
class TenantData:
    user: User
    organization: Organization
    membership: OrganizationMember
    project: Project
    environment: Environment


@pytest_asyncio.fixture
async def tenant(session: AsyncSession) -> TenantData:
    user = User(
        email="owner@example.com",
        full_name="Owner User",
        password_hash=hash_password("a-secure-password"),
    )
    organization = Organization(name="Example", slug="example")
    session.add_all([user, organization])
    await session.flush()
    membership = OrganizationMember(
        organization_id=organization.id,
        user_id=user.id,
        role=OrganizationRole.OWNER,
    )
    project = Project(
        organization_id=organization.id,
        name="Primary API",
        slug="primary-api",
    )
    session.add_all([membership, project])
    await session.flush()
    environment = Environment(
        project_id=project.id,
        name="Production",
        slug="production",
    )
    session.add(environment)
    await session.flush()
    return TenantData(
        user=user,
        organization=organization,
        membership=membership,
        project=project,
        environment=environment,
    )


class FakeQueue:
    def __init__(self) -> None:
        self.jobs: list[tuple[str, tuple[object, ...], dict[str, object]]] = []

    async def enqueue_job(self, name: str, *args: object, **kwargs: object) -> None:
        self.jobs.append((name, args, kwargs))
