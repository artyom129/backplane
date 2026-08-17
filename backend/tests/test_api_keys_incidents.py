from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_credential, new_api_key
from app.endpoints.models import AuthenticationType, Endpoint, HTTPMethod
from app.incidents.models import Incident
from app.requests.models import RequestOutcome, RequestRecord
from app.requests.service import create_endpoint_incident_if_needed
from tests.conftest import TenantData


def test_api_keys_are_random_prefixed_and_hashed() -> None:
    raw, prefix, digest = new_api_key()
    assert raw.startswith("bp_live_")
    assert raw.startswith(prefix)
    assert digest == hash_credential(raw)
    assert raw not in digest


async def test_three_consecutive_5xx_requests_create_one_incident(
    session: AsyncSession,
    tenant: TenantData,
) -> None:
    endpoint = Endpoint(
        project_id=tenant.project.id,
        environment_id=tenant.environment.id,
        name="Failing API",
        base_url="https://api.example.com",
        method=HTTPMethod.GET,
        path="/health",
        headers={},
        authentication_type=AuthenticationType.NONE,
        timeout_seconds=5,
        tags=[],
    )
    session.add(endpoint)
    await session.flush()
    for status_code in (500, 502, 503):
        session.add(
            RequestRecord(
                organization_id=tenant.organization.id,
                project_id=tenant.project.id,
                environment_id=tenant.environment.id,
                endpoint_id=endpoint.id,
                actor_id=tenant.user.id,
                method="GET",
                url="https://api.example.com/health",
                request_headers={},
                status_code=status_code,
                response_headers={},
                response_size=0,
                duration_ms=10,
                outcome=RequestOutcome.ERROR,
                created_at=datetime.now(UTC),
            )
        )
        await session.flush()

    await create_endpoint_incident_if_needed(
        session,
        endpoint=endpoint,
        organization_id=tenant.organization.id,
    )
    await create_endpoint_incident_if_needed(
        session,
        endpoint=endpoint,
        organization_id=tenant.organization.id,
    )
    incidents = list(await session.scalars(select(Incident)))
    assert len(incidents) == 1
    assert incidents[0].source == "endpoint"
