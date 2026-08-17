import re
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import RefreshSession, User
from app.auth.schemas import MembershipSummary, TokenPair, UserResponse
from app.config import settings
from app.core.errors import AppError, ConflictError
from app.core.security import (
    create_token,
    decode_token,
    hash_credential,
    hash_password,
    verify_password,
)
from app.core.time import as_utc
from app.organizations.models import Organization, OrganizationMember, OrganizationRole


def slugify(value: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return value[:70] or "workspace"


async def register_user(
    session: AsyncSession,
    *,
    email: str,
    full_name: str,
    password: str,
    organization_name: str,
) -> User:
    normalized_email = email.strip().lower()
    existing = await session.scalar(select(User.id).where(User.email == normalized_email))
    if existing:
        raise ConflictError("email_taken", "An account with this email already exists.")

    base_slug = slugify(organization_name)
    slug = base_slug
    suffix = 1
    while await session.scalar(select(Organization.id).where(Organization.slug == slug)):
        suffix += 1
        slug = f"{base_slug}-{suffix}"

    user = User(
        email=normalized_email,
        full_name=full_name.strip(),
        password_hash=hash_password(password),
    )
    organization = Organization(name=organization_name.strip(), slug=slug)
    session.add_all([user, organization])
    await session.flush()
    session.add(
        OrganizationMember(
            organization_id=organization.id,
            user_id=user.id,
            role=OrganizationRole.OWNER,
        )
    )
    await session.flush()
    return user


async def authenticate_user(
    session: AsyncSession,
    email: str,
    password: str,
) -> User:
    user = await session.scalar(select(User).where(User.email == email.strip().lower()))
    if not user or not user.is_active or not verify_password(password, user.password_hash):
        raise AppError("invalid_credentials", "Email or password is incorrect.", 401)
    return user


async def issue_token_pair(session: AsyncSession, user_id: uuid.UUID) -> TokenPair:
    access_token, _, _ = create_token(
        user_id,
        "access",
        timedelta(minutes=settings.access_token_minutes),
    )
    refresh_token, refresh_id, refresh_expires = create_token(
        user_id,
        "refresh",
        timedelta(days=settings.refresh_token_days),
    )
    session.add(
        RefreshSession(
            user_id=user_id,
            token_hash=hash_credential(refresh_id),
            expires_at=refresh_expires,
            created_at=datetime.now(UTC),
        )
    )
    return TokenPair(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.access_token_minutes * 60,
    )


async def rotate_refresh_token(session: AsyncSession, token: str) -> TokenPair:
    payload = decode_token(token, "refresh")
    token_hash = hash_credential(payload["jti"])
    refresh_session = await session.scalar(
        select(RefreshSession).where(RefreshSession.token_hash == token_hash).with_for_update()
    )
    now = datetime.now(UTC)
    if (
        not refresh_session
        or refresh_session.revoked_at is not None
        or as_utc(refresh_session.expires_at) <= now
    ):
        raise AppError("refresh_token_reused", "This refresh token is no longer valid.", 401)

    user_id = uuid.UUID(payload["sub"])
    tokens = await issue_token_pair(session, user_id)
    new_payload = decode_token(tokens.refresh_token, "refresh")
    refresh_session.revoked_at = now
    refresh_session.replaced_by_hash = hash_credential(new_payload["jti"])
    return tokens


async def revoke_refresh_token(session: AsyncSession, token: str) -> None:
    payload = decode_token(token, "refresh")
    refresh_session = await session.scalar(
        select(RefreshSession).where(RefreshSession.token_hash == hash_credential(payload["jti"]))
    )
    if refresh_session and refresh_session.revoked_at is None:
        refresh_session.revoked_at = datetime.now(UTC)


async def user_response(session: AsyncSession, user: User) -> UserResponse:
    rows = (
        await session.execute(
            select(OrganizationMember, Organization)
            .join(Organization, Organization.id == OrganizationMember.organization_id)
            .where(OrganizationMember.user_id == user.id)
            .order_by(Organization.name)
        )
    ).all()
    memberships = [
        MembershipSummary(
            organization_id=organization.id,
            organization_name=organization.name,
            organization_slug=organization.slug,
            role=member.role,
        )
        for member, organization in rows
    ]
    return UserResponse(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        created_at=user.created_at,
        memberships=memberships,
    )
