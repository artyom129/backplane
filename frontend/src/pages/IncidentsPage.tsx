import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  MessageSquarePlus,
  Plus,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { Badge, statusTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField, Input, Select, Textarea } from "@/components/ui/Form";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatRelative, formatTimestamp, shortId } from "@/lib/format";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import type {
  Incident,
  IncidentDetail,
  IncidentSeverity,
  IncidentStatus,
} from "@/types";

type IncidentFilter = "all" | IncidentStatus;

const severityOrder: Record<IncidentSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function IncidentsPage() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { incidentId } = useParams();
  const [filter, setFilter] = useState<IncidentFilter>("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [form, setForm] = useState({
    title: "",
    severity: "medium" as IncidentSeverity,
    description: "",
  });

  const incidents = useQuery({
    queryKey: ["incidents", workspace.project?.id, filter],
    queryFn: () =>
      api.get<Incident[]>(
        `/incidents${filter === "all" ? "" : `?status=${filter}`}`,
        workspace.headers,
      ),
    enabled: Boolean(workspace.project),
    refetchInterval: 15_000,
  });
  const detail = useQuery({
    queryKey: ["incident", incidentId],
    queryFn: () => api.get<IncidentDetail>(`/incidents/${incidentId}`, workspace.headers),
    enabled: Boolean(incidentId),
  });

  const createIncident = useMutation({
    mutationFn: () =>
      api.post<Incident>(
        "/incidents",
        { title: form.title, severity: form.severity, description: form.description || null },
        workspace.headers,
      ),
    onSuccess: async (incident) => {
      setCreateOpen(false);
      setForm({ title: "", severity: "medium", description: "" });
      await queryClient.invalidateQueries({ queryKey: ["incidents"] });
      navigate(`/incidents/${incident.id}`);
      toast.success("Incident created");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Incident could not be created"),
  });
  const updateIncident = useMutation({
    mutationFn: (payload: { status?: IncidentStatus; note?: string }) =>
      api.patch<Incident>(`/incidents/${incidentId}`, payload, workspace.headers),
    onSuccess: async () => {
      setNoteOpen(false);
      setNote("");
      await queryClient.invalidateQueries({ queryKey: ["incidents"] });
      await queryClient.invalidateQueries({ queryKey: ["incident", incidentId] });
      toast.success("Incident updated");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Incident could not be updated"),
  });

  const visible = useMemo(
    () =>
      [...(incidents.data ?? [])]
        .filter((incident) =>
          `${incident.title} ${incident.source}`.toLowerCase().includes(search.toLowerCase()),
        )
        .sort((left, right) => {
          if (left.status === "resolved" && right.status !== "resolved") return 1;
          if (right.status === "resolved" && left.status !== "resolved") return -1;
          return severityOrder[left.severity] - severityOrder[right.severity];
        }),
    [incidents.data, search],
  );

  return (
    <div className="mx-auto max-w-[1480px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        action={
          <Button disabled={!workspace.canWrite} onClick={() => setCreateOpen(true)} variant="primary">
            <Plus className="h-3.5 w-3.5" /> Declare incident
          </Button>
        }
        breadcrumbs={[{ label: "Operations" }, { label: "Incidents" }]}
        description="Coordinate failures from detection through recovery."
        title="Incidents"
      />

      <div className={cn("grid gap-5", incidentId && "xl:grid-cols-[minmax(0,1fr)_460px]")}>
        <Card className="min-w-0 overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-line p-3 sm:flex-row sm:items-center">
            <div className="flex gap-1">
              {(["all", "open", "investigating", "resolved"] as IncidentFilter[]).map((item) => (
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
            <div className="relative ml-auto w-full sm:w-60">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted" />
              <Input className="h-8 min-h-0 pl-8 text-xs" onChange={(event) => setSearch(event.target.value)} placeholder="Search incidents…" value={search} />
            </div>
          </div>
          {incidents.isLoading ? (
            <TableSkeleton rows={8} />
          ) : visible.length ? (
            <div>
              {visible.map((incident) => (
                <button
                  className={cn(
                    "data-row flex w-full items-start gap-3 px-4 py-4 text-left",
                    incident.id === incidentId && "bg-white/[0.035]",
                  )}
                  key={incident.id}
                  onClick={() => navigate(`/incidents/${incident.id}`)}
                  type="button"
                >
                  <div
                    className={cn(
                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
                      incident.severity === "critical"
                        ? "border-danger/25 bg-danger/[0.07] text-danger"
                        : incident.severity === "high"
                          ? "border-warning/25 bg-warning/[0.07] text-warning"
                          : "border-line bg-surface text-muted",
                    )}
                  >
                    {incident.severity === "critical" ? <AlertOctagon className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-[#d9dee3]">{incident.title}</span>
                      <Badge tone={statusTone(incident.severity)}>{incident.severity}</Badge>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-2 text-[10px] text-muted">
                      <span className="capitalize">{incident.source.replace("_", " ")}</span>
                      <span>·</span>
                      <span>inc_{shortId(incident.id)}</span>
                      <span>·</span>
                      <span>{formatRelative(incident.created_at)}</span>
                    </div>
                  </div>
                  <Badge tone={statusTone(incident.status)} dot>{incident.status}</Badge>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              description={filter === "all" ? "No manual or automatically detected incidents exist for this project." : `There are no ${filter} incidents.`}
              title="No incidents found"
            />
          )}
        </Card>

        {incidentId && (
          <Card className="h-fit overflow-hidden xl:sticky xl:top-20">
            {detail.isLoading ? (
              <TableSkeleton rows={8} />
            ) : detail.data ? (
              <>
                <div className="border-b border-line p-4">
                  <div className="flex items-start gap-3">
                    <Button aria-label="Close incident" onClick={() => navigate("/incidents")} size="icon" variant="ghost">
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div className="min-w-0 flex-1">
                      <div className="eyebrow">Incident detail</div>
                      <h2 className="mt-1 text-sm font-medium leading-5 text-ink">{detail.data.title}</h2>
                      <div className="mt-1 font-mono text-[10px] text-muted">inc_{detail.data.id}</div>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Badge tone={statusTone(detail.data.severity)}>{detail.data.severity}</Badge>
                    <Badge tone={statusTone(detail.data.status)} dot>{detail.data.status}</Badge>
                    <span className="ml-auto text-[10px] text-muted">Opened {formatRelative(detail.data.created_at)}</span>
                  </div>
                </div>
                <div className="max-h-[calc(100vh-210px)] overflow-auto p-4">
                  {detail.data.description && (
                    <div className="mb-6 rounded-lg border border-line bg-surface p-3 text-xs leading-5 text-[#b8c0c8]">
                      {detail.data.description}
                    </div>
                  )}
                  <div className="eyebrow mb-4">Incident timeline</div>
                  <div>
                    {detail.data.timeline.map((event, index) => (
                      <div className="relative flex min-h-[72px] gap-3" key={event.id}>
                        {index < detail.data!.timeline.length - 1 && <span className="absolute left-[7px] top-4 h-full w-px bg-line" />}
                        <span className="relative z-10 mt-1 h-[15px] w-[15px] shrink-0 rounded-full border-[4px] border-raised bg-accent" />
                        <div className="pb-4">
                          <div className="text-xs text-[#d6dce1]">{event.message}</div>
                          <div className="mt-1.5 font-mono text-[9px] text-muted">{event.kind} · {formatTimestamp(event.created_at)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {workspace.canWrite && (
                    <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4">
                      {detail.data.status === "open" && (
                        <Button onClick={() => updateIncident.mutate({ status: "investigating", note: "Investigation started." })} variant="secondary">
                          <CircleDot className="h-3.5 w-3.5" /> Investigate
                        </Button>
                      )}
                      {detail.data.status !== "resolved" && (
                        <Button onClick={() => updateIncident.mutate({ status: "resolved", note: "Service recovered and incident resolved." })} variant="primary">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
                        </Button>
                      )}
                      <Button className={detail.data.status === "resolved" ? "col-span-2" : ""} onClick={() => setNoteOpen(true)} variant="secondary">
                        <MessageSquarePlus className="h-3.5 w-3.5" /> Add note
                      </Button>
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </Card>
        )}
      </div>

      <Dialog
        footer={<><Button onClick={() => setCreateOpen(false)} variant="ghost">Cancel</Button><Button disabled={!form.title} loading={createIncident.isPending} onClick={() => createIncident.mutate()} variant="primary">Declare incident</Button></>}
        onClose={() => setCreateOpen(false)}
        open={createOpen}
        title="Declare incident"
        description="Manual incidents share the same timeline and audit trail as automated detections."
      >
        <div className="space-y-4">
          <FormField label="Title"><Input autoFocus onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Elevated payment API latency" value={form.title} /></FormField>
          <FormField label="Severity"><Select onChange={(event) => setForm((current) => ({ ...current, severity: event.target.value as IncidentSeverity }))} value={form.severity}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></Select></FormField>
          <FormField label="Description"><Textarea onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Describe user impact and what has been observed." value={form.description} /></FormField>
        </div>
      </Dialog>

      <Dialog
        footer={<><Button onClick={() => setNoteOpen(false)} variant="ghost">Cancel</Button><Button disabled={!note.trim()} loading={updateIncident.isPending} onClick={() => updateIncident.mutate({ note })} variant="primary">Add note</Button></>}
        onClose={() => setNoteOpen(false)}
        open={noteOpen}
        title="Add timeline note"
      >
        <FormField label="Update"><Textarea autoFocus onChange={(event) => setNote(event.target.value)} placeholder="What changed, and what did you learn?" value={note} /></FormField>
      </Dialog>
    </div>
  );
}

