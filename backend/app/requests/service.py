import base64
import json
import time
import uuid
from datetime import UTC, datetime
from urllib.parse import urljoin

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import publish_activity, record_action
from app.core.encryption import decrypt_value
from app.core.errors import NotFoundError
from app.core.network import validate_outbound_url
from app.endpoints.models import AuthenticationType, Endpoint
from app.incidents.models import (
    Incident,
    IncidentSeverity,
    IncidentStatus,
    IncidentTimelineEvent,
)
from app.requests.models import RequestOutcome, RequestRecord
from app.requests.schemas import ExecuteRequest

SENSITIVE_HEADERS = {"authorization", "proxy-authorization", "x-api-key", "api-key"}


def redact_headers(headers: dict[str, str]) -> dict[str, str]:
    return {
        key: "••••••••" if key.lower() in SENSITIVE_HEADERS else value
        for key, value in headers.items()
    }


def endpoint_auth_headers(endpoint: Endpoint) -> dict[str, str]:
    if not endpoint.encrypted_auth_config:
        return {}
    config = json.loads(decrypt_value(endpoint.encrypted_auth_config))
    if endpoint.authentication_type == AuthenticationType.BEARER:
        return {"Authorization": f"Bearer {config['token']}"}
    if endpoint.authentication_type == AuthenticationType.API_KEY:
        return {config.get("header_name", "X-API-Key"): config["value"]}
    if endpoint.authentication_type == AuthenticationType.BASIC:
        credentials = f"{config['username']}:{config['password']}"
        encoded = base64.b64encode(credentials.encode()).decode()
        return {"Authorization": f"Basic {encoded}"}
    return {}


async def create_endpoint_incident_if_needed(
    session: AsyncSession,
    *,
    endpoint: Endpoint,
    organization_id: uuid.UUID,
) -> None:
    recent = list(
        await session.scalars(
            select(RequestRecord)
            .where(RequestRecord.endpoint_id == endpoint.id)
            .order_by(RequestRecord.created_at.desc())
            .limit(3)
        )
    )
    if len(recent) < 3 or not all(
        request.status_code is not None and request.status_code >= 500 for request in recent
    ):
        return

    existing = await session.scalar(
        select(Incident.id).where(
            Incident.project_id == endpoint.project_id,
            Incident.source == "endpoint",
            Incident.source_id == str(endpoint.id),
            Incident.status != IncidentStatus.RESOLVED,
        )
    )
    if existing:
        return

    now = datetime.now(UTC)
    incident = Incident(
        project_id=endpoint.project_id,
        title=f"Repeated 5xx responses from {endpoint.name}",
        severity=IncidentSeverity.HIGH,
        status=IncidentStatus.OPEN,
        source="endpoint",
        source_id=str(endpoint.id),
        description="The endpoint returned a server error on three consecutive requests.",
    )
    session.add(incident)
    await session.flush()
    session.add(
        IncidentTimelineEvent(
            incident_id=incident.id,
            kind="incident.created",
            message="Incident created after three consecutive 5xx responses.",
            metadata_={"endpoint_id": str(endpoint.id)},
            created_at=now,
        )
    )
    await publish_activity(
        session,
        organization_id=organization_id,
        project_id=endpoint.project_id,
        kind="incident.created",
        title=incident.title,
        status="error",
        resource_id=str(incident.id),
    )


async def execute_request(
    session: AsyncSession,
    *,
    payload: ExecuteRequest,
    organization_id: uuid.UUID,
    project_id: uuid.UUID,
    environment_id: uuid.UUID,
    actor_id: uuid.UUID,
) -> RequestRecord:
    endpoint: Endpoint | None = None
    if payload.endpoint_id:
        endpoint = await session.scalar(
            select(Endpoint).where(
                Endpoint.id == payload.endpoint_id,
                Endpoint.project_id == project_id,
                Endpoint.environment_id == environment_id,
            )
        )
        if not endpoint:
            raise NotFoundError("endpoint_not_found", "Endpoint was not found.")

    method = payload.method or (endpoint.method if endpoint else None)
    if method is None:
        raise ValueError("HTTP method is required for an ad-hoc request")
    url = payload.url
    if not url and endpoint:
        url = urljoin(f"{endpoint.base_url}/", endpoint.path.lstrip("/"))
    assert url is not None
    validate_outbound_url(url)

    headers = dict(endpoint.headers if endpoint else {})
    if endpoint:
        headers.update(endpoint_auth_headers(endpoint))
    headers.update(payload.headers)
    timeout = endpoint.timeout_seconds if endpoint else 15.0

    started = time.perf_counter()
    status_code: int | None = None
    response_headers: dict[str, str] = {}
    response_body: object | None = None
    response_text: str | None = None
    response_size = 0
    error: str | None = None

    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(timeout),
            follow_redirects=False,
        ) as client:
            response = await client.request(
                method.value,
                url,
                headers=headers,
                params=payload.query,
                json=payload.body,
            )
        status_code = response.status_code
        response_headers = dict(response.headers)
        response_size = len(response.content)
        try:
            response_body = response.json()
        except json.JSONDecodeError:
            response_text = response.text[:65_536]
    except httpx.TimeoutException:
        error = f"Request timed out after {timeout:g} seconds."
    except httpx.RequestError as exc:
        error = f"Request failed: {exc.__class__.__name__}."

    duration_ms = round((time.perf_counter() - started) * 1000, 2)
    outcome = (
        RequestOutcome.SUCCESS
        if status_code is not None and status_code < 400
        else RequestOutcome.ERROR
    )
    record = RequestRecord(
        organization_id=organization_id,
        project_id=project_id,
        environment_id=environment_id,
        endpoint_id=endpoint.id if endpoint else None,
        actor_id=actor_id,
        method=method.value,
        url=url,
        request_headers=redact_headers(headers),
        request_body=payload.body,
        status_code=status_code,
        response_headers=response_headers,
        response_body=response_body,
        response_text=response_text,
        response_size=response_size,
        duration_ms=duration_ms,
        outcome=outcome,
        error=error,
        created_at=datetime.now(UTC),
    )
    session.add(record)
    await session.flush()
    await record_action(
        session,
        actor_id=actor_id,
        organization_id=organization_id,
        project_id=project_id,
        action="request.executed",
        resource_type="request",
        resource_id=str(record.id),
        metadata={"method": record.method, "status_code": status_code},
    )
    await publish_activity(
        session,
        organization_id=organization_id,
        project_id=project_id,
        kind="request.completed",
        title=f"{record.method} request completed",
        detail=f"{status_code or 'network error'} · {duration_ms:.0f} ms",
        status="success" if outcome == RequestOutcome.SUCCESS else "error",
        resource_id=str(record.id),
    )
    if endpoint and status_code is not None and status_code >= 500:
        await create_endpoint_incident_if_needed(
            session,
            endpoint=endpoint,
            organization_id=organization_id,
        )
    return record
