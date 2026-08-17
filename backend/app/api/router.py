from fastapi import APIRouter

from app.api_keys.router import router as api_keys_router
from app.audit.router import router as audit_router
from app.auth.router import router as auth_router
from app.endpoints.router import router as endpoints_router
from app.environments.router import router as environments_router
from app.incidents.router import router as incidents_router
from app.jobs.router import router as jobs_router
from app.organizations.router import router as organizations_router
from app.projects.router import router as projects_router
from app.requests.router import router as requests_router
from app.secrets.router import router as secrets_router
from app.telemetry.router import router as telemetry_router
from app.webhooks.router import router as webhooks_router

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(organizations_router)
api_router.include_router(projects_router)
api_router.include_router(environments_router)
api_router.include_router(endpoints_router)
api_router.include_router(requests_router)
api_router.include_router(webhooks_router)
api_router.include_router(jobs_router)
api_router.include_router(incidents_router)
api_router.include_router(secrets_router)
api_router.include_router(api_keys_router)
api_router.include_router(audit_router)
api_router.include_router(telemetry_router)
