import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarClock,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCcw,
  Trash2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { Badge, statusTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField, Input, Select } from "@/components/ui/Form";
import { JsonViewer } from "@/components/ui/JsonViewer";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatRelative, formatTimestamp, shortId } from "@/lib/format";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import type { Endpoint, Job, JobStatus, Page, ScheduledJob } from "@/types";

type PageTab = "jobs" | "schedules";
type JobFilter = "all" | JobStatus;

function JobTimeline({ job }: { job: Job }) {
  const steps = [
    { label: "Job queued", time: job.created_at, complete: true, error: false },
    { label: "Worker started", time: job.started_at, complete: Boolean(job.started_at), error: false },
    {
      label: job.status === "failed" ? "Job failed" : "Job completed",
      time: job.finished_at,
      complete: Boolean(job.finished_at),
      error: job.status === "failed",
    },
  ];
  return (
    <div className="space-y-0">
      {steps.map((step, index) => (
        <div className="relative flex min-h-14 gap-3" key={step.label}>
          {index < steps.length - 1 && <span className="absolute left-[7px] top-4 h-full w-px bg-line" />}
          <span
            className={cn(
              "relative z-10 mt-1 h-[15px] w-[15px] rounded-full border-[4px] border-raised",
              !step.complete ? "bg-[#343c45]" : step.error ? "bg-danger" : "bg-accent",
            )}
          />
          <div>
            <div className={cn("text-xs", step.complete ? "text-[#d4dae0]" : "text-muted")}>{step.label}</div>
            <div className="mt-1 text-[10px] text-muted">{step.time ? formatTimestamp(step.time) : "Waiting"}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function JobsPage() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { jobId } = useParams();
  const [pageTab, setPageTab] = useState<PageTab>("jobs");
  const [filter, setFilter] = useState<JobFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [endpointId, setEndpointId] = useState("");
  const [schedule, setSchedule] = useState({
    name: "",
    endpointId: "",
    cron: "*/15 * * * *",
    timezone: "UTC",
  });

  const jobs = useQuery({
    queryKey: ["jobs", workspace.project?.id, filter],
    queryFn: () =>
      api.get<Page<Job>>(
        `/jobs?page_size=50${filter === "all" ? "" : `&status=${filter}`}`,
        workspace.headers,
      ),
    enabled: Boolean(workspace.project),
    refetchInterval: 8_000,
  });
  const schedules = useQuery({
    queryKey: ["scheduled-jobs", workspace.project?.id],
    queryFn: () => api.get<ScheduledJob[]>("/scheduled-jobs", workspace.headers),
    enabled: Boolean(workspace.project),
  });
  const endpoints = useQuery({
    queryKey: ["endpoints", workspace.environment?.id],
    queryFn: () => api.get<Endpoint[]>("/endpoints", workspace.headers),
    enabled: Boolean(workspace.environment),
  });
  const detail = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.get<Job>(`/jobs/${jobId}`, workspace.headers),
    enabled: Boolean(jobId),
    refetchInterval: (query) =>
      query.state.data && ["completed", "failed"].includes(query.state.data.status) ? false : 4_000,
  });

  const createJob = useMutation({
    mutationFn: () =>
      api.post<Job>(
        "/jobs",
        { type: "endpoint.check", payload: { endpoint_id: endpointId }, max_attempts: 3 },
        workspace.headers,
      ),
    onSuccess: async (job) => {
      setCreateOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
      navigate(`/jobs/${job.id}`);
      toast.success("Health check job queued");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Job could not be queued"),
  });
  const createSchedule = useMutation({
    mutationFn: () =>
      api.post<ScheduledJob>(
        "/scheduled-jobs",
        {
          name: schedule.name,
          cron_expression: schedule.cron,
          timezone: schedule.timezone,
          action: { type: "endpoint.check", payload: { endpoint_id: schedule.endpointId } },
          enabled: true,
        },
        workspace.headers,
      ),
    onSuccess: async () => {
      setScheduleOpen(false);
      setPageTab("schedules");
      await queryClient.invalidateQueries({ queryKey: ["scheduled-jobs"] });
      toast.success("Schedule created");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Schedule could not be created"),
  });
  const retryJob = useMutation({
    mutationFn: (id: string) => api.post<Job>(`/jobs/${id}/retry`, {}, workspace.headers),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
      await queryClient.invalidateQueries({ queryKey: ["job", jobId] });
      toast.success("Job requeued");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Job could not be retried"),
  });
  const toggleSchedule = useMutation({
    mutationFn: (item: ScheduledJob) =>
      api.patch<ScheduledJob>(`/scheduled-jobs/${item.id}`, { enabled: !item.enabled }, workspace.headers),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["scheduled-jobs"] }),
  });
  const deleteSchedule = useMutation({
    mutationFn: (id: string) => api.delete(`/scheduled-jobs/${id}`, workspace.headers),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["scheduled-jobs"] });
      toast.success("Schedule deleted");
    },
  });

  return (
    <div className="mx-auto max-w-[1480px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        action={
          <div className="flex gap-2">
            <Button disabled={!workspace.canWrite} onClick={() => setScheduleOpen(true)} variant="secondary">
              <CalendarClock className="h-3.5 w-3.5" /> New schedule
            </Button>
            <Button disabled={!workspace.canWrite || !endpoints.data?.length} onClick={() => setCreateOpen(true)} variant="primary">
              <Play className="h-3.5 w-3.5" /> Run health check
            </Button>
          </div>
        }
        breadcrumbs={[{ label: "Operations" }, { label: "Jobs" }]}
        description="Monitor background work, retries and recurring automation."
        title="Jobs"
      />

      <div className={cn("grid gap-5", jobId && "xl:grid-cols-[minmax(0,1fr)_420px]")}>
        <Card className="min-w-0 overflow-hidden">
          <Tabs<PageTab>
            className="px-2"
            items={[
              { value: "jobs", label: "Executions", count: jobs.data?.total },
              { value: "schedules", label: "Scheduled", count: schedules.data?.length },
            ]}
            onChange={setPageTab}
            value={pageTab}
          />
          {pageTab === "jobs" ? (
            <>
              <div className="flex flex-wrap gap-1 border-b border-line px-3 py-2.5">
                {(["all", "running", "failed", "completed"] as JobFilter[]).map((item) => (
                  <Button
                    className={cn(filter === item && "border-[#3a444e] bg-white/[0.045] text-ink")}
                    key={item}
                    onClick={() => setFilter(item)}
                    size="sm"
                    variant="ghost"
                  >
                    {item[0].toUpperCase() + item.slice(1)}
                  </Button>
                ))}
              </div>
              {jobs.isLoading ? (
                <TableSkeleton rows={8} />
              ) : jobs.data?.items.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] text-left">
                    <thead>
                      <tr className="h-10 border-b border-line text-[10px] uppercase tracking-wider text-muted">
                        <th className="px-4 font-medium">Job</th>
                        <th className="px-3 font-medium">Status</th>
                        <th className="px-3 font-medium">Attempts</th>
                        <th className="px-3 font-medium">Created</th>
                        <th className="px-3 font-medium">Duration</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.data.items.map((job) => {
                        const duration =
                          job.started_at && job.finished_at
                            ? `${((new Date(job.finished_at).getTime() - new Date(job.started_at).getTime()) / 1000).toFixed(1)}s`
                            : job.started_at
                              ? "Running"
                              : "—";
                        return (
                          <tr
                            className={cn("data-row cursor-pointer text-xs", job.id === jobId && "bg-white/[0.035]")}
                            key={job.id}
                            onClick={() => navigate(`/jobs/${job.id}`)}
                          >
                            <td className="px-4 py-3">
                              <div className="font-mono text-[11px] text-[#d8dde2]">{job.type}</div>
                              <div className="mt-1 font-mono text-[9px] text-muted">job_{shortId(job.id)}</div>
                            </td>
                            <td className="px-3 py-3"><Badge tone={statusTone(job.status)} dot>{job.status}</Badge></td>
                            <td className="px-3 py-3 font-mono text-[10px] text-muted">{job.attempts} / {job.max_attempts}</td>
                            <td className="px-3 py-3 text-[10px] text-muted">{formatRelative(job.created_at)}</td>
                            <td className="px-3 py-3 font-mono text-[10px] text-muted">{duration}</td>
                            <td className="px-3 py-3"><MoreHorizontal className="h-4 w-4 text-muted" /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  description="Run an endpoint health check or create a schedule. Executions and retries will appear here."
                  title="No background jobs"
                />
              )}
            </>
          ) : schedules.isLoading ? (
            <TableSkeleton rows={6} />
          ) : schedules.data?.length ? (
            <div>
              {schedules.data.map((item) => (
                <div className="data-row flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center" key={item.id}>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-muted">
                    <CalendarClock className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-xs font-medium text-[#d8dde2]">{item.name}</span>
                      <Badge tone={item.enabled ? "success" : "neutral"}>{item.enabled ? "Enabled" : "Disabled"}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-3 font-mono text-[10px] text-muted">
                      <span>{item.cron_expression}</span><span>{item.timezone}</span>
                      <span>Next {formatRelative(item.next_run_at)}</span>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button onClick={() => toggleSchedule.mutate(item)} size="sm" variant="secondary">
                      {item.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button aria-label="Delete schedule" onClick={() => deleteSchedule.mutate(item.id)} size="icon" variant="ghost">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              action={<Button onClick={() => setScheduleOpen(true)} size="sm" variant="primary"><Plus className="h-3 w-3" /> New schedule</Button>}
              description="Schedules use real cron expressions and timezone-aware next-run calculation."
              title="No scheduled jobs"
            />
          )}
        </Card>

        {jobId && (
          <Card className="h-fit overflow-hidden xl:sticky xl:top-20">
            {detail.isLoading ? (
              <TableSkeleton rows={7} />
            ) : detail.data ? (
              <>
                <div className="flex items-start gap-3 border-b border-line p-4">
                  <Button aria-label="Close details" onClick={() => navigate("/jobs")} size="icon" variant="ghost">
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <div className="min-w-0 flex-1">
                    <div className="eyebrow">Job execution</div>
                    <h2 className="mt-1 font-mono text-sm text-ink">{detail.data.type}</h2>
                    <div className="mt-1 font-mono text-[10px] text-muted">job_{detail.data.id}</div>
                  </div>
                  <Badge tone={statusTone(detail.data.status)}>{detail.data.status}</Badge>
                </div>
                <div className="max-h-[calc(100vh-180px)] space-y-6 overflow-auto p-4">
                  <div>
                    <div className="eyebrow mb-3">Execution timeline</div>
                    <JobTimeline job={detail.data} />
                  </div>
                  <div>
                    <div className="eyebrow mb-2">Payload</div>
                    <JsonViewer value={detail.data.payload ?? {}} />
                  </div>
                  {detail.data.result !== null && detail.data.result !== undefined && (
                    <div><div className="eyebrow mb-2">Result</div><JsonViewer value={detail.data.result} /></div>
                  )}
                  {detail.data.error && (
                    <div className="rounded-lg border border-danger/20 bg-danger/[0.05] p-3">
                      <div className="flex items-center gap-2 text-xs font-medium text-danger"><XCircle className="h-3.5 w-3.5" /> Last error</div>
                      <p className="mt-2 text-xs leading-5 text-muted">{detail.data.error}</p>
                    </div>
                  )}
                  {detail.data.status === "failed" && (
                    <Button className="w-full" loading={retryJob.isPending} onClick={() => retryJob.mutate(detail.data!.id)} variant="primary">
                      <RefreshCcw className="h-3.5 w-3.5" /> Retry job
                    </Button>
                  )}
                </div>
              </>
            ) : null}
          </Card>
        )}
      </div>

      <Dialog
        footer={<><Button onClick={() => setCreateOpen(false)} variant="ghost">Cancel</Button><Button disabled={!endpointId} loading={createJob.isPending} onClick={() => createJob.mutate()} variant="primary">Queue job</Button></>}
        onClose={() => setCreateOpen(false)}
        open={createOpen}
        title="Run endpoint health check"
        description="The worker calls the registered endpoint and retries transient failures."
      >
        <FormField label="Endpoint">
          <Select onChange={(event) => setEndpointId(event.target.value)} value={endpointId}>
            <option value="">Select endpoint</option>
            {endpoints.data?.map((endpoint) => <option key={endpoint.id} value={endpoint.id}>{endpoint.name} · {endpoint.method}</option>)}
          </Select>
        </FormField>
      </Dialog>

      <Dialog
        footer={<><Button onClick={() => setScheduleOpen(false)} variant="ghost">Cancel</Button><Button disabled={!schedule.name || !schedule.endpointId || !schedule.cron} loading={createSchedule.isPending} onClick={() => createSchedule.mutate()} variant="primary">Create schedule</Button></>}
        onClose={() => setScheduleOpen(false)}
        open={scheduleOpen}
        title="Create scheduled job"
        description="The scheduler dispatches due jobs every 15 seconds using row-level locking."
      >
        <div className="space-y-4">
          <FormField label="Name"><Input onChange={(event) => setSchedule((current) => ({ ...current, name: event.target.value }))} placeholder="Quarter-hour health check" value={schedule.name} /></FormField>
          <FormField label="Endpoint"><Select onChange={(event) => setSchedule((current) => ({ ...current, endpointId: event.target.value }))} value={schedule.endpointId}><option value="">Select endpoint</option>{endpoints.data?.map((endpoint) => <option key={endpoint.id} value={endpoint.id}>{endpoint.name}</option>)}</Select></FormField>
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <FormField label="Cron expression" hint="Five-field cron syntax."><Input className="font-mono" onChange={(event) => setSchedule((current) => ({ ...current, cron: event.target.value }))} value={schedule.cron} /></FormField>
            <FormField label="Timezone"><Select onChange={(event) => setSchedule((current) => ({ ...current, timezone: event.target.value }))} value={schedule.timezone}><option>UTC</option><option>Europe/London</option><option>America/New_York</option><option>Asia/Qyzylorda</option></Select></FormField>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
