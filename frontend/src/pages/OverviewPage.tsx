import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity as ActivityIcon,
  AlertTriangle,
  ArrowUpRight,
  Braces,
  CheckCircle2,
  Clock3,
  Radio,
  Webhook,
} from "lucide-react";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge, statusTone } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { api, openEventStream } from "@/lib/api";
import { formatBytes, formatNumber, formatRelative, formatTimestamp } from "@/lib/format";
import { useAuth } from "@/providers/AuthProvider";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import type {
  Activity,
  Dashboard,
  Incident,
  Job,
  Page,
  WebhookEvent,
} from "@/types";

const statConfig = [
  { key: "requests_24h", label: "Requests 24h", icon: Braces, suffix: "" },
  { key: "success_rate", label: "Success rate", icon: CheckCircle2, suffix: "%" },
  { key: "average_latency_ms", label: "Average latency", icon: Clock3, suffix: " ms" },
  { key: "failed_deliveries", label: "Failed deliveries", icon: Webhook, suffix: "" },
  { key: "active_incidents", label: "Active incidents", icon: AlertTriangle, suffix: "" },
  { key: "jobs_running", label: "Jobs running", icon: Radio, suffix: "" },
] as const;

function MiniListHeader({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link className="flex items-center gap-1 text-[11px] text-muted hover:text-ink" to={to}>
      {children} <ArrowUpRight className="h-3 w-3" />
    </Link>
  );
}

