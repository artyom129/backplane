import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, Edit3, Plus, ServerCog, Trash2, Variable } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge, statusTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { FormField, Input, Select, Textarea } from "@/components/ui/Form";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { api, ApiError } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import type { Environment } from "@/types";

export function EnvironmentsPage() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Environment | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<Environment | null>(null);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<Environment["status"]>("operational");
  const [variables, setVariables] = useState("{}");
  const [formError, setFormError] = useState<string | null>(null);

  const environments = useQuery({
    queryKey: ["environments", workspace.project?.id],
    queryFn: () => api.get<Environment[]>("/environments", workspace.headers),
    enabled: Boolean(workspace.project),
  });
  const create = useMutation({
    mutationFn: () => api.post<Environment>("/environments", { name, variables: {} }, workspace.headers),
    onSuccess: async () => {
      setCreateOpen(false);
      setName("");
      await queryClient.invalidateQueries({ queryKey: ["environments"] });
      toast.success("Environment created");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Environment could not be created"),
  });
  const update = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error("No environment selected");
      let parsed: Record<string, string>;
      try {
        parsed = JSON.parse(variables) as Record<string, string>;
      } catch {
        throw new Error("Variables must contain a valid JSON object.");
      }
      return api.patch<Environment>(
        `/environments/${editing.id}`,
        { name, status, variables: parsed },
        workspace.headers,
      );
    },
    onSuccess: async () => {
      setEditing(null);
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: ["environments"] });
      toast.success("Environment updated");
    },
    onError: (error) => setFormError(error instanceof ApiError || error instanceof Error ? error.message : "Environment could not be updated"),
  });
  const remove = useMutation({
    mutationFn: (environment: Environment) => api.delete(`/environments/${environment.id}`, workspace.headers),
    onSuccess: async () => {
      setDeleting(null);
      await queryClient.invalidateQueries({ queryKey: ["environments"] });
      toast.success("Environment deleted");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Environment could not be deleted"),
  });

  const openEdit = (environment: Environment) => {
    setEditing(environment);
    setName(environment.name);
    setStatus(environment.status);
    setVariables(JSON.stringify(environment.variables, null, 2));
  };

  return (
    <div className="mx-auto max-w-[1300px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        action={<Button disabled={!workspace.canWrite} onClick={() => { setName(""); setCreateOpen(true); }} variant="primary"><Plus className="h-3.5 w-3.5" /> New environment</Button>}
        breadcrumbs={[{ label: "Configuration" }, { label: "Environments" }]}
        description="Isolate variables, secrets, endpoints and delivery destinations by runtime stage."
        title="Environments"
      />
      {environments.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((item) => <Skeleton className="h-56" key={item} />)}</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {environments.data?.map((environment) => (
            <Card className="group overflow-hidden" key={environment.id}>
              <div className="flex items-start gap-3 border-b border-line p-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-muted">
                  <ServerCog className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><h2 className="text-sm font-medium text-[#d9dee3]">{environment.name}</h2><Badge tone={statusTone(environment.status)} dot>{environment.status}</Badge></div>
                  <div className="mt-1 font-mono text-[10px] text-muted">env_{environment.id}</div>
                </div>
                <div className="flex opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                  <Button aria-label="Edit environment" onClick={() => openEdit(environment)} size="icon" variant="ghost"><Edit3 className="h-3.5 w-3.5" /></Button>
                  <Button aria-label="Delete environment" onClick={() => setDeleting(environment)} size="icon" variant="ghost"><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-px bg-line">
                <div className="bg-raised p-4"><div className="flex items-center gap-1.5 text-[10px] text-muted"><Variable className="h-3 w-3" /> Variables</div><div className="mt-2 text-lg font-medium text-ink">{Object.keys(environment.variables).length}</div></div>
                <div className="bg-raised p-4"><div className="flex items-center gap-1.5 text-[10px] text-muted"><Boxes className="h-3 w-3" /> Updated</div><div className="mt-2 text-xs text-[#cbd2d8]">{formatRelative(environment.updated_at)}</div></div>
              </div>
              <div className="px-4 py-3 text-[10px] text-muted">Slug <span className="ml-1 font-mono text-[#b9c1c9]">{environment.slug}</span></div>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        footer={<><Button onClick={() => setCreateOpen(false)} variant="ghost">Cancel</Button><Button disabled={!name} loading={create.isPending} onClick={() => create.mutate()} variant="primary">Create environment</Button></>}
        onClose={() => setCreateOpen(false)}
        open={createOpen}
        title="Create environment"
        description="The slug is derived from the name and remains unique within the project."
      >
        <FormField label="Name"><Input autoFocus onChange={(event) => setName(event.target.value)} placeholder="QA Sandbox" value={name} /></FormField>
      </Dialog>

      <Dialog
        footer={<><Button onClick={() => setEditing(null)} variant="ghost">Cancel</Button><Button loading={update.isPending} onClick={() => update.mutate()} variant="primary">Save changes</Button></>}
        onClose={() => setEditing(null)}
        open={Boolean(editing)}
        title={`Configure ${editing?.name ?? "environment"}`}
        description="Variables are non-sensitive configuration. Store credentials in Secret Vault."
        wide
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name"><Input onChange={(event) => setName(event.target.value)} value={name} /></FormField>
          <FormField label="Operational status"><Select onChange={(event) => setStatus(event.target.value as Environment["status"])} value={status}><option value="operational">Operational</option><option value="degraded">Degraded</option><option value="disabled">Disabled</option></Select></FormField>
          <FormField className="sm:col-span-2" label="Environment variables" hint="JSON object of non-sensitive key/value pairs."><Textarea className="h-56 font-mono text-xs" onChange={(event) => setVariables(event.target.value)} spellCheck={false} value={variables} /></FormField>
          {formError && <div className="sm:col-span-2 rounded-[7px] border border-danger/20 bg-danger/[0.06] px-3 py-2.5 text-xs text-danger">{formError}</div>}
        </div>
      </Dialog>

      <Dialog
        footer={<><Button onClick={() => setDeleting(null)} variant="ghost">Cancel</Button><Button loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting)} variant="danger">Delete environment</Button></>}
        onClose={() => setDeleting(null)}
        open={Boolean(deleting)}
        title="Delete environment"
        description={`All endpoints, destinations and secrets scoped to ${deleting?.name ?? "this environment"} will be deleted.`}
      >
        <p className="text-sm leading-6 text-muted">This is a cascading and irreversible operation. Historical project events remain available where foreign keys permit.</p>
      </Dialog>
    </div>
  );
}

