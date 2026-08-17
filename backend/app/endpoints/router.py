import json
import uuid

from fastapi import APIRouter, status
from sqlalchemy import select

from app.api.dependencies import (
    CurrentEnvironment,
    CurrentProject,
    CurrentUser,
    DeveloperOrganization,
    SessionDep,
)
from app.audit.service import record_action
from app.core.encryption import encrypt_value
from app.core.errors import NotFoundError
from app.core.network import validate_outbound_url
from app.endpoints.models import Endpoint
from app.endpoints.schemas import EndpointResponse, EndpointUpdate, EndpointWrite

router = APIRouter(prefix="/endpoints", tags=["Endpoints"])


def endpoint_response(endpoint: Endpoint) -> EndpointResponse:
    return EndpointResponse(
        id=endpoint.id,
        project_id=endpoint.project_id,
        environment_id=endpoint.environment_id,
        name=endpoint.name,
        base_url=endpoint.base_url,
        method=endpoint.method,
        path=endpoint.path,
        headers=endpoint.headers,
        authentication_type=endpoint.authentication_type,
        has_auth_config=endpoint.encrypted_auth_config is not None,
        timeout_seconds=endpoint.timeout_seconds,
        tags=endpoint.tags,
        created_at=endpoint.created_at,
        updated_at=endpoint.updated_at,
    )


@router.get("", response_model=list[EndpointResponse])
async def list_endpoints(
    environment: CurrentEnvironment,
    session: SessionDep,
) -> list[EndpointResponse]:
    endpoints = await session.scalars(
        select(Endpoint).where(Endpoint.environment_id == environment.id).order_by(Endpoint.name)
    )
    return [endpoint_response(endpoint) for endpoint in endpoints]


@router.post("", response_model=EndpointResponse, status_code=status.HTTP_201_CREATED)
async def create_endpoint(
    payload: EndpointWrite,
    environment: CurrentEnvironment,
    project: CurrentProject,
    context: DeveloperOrganization,
    user: CurrentUser,
    session: SessionDep,
) -> EndpointResponse:
    validate_outbound_url(payload.base_url)
    endpoint = Endpoint(
        project_id=project.id,
        environment_id=environment.id,
        name=payload.name.strip(),
        base_url=payload.base_url.rstrip("/"),
        method=payload.method,
        path=payload.path,
        headers=payload.headers,
        authentication_type=payload.authentication_type,
        encrypted_auth_config=(
            encrypt_value(json.dumps(payload.auth_config)) if payload.auth_config else None
        ),
        timeout_seconds=payload.timeout_seconds,
        tags=sorted(set(payload.tags)),
    )
    session.add(endpoint)
    await session.flush()
    await record_action(
        session,
        actor_id=user.id,
        organization_id=context.organization.id,
        project_id=project.id,
        action="endpoint.created",
        resource_type="endpoint",
        resource_id=str(endpoint.id),
        metadata={"name": endpoint.name, "method": endpoint.method.value},
    )
    await session.commit()
    return endpoint_response(endpoint)


@router.patch("/{endpoint_id}", response_model=EndpointResponse)
async def update_endpoint(
    endpoint_id: uuid.UUID,
    payload: EndpointUpdate,
    environment: CurrentEnvironment,
    project: CurrentProject,
    context: DeveloperOrganization,
    user: CurrentUser,
    session: SessionDep,
) -> EndpointResponse:
    endpoint = await session.scalar(
        select(Endpoint).where(
            Endpoint.id == endpoint_id,
            Endpoint.environment_id == environment.id,
        )
    )
    if not endpoint:
        raise NotFoundError("endpoint_not_found", "Endpoint was not found.")
    if payload.base_url:
        validate_outbound_url(payload.base_url)
    for field in payload.model_fields_set - {"auth_config"}:
        value = getattr(payload, field)
        if value is not None:
            setattr(endpoint, field, value)
    if "auth_config" in payload.model_fields_set:
        endpoint.encrypted_auth_config = (
            encrypt_value(json.dumps(payload.auth_config)) if payload.auth_config else None
        )
    await record_action(
        session,
        actor_id=user.id,
        organization_id=context.organization.id,
        project_id=project.id,
        action="endpoint.updated",
        resource_type="endpoint",
        resource_id=str(endpoint.id),
        metadata={"fields": sorted(payload.model_fields_set)},
    )
    await session.commit()
    return endpoint_response(endpoint)


@router.delete("/{endpoint_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_endpoint(
    endpoint_id: uuid.UUID,
    environment: CurrentEnvironment,
    _: DeveloperOrganization,
    session: SessionDep,
) -> None:
    endpoint = await session.scalar(
        select(Endpoint).where(
            Endpoint.id == endpoint_id,
            Endpoint.environment_id == environment.id,
        )
    )
    if not endpoint:
        raise NotFoundError("endpoint_not_found", "Endpoint was not found.")
    await session.delete(endpoint)
    await session.commit()
