import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import RefreshSession
from app.auth.service import (
    authenticate_user,
    issue_token_pair,
    register_user,
    rotate_refresh_token,
)
from app.core.errors import AppError
from app.core.security import decode_token, verify_password
from app.organizations.models import OrganizationMember, OrganizationRole


async def test_register_hashes_password_and_creates_owner_membership(
    session: AsyncSession,
) -> None:
    user = await register_user(
        session,
        email="New.User@example.com",
        full_name="New User",
        password="correct-horse-battery",
        organization_name="New Company",
    )
    await session.commit()

    assert user.email == "new.user@example.com"
    assert user.password_hash != "correct-horse-battery"
    assert verify_password("correct-horse-battery", user.password_hash)
    membership = await session.scalar(
        select(OrganizationMember).where(OrganizationMember.user_id == user.id)
    )
    assert membership is not None
    assert membership.role == OrganizationRole.OWNER
    assert await authenticate_user(session, user.email, "correct-horse-battery") == user


async def test_refresh_token_is_rotated_and_cannot_be_reused(
    session: AsyncSession,
) -> None:
    user = await register_user(
        session,
        email="rotate@example.com",
        full_name="Rotate User",
        password="correct-horse-battery",
        organization_name="Rotate Company",
    )
    tokens = await issue_token_pair(session, user.id)
    await session.commit()

    replacement = await rotate_refresh_token(session, tokens.refresh_token)
    await session.commit()

    assert replacement.refresh_token != tokens.refresh_token
    assert decode_token(replacement.access_token, "access")["sub"] == str(user.id)
    sessions = list(
        await session.scalars(select(RefreshSession).order_by(RefreshSession.created_at))
    )
    assert len(sessions) == 2
    assert sessions[0].revoked_at is not None
    assert sessions[0].replaced_by_hash == sessions[1].token_hash

    with pytest.raises(AppError, match="no longer valid"):
        await rotate_refresh_token(session, tokens.refresh_token)