export function OverviewPage() {
  const { user } = useAuth();
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const dashboard = useQuery({
    queryKey: ["dashboard", workspace.project?.id],
    queryFn: () => api.get<Dashboard>("/telemetry/dashboard", workspace.headers),
    enabled: Boolean(workspace.project),
    refetchInterval: 30_000,
  });
  const activity = useQuery({
    queryKey: ["activity", workspace.project?.id],
    queryFn: () =>
      api.get<Activity[]>(`/activity?project_id=${workspace.project?.id}`, workspace.headers),
    enabled: Boolean(workspace.project),
  });
  const incidents = useQuery({
    queryKey: ["incidents", workspace.project?.id, "recent"],
    queryFn: () => api.get<Incident[]>("/incidents", workspace.headers),
    enabled: Boolean(workspace.project),
  });
  const webhookEvents = useQuery({
    queryKey: ["webhook-events", workspace.project?.id, "recent"],
    queryFn: () => api.get<Page<WebhookEvent>>("/webhooks/events?page_size=5", workspace.headers),
    enabled: Boolean(workspace.project),
  });
  const jobs = useQuery({
    queryKey: ["jobs", workspace.project?.id, "recent"],
    queryFn: () => api.get<Page<Job>>("/jobs?page_size=5", workspace.headers),
    enabled: Boolean(workspace.project),
  });

  useEffect(() => {
    if (!workspace.project) return;
    const controller = new AbortController();
    void openEventStream(
      `/activity/stream?project_id=${workspace.project.id}`,
      workspace.headers,
      controller.signal,
      (data) => {
        const event = JSON.parse(data) as Activity;
        queryClient.setQueryData<Activity[]>(["activity", workspace.project?.id], (current = []) => [
          event,
          ...current.filter((item) => item.id !== event.id),
        ].slice(0, 50));
        void queryClient.invalidateQueries({ queryKey: ["dashboard", workspace.project?.id] });
      },
    ).catch(() => {
      // The next mount reconnects; REST data remains authoritative while the stream is unavailable.
    });
    return () => controller.abort();
  }, [queryClient, workspace.headers, workspace.project]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = user?.full_name.split(" ")[0] ?? "there";
  const hasActiveIncident = (dashboard.data?.stats.active_incidents ?? 0) > 0;

  return (
    <div className="mx-auto max-w-[1480px] p-4 sm:p-6 lg:p-8">
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow mb-2">{workspace.project?.name} / {workspace.environment?.name}</p>
          <h1 className="text-[1.7rem] font-medium tracking-[-0.035em] text-ink">
            {greeting}, {firstName}
          </h1>
          <div className="mt-2 flex items-center gap-2 text-sm text-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${hasActiveIncident ? "bg-warning" : "bg-accent"}`} />
            {hasActiveIncident
              ? `${dashboard.data?.stats.active_incidents} active incident${dashboard.data?.stats.active_incidents === 1 ? "" : "s"}`
              : "All systems operational"}
          </div>
        </div>
        <div className="font-mono text-[10px] text-muted">Updated {formatTimestamp(new Date())}</div>
      </div>

      <div className="grid grid-cols-2 overflow-hidden rounded-[10px] border border-line bg-raised sm:grid-cols-3 xl:grid-cols-6">
        {statConfig.map(({ key, label, icon: Icon, suffix }, index) => {
          const value = dashboard.data?.stats[key];
          return (
            <div
              className={`min-w-0 p-4 ${index % 2 ? "" : "border-r border-line"} sm:border-r sm:last:border-r-0 xl:min-h-[104px]`}
              key={key}
            >
              <div className="flex items-center justify-between text-muted">
                <span className="text-[11px]">{label}</span>
                <Icon className="h-3.5 w-3.5" />
              </div>
              {dashboard.isLoading ? (
                <Skeleton className="mt-4 h-7 w-20" />
              ) : (
                <div className="mt-3 text-xl font-medium tracking-[-0.03em] text-ink">
                  {formatNumber(value)}{value !== null && value !== undefined ? suffix : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.65fr)]">
        <Card>
          <CardHeader title="Request activity" description="Volume and failed requests over the last 24 hours" />
          <div className="h-[300px] p-4">
            {dashboard.isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : dashboard.data?.request_activity.length ? (
              <ResponsiveContainer height="100%" width="100%">
                <AreaChart data={dashboard.data.request_activity} margin={{ left: -25, right: 8, top: 12 }}>
                  <defs>
                    <linearGradient id="requestFill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#66e0ac" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#66e0ac" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#20262d" strokeDasharray="2 4" vertical={false} />
                  <XAxis
                    axisLine={false}
                    dataKey="timestamp"
                    tick={{ fill: "#737e8b", fontSize: 10 }}
                    tickFormatter={(value: string) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    tickLine={false}
                  />
                  <YAxis axisLine={false} allowDecimals={false} tick={{ fill: "#737e8b", fontSize: 10 }} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: "#0d1115", border: "1px solid #293039", borderRadius: 7, fontSize: 11 }}
                    labelFormatter={(value) => formatTimestamp(String(value))}
                  />
                  <Area dataKey="requests" fill="url(#requestFill)" stroke="#66e0ac" strokeWidth={1.5} type="monotone" />
                  <Area dataKey="errors" fill="transparent" stroke="#f2777a" strokeWidth={1.2} type="monotone" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                compact
                description="Send a request from the API console to start collecting volume, latency and error-rate telemetry."
                title="No request telemetry yet"
              />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="System health" description="Derived from operations data" />
          <div className="p-2">
            {dashboard.isLoading ? (
              <TableSkeleton rows={3} />
            ) : (
              dashboard.data?.health.map((component) => (
                <div className="flex items-start gap-3 rounded-md px-3 py-3.5" key={component.name}>
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${component.status === "operational" ? "bg-accent" : "bg-warning"}`}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-[#d8dde2]">{component.name}</div>
                    <div className="mt-1 text-[11px] text-muted">{component.detail}</div>
                  </div>
                  <span className="ml-auto text-[10px] capitalize text-muted">{component.status}</span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader action={<MiniListHeader to="/audit">Open activity</MiniListHeader>} title="Recent activity" />
          {activity.isLoading ? (
            <TableSkeleton rows={5} />
          ) : activity.data?.length ? (
            <div>
              {activity.data.slice(0, 6).map((item) => (
                <div className="data-row flex min-h-14 items-center gap-3 px-4" key={item.id}>
                  <span className={`h-2 w-2 rounded-full ${item.status === "error" ? "bg-danger" : item.status === "warning" ? "bg-warning" : "bg-accent"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-[#d5dbe0]">{item.title}</div>
                    <div className="mt-0.5 truncate text-[10px] text-muted">{item.detail ?? item.kind}</div>
                  </div>
                  <time className="text-[10px] text-muted" title={formatTimestamp(item.created_at)}>
                    {formatRelative(item.created_at)}
                  </time>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact description="Operational events will appear here in real time." title="No recent activity" />
          )}
        </Card>

        <Card>
          <CardHeader action={<MiniListHeader to="/incidents">View incidents</MiniListHeader>} title="Recent incidents" />
          {incidents.isLoading ? (
            <TableSkeleton rows={4} />
          ) : incidents.data?.length ? (
            incidents.data.slice(0, 5).map((incident) => (
              <Link className="data-row flex min-h-14 items-center gap-3 px-4" key={incident.id} to={`/incidents/${incident.id}`}>
                <AlertTriangle className={`h-4 w-4 ${incident.severity === "critical" ? "text-danger" : "text-warning"}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-[#d5dbe0]">{incident.title}</div>
                  <div className="mt-0.5 text-[10px] capitalize text-muted">{incident.source} · {formatRelative(incident.created_at)}</div>
                </div>
                <Badge tone={statusTone(incident.status)}>{incident.status}</Badge>
              </Link>
            ))
          ) : (
            <EmptyState compact description="No open or historical incidents exist for this project." title="No incidents" />
          )}
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader action={<MiniListHeader to="/webhooks">Open inbox</MiniListHeader>} title="Webhook deliveries" />
          {webhookEvents.isLoading ? (
            <TableSkeleton rows={4} />
          ) : webhookEvents.data?.items.length ? (
            webhookEvents.data.items.map((event) => (
              <Link className="data-row flex min-h-14 items-center gap-3 px-4" key={event.id} to={`/webhooks/${event.id}`}>
                <Webhook className="h-4 w-4 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs text-[#d5dbe0]">{event.event_type}</div>
                  <div className="mt-0.5 text-[10px] text-muted">{event.endpoint_name} · {formatBytes(event.size_bytes)}</div>
                </div>
                <Badge tone={statusTone(event.delivery_status)}>{event.delivery_status ?? "captured"}</Badge>
              </Link>
            ))
          ) : (
            <EmptyState compact description="Create an inbound endpoint to start capturing webhook events." title="Inbox is empty" />
          )}
        </Card>
        <Card>
          <CardHeader action={<MiniListHeader to="/jobs">Open jobs</MiniListHeader>} title="Running jobs" />
          {jobs.isLoading ? (
            <TableSkeleton rows={4} />
          ) : jobs.data?.items.length ? (
            jobs.data.items.map((job) => (
              <Link className="data-row flex min-h-14 items-center gap-3 px-4" key={job.id} to={`/jobs/${job.id}`}>
                <ActivityIcon className="h-4 w-4 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs text-[#d5dbe0]">{job.type}</div>
                  <div className="mt-0.5 text-[10px] text-muted">Attempt {job.attempts}/{job.max_attempts} · {formatRelative(job.created_at)}</div>
                </div>
                <Badge tone={statusTone(job.status)}>{job.status}</Badge>
              </Link>
            ))
          ) : (
            <EmptyState compact description="Manual and scheduled background work will appear here." title="No jobs yet" />
          )}
        </Card>
      </div>
    </div>
  );
}

