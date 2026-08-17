export type Role = "owner" | "admin" | "developer" | "viewer";
export type StatusTone = "success" | "error" | "warning" | "neutral" | "info";

export interface Membership {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  role: Role;
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  created_at: string;
  memberships: Membership[];
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface AuthResponse {
  user: User;
  tokens: Tokens;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  role: Role;
}

export interface OrganizationMember {
  id: string;
  user_id: string;
  email: string;
  full_name: string;
  role: Role;
}

export interface Project {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description: string | null;
  created_at: string;
}

export interface Environment {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  status: "operational" | "degraded" | "disabled";
  variables: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface Endpoint {
  id: string;
  project_id: string;
  environment_id: string;
  name: string;
  base_url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  headers: Record<string, string>;
  authentication_type: "none" | "bearer" | "api_key" | "basic";
  has_auth_config: boolean;
  timeout_seconds: number;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface RequestRecord {
  id: string;
  endpoint_id: string | null;
  method: string;
  url: string;
  request_headers?: Record<string, string>;
  request_body?: unknown;
  status_code: number | null;
  response_headers?: Record<string, string>;
  response_body?: unknown;
  response_text?: string | null;
  response_size: number;
  duration_ms: number;
  outcome: "success" | "error";
  error: string | null;
  created_at: string;
}

export interface WebhookEndpoint {
  id: string;
  project_id: string;
  name: string;
  public_id: string;
  url: string;
  signature_header: string;
  has_signing_secret: boolean;
  is_active: boolean;
  created_at: string;
}

export interface WebhookDestination {
  id: string;
  webhook_endpoint_id: string;
  name: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  has_secret: boolean;
  timeout_seconds: number;
  is_active: boolean;
  created_at: string;
}

export type DeliveryStatus =
  | "pending"
  | "delivered"
  | "failed"
  | "retrying"
  | "dead_letter";

export interface WebhookEvent {
  id: string;
  endpoint_id: string;
  endpoint_name: string;
  event_type: string;
  method: string;
  source_ip: string;
  signature_status: "not_configured" | "verified" | "invalid";
  size_bytes: number;
  received_at: string;
  delivery_status: DeliveryStatus | null;
}

export interface Delivery {
  id: string;
  destination_id: string;
  destination_name: string;
  status: DeliveryStatus;
  status_code: number | null;
  response_body: string | null;
  duration_ms: number | null;
  attempt_number: number;
  error: string | null;
  created_at: string;
}

export interface WebhookEventDetail extends WebhookEvent {
  headers: Record<string, string>;
  query_params: Record<string, string>;
  payload: unknown;
  raw_body: string;
  deliveries: Delivery[];
}

export type JobStatus = "queued" | "running" | "completed" | "failed" | "retrying";

export interface Job {
  id: string;
  environment_id?: string;
  type: string;
  status: JobStatus;
  payload?: Record<string, unknown>;
  result?: unknown;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  attempts: number;
  max_attempts: number;
  error: string | null;
}

export interface ScheduledJob {
  id: string;
  name: string;
  cron_expression: string;
  timezone: string;
  action: Record<string, unknown>;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string;
  last_status: JobStatus | null;
  created_at: string;
}

export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus = "open" | "investigating" | "resolved";

export interface Incident {
  id: string;
  project_id: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  source: string;
  source_id: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface IncidentDetail extends Incident {
  timeline: Array<{
    id: string;
    kind: string;
    message: string;
    metadata: Record<string, unknown>;
    created_at: string;
  }>;
}

export interface SecretRecord {
  id: string;
  environment_id: string;
  name: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  key?: string;
}

export interface Activity {
  id: string;
  project_id: string | null;
  kind: string;
  title: string;
  detail: string | null;
  status: string;
  resource_id: string | null;
  created_at: string;
}

export interface AuditEvent {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  organization_id: string;
  project_id: string | null;
  project_name: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Dashboard {
  stats: {
    requests_24h: number;
    success_rate: number | null;
    average_latency_ms: number | null;
    failed_deliveries: number;
    active_incidents: number;
    jobs_running: number;
  };
  request_activity: Array<{
    timestamp: string;
    requests: number;
    errors: number;
    average_latency_ms: number;
  }>;
  health: Array<{ name: string; status: string; detail: string }>;
}
