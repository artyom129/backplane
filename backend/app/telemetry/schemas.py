from datetime import datetime

from pydantic import BaseModel


class DashboardStats(BaseModel):
    requests_24h: int
    success_rate: float | None
    average_latency_ms: float | None
    failed_deliveries: int
    active_incidents: int
    jobs_running: int


class RequestMetricPoint(BaseModel):
    timestamp: datetime
    requests: int
    errors: int
    average_latency_ms: float


class HealthComponent(BaseModel):
    name: str
    status: str
    detail: str


class DashboardResponse(BaseModel):
    stats: DashboardStats
    request_activity: list[RequestMetricPoint]
    health: list[HealthComponent]
