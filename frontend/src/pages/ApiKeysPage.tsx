import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, KeyRound, Plus, Shield, TerminalSquare } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CopyButton";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField, Input } from "@/components/ui/Form";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { api, ApiError } from "@/lib/api";
import { formatRelative, formatTimestamp } from "@/lib/format";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import type { ApiKey } from "@/types";

const scopes = [
  "requests:read",
  "requests:write",
  "webhooks:read",
  "webhooks:write",
  "jobs:read",
  "jobs:write",
];

export function ApiKeysPage() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<ApiKey | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const [name, setName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["requests:read"]);
  const canManage = ["owner", "admin"].includes(workspace.organization?.role ?? "viewer");

  const keys = useQuery({
    queryKey: ["api-keys", workspace.organization?.id],
    queryFn: () => api.get<ApiKey[]>("/api-keys", workspace.headers),
    enabled: Boolean(workspace.organization),
  });
  const create = useMutation({
    mutationFn: () => api.post<ApiKey>("/api-keys", { name, scopes: selectedScopes }, workspace.headers),
    onSuccess: async (key) => {
      setCreateOpen(false);
      setCreated(key);
      setName("");
      await queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "API key could not be created"),
  });
  const revoke = useMutation({
    mutationFn: (key: ApiKey) => api.post<ApiKey>(`/api-keys/${key.id}/revoke`, {}, workspace.headers),
    onSuccess: async () => {
      setRevoking(null);
      await queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      toast.success("API key revoked");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "API key could not be revoked"),
  });

  return (
    <div className="mx-auto max-w-[1280px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        action={<Button disabled={!canManage} onClick={() => setCreateOpen(true)} variant="primary"><Plus className="h-3.5 w-3.5" /> Create API key</Button>}
        breadcrumbs={[{ label: "Configuration" }, { label: "API Keys" }]}
        description="Scoped machine credentials for programmatic access to BACKPLANE."
        title="API Keys"
      />
      <Card className="mb-5 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-muted"><Shield className="h-4 w-4" /></div>
          <div><h2 className="text-sm font-medium text-[#d7dde2]">Keys are shown exactly once</h2><p className="mt-1 text-xs leading-5 text-muted">BACKPLANE stores a SHA-256 hash. If a key is lost, revoke it and create a replacement.</p></div>
        </div>
      </Card>
      <Card className="overflow-hidden">
        {keys.isLoading ? (
          <TableSkeleton rows={7} />
        ) : keys.data?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead><tr className="h-10 border-b border-line text-[10px] uppercase tracking-wider text-muted"><th className="px-4 font-medium">Key</th><th className="px-3 font-medium">Scopes</th><th className="px-3 font-medium">Created</th><th className="px-3 font-medium">Last used</th><th className="px-3 font-medium">Status</th><th className="w-24" /></tr></thead>
              <tbody>
                {keys.data.map((key) => (
                  <tr className="data-row text-xs" key={key.id}>
                    <td className="px-4 py-3"><div className="flex items-center gap-2"><KeyRound className="h-3.5 w-3.5 text-muted" /><span className="font-medium text-[#d8dde2]">{key.name}</span></div><div className="mt-1 font-mono text-[10px] text-muted">{key.prefix}••••••••••••</div></td>
                    <td className="px-3 py-3"><div className="flex max-w-sm flex-wrap gap-1">{key.scopes.map((scope) => <Badge key={scope} tone="neutral">{scope}</Badge>)}</div></td>
                    <td className="px-3 py-3 text-[10px] text-muted" title={formatTimestamp(key.created_at)}>{formatRelative(key.created_at)}</td>
                    <td className="px-3 py-3 text-[10px] text-muted">{key.last_used_at ? formatRelative(key.last_used_at) : "Never"}</td>
                    <td className="px-3 py-3"><Badge tone={key.revoked_at ? "error" : "success"} dot>{key.revoked_at ? "Revoked" : "Active"}</Badge></td>
                    <td className="px-3 py-3 text-right">{!key.revoked_at && <Button disabled={!canManage} onClick={() => setRevoking(key)} size="sm" variant="ghost"><Ban className="h-3 w-3" /> Revoke</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState action={canManage ? <Button onClick={() => setCreateOpen(true)} size="sm" variant="primary"><Plus className="h-3 w-3" /> Create API key</Button> : undefined} description="Issue a key with the minimum scopes needed by your automation." title="No API keys" />
        )}
      </Card>

      <Dialog
        footer={<><Button onClick={() => setCreateOpen(false)} variant="ghost">Cancel</Button><Button disabled={!name || !selectedScopes.length} loading={create.isPending} onClick={() => create.mutate()} variant="primary">Create key</Button></>}
        onClose={() => setCreateOpen(false)}
        open={createOpen}
        title="Create API key"
        description="Choose the narrowest set of scopes required by the client."
      >
        <div className="space-y-5">
          <FormField label="Key name"><Input autoFocus onChange={(event) => setName(event.target.value)} placeholder="CI deployment reporter" value={name} /></FormField>
          <FormField label="Scopes">
            <div className="grid grid-cols-2 gap-2">
              {scopes.map((scope) => {
                const checked = selectedScopes.includes(scope);
                return (
                  <button
                    className={`flex items-center gap-2 rounded-[7px] border px-3 py-2 text-left font-mono text-[10px] ${checked ? "border-accent/30 bg-accent/[0.06] text-[#c9f2df]" : "border-line bg-surface text-muted"}`}
                    key={scope}
                    onClick={() => setSelectedScopes((current) => checked ? current.filter((item) => item !== scope) : [...current, scope])}
                    type="button"
                  >
                    <span className={`flex h-4 w-4 items-center justify-center rounded border ${checked ? "border-accent bg-accent text-[#08120e]" : "border-[#3a424b]"}`}>{checked && <Check className="h-3 w-3" />}</span>
                    {scope}
                  </button>
                );
              })}
            </div>
          </FormField>
        </div>
      </Dialog>

      <Dialog
        footer={<Button onClick={() => setCreated(null)} variant="primary">I have stored this key</Button>}
        onClose={() => setCreated(null)}
        open={Boolean(created)}
        title="API key created"
        description="Copy this key now. It cannot be shown again."
      >
        <div className="rounded-lg border border-accent/20 bg-[#09110d] p-3">
          <div className="flex items-center gap-2"><TerminalSquare className="h-4 w-4 text-accent" /><code className="min-w-0 flex-1 break-all font-mono text-xs text-[#c9f2df]">{created?.key}</code><CopyButton value={created?.key ?? ""} /></div>
        </div>
      </Dialog>

      <Dialog
        footer={<><Button onClick={() => setRevoking(null)} variant="ghost">Cancel</Button><Button loading={revoke.isPending} onClick={() => revoking && revoke.mutate(revoking)} variant="danger">Revoke key</Button></>}
        onClose={() => setRevoking(null)}
        open={Boolean(revoking)}
        title="Revoke API key"
        description={`${revoking?.name ?? "This key"} will stop authenticating immediately.`}
      >
        <p className="text-sm text-muted">Existing clients must be updated with a replacement key.</p>
      </Dialog>
    </div>
  );
}

