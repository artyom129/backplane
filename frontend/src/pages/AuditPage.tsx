import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, Filter, Search, ShieldCheck } from "lucide-react";
import { Fragment, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input, Select } from "@/components/ui/Form";
import { JsonViewer } from "@/components/ui/JsonViewer";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatRelative, formatTimestamp, shortId } from "@/lib/format";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import type { AuditEvent, Page } from "@/types";

export function AuditPage() {
  const workspace = useWorkspace();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [projectId, setProjectId] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const audit = useQuery({
    queryKey: ["audit", workspace.organization?.id, page, action, projectId],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), page_size: "25" });
      if (action) params.set("action", action);
      if (projectId) params.set("project_id", projectId);
      return api.get<Page<AuditEvent>>(`/audit?${params.toString()}`, workspace.headers);
    },
    enabled: Boolean(workspace.organization),
  });

  return (
    <div className="mx-auto max-w-[1480px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        breadcrumbs={[{ label: "System" }, { label: "Audit Log" }]}
        description="Immutable attribution for sensitive and operational changes across the organization."
        title="Audit Log"
      />
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line p-3 sm:flex-row sm:items-center">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted" />
            <Input
              className="h-8 min-h-0 pl-8 text-xs"
              onChange={(event) => { setAction(event.target.value); setPage(1); }}
              placeholder="Filter action, e.g. secret.rotated"
              value={action}
            />
          </div>
          <div className="relative w-full sm:w-52">
            <Filter className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted" />
            <Select
              className="h-8 min-h-0 pl-8 text-xs"
              onChange={(event) => { setProjectId(event.target.value); setPage(1); }}
              value={projectId}
            >
              <option value="">All projects</option>
              {workspace.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </Select>
          </div>
          <span className="ml-auto text-[10px] text-muted">{audit.data?.total ?? 0} events</span>
        </div>
        {audit.isLoading ? (
          <TableSkeleton rows={10} />
        ) : audit.data?.items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left">
              <thead><tr className="h-10 border-b border-line text-[10px] uppercase tracking-wider text-muted"><th className="px-4 font-medium">Timestamp</th><th className="px-3 font-medium">Actor</th><th className="px-3 font-medium">Action</th><th className="px-3 font-medium">Resource</th><th className="px-3 font-medium">Project</th><th className="w-10" /></tr></thead>
              <tbody>
                {audit.data.items.map((event) => (
                  <Fragment key={event.id}>
                    <tr className={cn("data-row text-xs", expanded === event.id && "bg-white/[0.025]")} key={event.id}>
                      <td className="whitespace-nowrap px-4 py-3 text-[10px] text-muted" title={formatTimestamp(event.created_at)}>{formatRelative(event.created_at)}</td>
                      <td className="px-3 py-3"><div className="text-[11px] text-[#d3d9df]">{event.actor_name ?? "System"}</div><div className="mt-0.5 font-mono text-[9px] text-muted">{event.actor_id ? shortId(event.actor_id) : "automated"}</div></td>
                      <td className="px-3 py-3"><Badge tone={event.action.includes("deleted") || event.action.includes("revoked") ? "warning" : "neutral"}>{event.action}</Badge></td>
                      <td className="px-3 py-3"><div className="text-[11px] capitalize text-[#cbd2d8]">{event.resource_type.replace("_", " ")}</div><div className="mt-0.5 font-mono text-[9px] text-muted">{shortId(event.resource_id)}</div></td>
                      <td className="px-3 py-3 text-[11px] text-muted">{event.project_name ?? "Organization"}</td>
                      <td className="px-3 py-3"><Button aria-label="Toggle metadata" onClick={() => setExpanded((current) => current === event.id ? null : event.id)} size="icon" variant="ghost"><ChevronDown className={cn("h-3.5 w-3.5", expanded === event.id && "rotate-180")} /></Button></td>
                    </tr>
                    {expanded === event.id && (
                      <tr key={`${event.id}-metadata`}><td className="border-b border-line bg-[#0c0f12] px-4 py-3" colSpan={6}><div className="mx-auto max-w-3xl"><JsonViewer value={event.metadata} /></div></td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState description="Sensitive actions such as secret rotation, key creation and webhook replay will be attributed here." title="No audit events found" />
        )}
        {audit.data && audit.data.pages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3">
            <span className="text-[10px] text-muted">Page {audit.data.page} of {audit.data.pages}</span>
            <div className="flex gap-1">
              <Button disabled={page <= 1} onClick={() => setPage((current) => current - 1)} size="sm" variant="secondary"><ChevronLeft className="h-3 w-3" /> Previous</Button>
              <Button disabled={page >= audit.data.pages} onClick={() => setPage((current) => current + 1)} size="sm" variant="secondary">Next <ChevronRight className="h-3 w-3" /></Button>
            </div>
          </div>
        )}
      </Card>
      <div className="mt-4 flex items-center gap-2 text-[10px] text-muted"><ShieldCheck className="h-3.5 w-3.5" /> Audit records are retained independently from the resources they describe.</div>
    </div>
  );
}
