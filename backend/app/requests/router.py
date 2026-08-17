import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select

from app.api.dependencies import (
    CurrentEnvironment,
    CurrentProject,
    CurrentUser,
    DeveloperOrganization,
    SessionDep,
)
from app.core.errors import NotFoundError
from app.core.pagination import Page, PageParams, pagination_params
from app.requests.models import RequestOutcome, RequestRecord
from app.requests.schemas import ExecuteRequest, RequestListItem, RequestResponse
from app.requests.service import execute_request

router = APIRouter(prefix="/requests", tags=["Requests"])


@router.post("/execute", response_model=RequestResponse, status_code=status.HTTP_201_CREATED)
async def run_request(
    payload: ExecuteRequest,
    environment: CurrentEnvironment,
    project: CurrentProject,
    context: DeveloperOrganization,
    user: CurrentUser,
    session: SessionDep,
) -> RequestRecord:
    record = await execute_request(
        session,
        payload=payload,
        organization_id=context.organization.id,
        project_id=project.id,
        environment_id=environment.id,
        actor_id=user.id,
    )
    await session.commit()
    return record


@router.get("", response_model=Page[RequestListItem])
async def list_requests(
    project: CurrentProject,
    session: SessionDep,
    params: Annotated[PageParams, Depends(pagination_params)],
    outcome: Annotated[RequestOutcome | None, Query()] = None,
    environment_id: Annotated[uuid.UUID | None, Query()] = None,
) -> Page[RequestListItem]:
    filters = [RequestRecord.project_id == project.id]
    if outcome:
        filters.append(RequestRecord.outcome == outcome)
    if environment_id:
        filters.append(RequestRecord.environment_id == environment_id)
    total = await session.scalar(select(func.count()).select_from(RequestRecord).where(*filters))
    items = list(
        await session.scalars(
            select(RequestRecord)
            .where(*filters)
            .order_by(RequestRecord.created_at.desc())
            .offset(params.offset)
            .limit(params.page_size)
        )
    )
    return Page[RequestListItem].from_items(
        [RequestListItem.model_validate(item) for item in items],
        total or 0,
        params,
    )


@router.get("/{request_id}", response_model=RequestResponse)
async def get_request(
    request_id: uuid.UUID,
    project: CurrentProject,
    session: SessionDep,
) -> RequestRecord:
    record = await session.scalar(
        select(RequestRecord).where(
            RequestRecord.id == request_id,
            RequestRecord.project_id == project.id,
        )
    )
    if not record:
        raise NotFoundError("request_not_found", "Request was not found.")
    return record
