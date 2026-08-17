import uuid

from fastapi import APIRouter, status
from sqlalchemy import select

from app.api.dependencies import (
    AdminOrganization,
    CurrentUser,
    OrganizationDep,
    SessionDep,
)
from app.audit.service import record_action
from app.auth.models import User
from app.core.errors import ConflictError, ForbiddenError, NotFoundError
from app.organizations.models import Organization, OrganizationMember, OrganizationRole
from app.organizations.schemas import (
    AddMemberRequest,
    MemberResponse,
    OrganizationResponse,
    UpdateMemberRequest,
    UpdateOrganizationRequest,
)

router = APIRouter(prefix="/organizations", tags=["Organizations"])


@router.get("", response_model=list[OrganizationResponse])
async def list_organizations(user: CurrentUser, session: SessionDep) -> list[OrganizationResponse]:
    rows = (
        await session.execute(
            select(Organization, OrganizationMember.role)
            .join(OrganizationMember)
            .where(OrganizationMember.user_id == user.id)
            .order_by(Organization.name)
        )
    ).all()
    return [
        OrganizationResponse(
            id=organization.id,
            name=organization.name,
            slug=organization.slug,
            role=role,
        )
        for organization, role in rows
    ]


@router.patch("/current", response_model=OrganizationResponse)
async def update_organization(
    payload: UpdateOrganizationRequest,
    context: AdminOrganization,
    user: CurrentUser,
    session: SessionDep,
) -> OrganizationResponse:
    context.organization.name = payload.name.strip()
    await record_action(
        session,
        actor_id=user.id,
        organization_id=context.organization.id,
        project_id=None,
        action="organization.updated",
        resource_type="organization",
        resource_id=str(context.organization.id),
    )
    await session.commit()
    return OrganizationResponse(
        id=context.organization.id,
        name=context.organization.name,
        slug=context.organization.slug,
        role=context.membership.role,
    )


@router.get("/members", response_model=list[MemberResponse])
async def list_members(
    context: OrganizationDep,
    session: SessionDep,
) -> list[MemberResponse]:
    rows = (
        await session.execute(
            select(OrganizationMember, User)
            .join(User, User.id == OrganizationMember.user_id)
            .where(OrganizationMember.organization_id == context.organization.id)
            .order_by(User.full_name)
        )
    ).all()
    return [
        MemberResponse(
            id=member.id,
            user_id=user.id,
            email=user.email,
            full_name=user.full_name,
            role=member.role,
        )
        for member, user in rows
    ]


@router.post("/members", response_model=MemberResponse, status_code=status.HTTP_201_CREATED)
async def add_member(
    payload: AddMemberRequest,
    context: AdminOrganization,
    actor: CurrentUser,
    session: SessionDep,
) -> MemberResponse:
    if payload.role == OrganizationRole.OWNER and context.membership.role != OrganizationRole.OWNER:
        raise ForbiddenError("Only an owner can grant the owner role.")
    user = await session.scalar(select(User).where(User.email == payload.email.lower()))
    if not user:
        raise NotFoundError(
            "user_not_found",
            "The user must create an account before being added to the organization.",
        )
    existing = await session.scalar(
        select(OrganizationMember.id).where(
            OrganizationMember.organization_id == context.organization.id,
            OrganizationMember.user_id == user.id,
        )
    )
    if existing:
        raise ConflictError("member_exists", "This user is already a member.")
    member = OrganizationMember(
        organization_id=context.organization.id,
        user_id=user.id,
        role=payload.role,
    )
    session.add(member)
    await session.flush()
    await record_action(
        session,
        actor_id=actor.id,
        organization_id=context.organization.id,
        project_id=None,
        action="member.added",
        resource_type="organization_member",
        resource_id=str(member.id),
        metadata={"role": payload.role.value, "email": user.email},
    )
    await session.commit()
    return MemberResponse(
        id=member.id,
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=member.role,
    )


@router.patch("/members/{member_id}", response_model=MemberResponse)
async def update_member(
    member_id: uuid.UUID,
    payload: UpdateMemberRequest,
    context: AdminOrganization,
    actor: CurrentUser,
    session: SessionDep,
) -> MemberResponse:
    member = await session.scalar(
        select(OrganizationMember).where(
            OrganizationMember.id == member_id,
            OrganizationMember.organization_id == context.organization.id,
        )
    )
    if not member:
        raise NotFoundError("member_not_found", "Organization member was not found.")
    if (
        member.role == OrganizationRole.OWNER or payload.role == OrganizationRole.OWNER
    ) and context.membership.role != OrganizationRole.OWNER:
        raise ForbiddenError("Only an owner can change owner memberships.")
    member.role = payload.role
    user = await session.get(User, member.user_id)
    await record_action(
        session,
        actor_id=actor.id,
        organization_id=context.organization.id,
        project_id=None,
        action="member.role_updated",
        resource_type="organization_member",
        resource_id=str(member.id),
        metadata={"role": payload.role.value},
    )
    await session.commit()
    assert user is not None
    return MemberResponse(
        id=member.id,
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=member.role,
    )
