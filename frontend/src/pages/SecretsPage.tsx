import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EyeOff, LockKeyhole, Plus, RefreshCcw, Search, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField, Input } from "@/components/ui/Form";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { api, ApiError } from "@/lib/api";
import { formatRelative, formatTimestamp } from "@/lib/format";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import type { SecretRecord } from "@/types";

export function SecretsPage() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [rotating, setRotating] = useState<SecretRecord | null>(null);
  const [deleting, setDeleting] = useState<SecretRecord | null>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const createOpen = searchParams.get("new") === "1";

  useEffect(() => {
    if (!createOpen && !rotating) {
      setName("");
      setValue("");
    }
  }, [createOpen, rotating]);

  const secrets = useQuery({
    queryKey: ["secrets", workspace.environment?.id],
    queryFn: () => api.get<SecretRecord[]>("/secrets", workspace.headers),
    enabled: Boolean(workspace.environment),
  });
  const create = useMutation({
    mutationFn: () => api.post<SecretRecord>("/secrets", { name, value }, workspace.headers),
    onSuccess: async () => {
      setSearchParams({});
      setName("");
      setValue("");
      await queryClient.invalidateQueries({ queryKey: ["secrets"] });
      toast.success("Secret encrypted and stored");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Secret could not be created"),
  });
  const rotate = useMutation({
    mutationFn: () => api.post<SecretRecord>(`/secrets/${rotating?.id}/rotate`, { value }, workspace.headers),
    onSuccess: async () => {
      setRotating(null);
      setValue("");
      await queryClient.invalidateQueries({ queryKey: ["secrets"] });
      toast.success("Secret rotated");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Secret could not be rotated"),
  });
  const remove = useMutation({
    mutationFn: (secret: SecretRecord) => api.delete(`/secrets/${secret.id}`, workspace.headers),
    onSuccess: async () => {
      setDeleting(null);
      await queryClient.invalidateQueries({ queryKey: ["secrets"] });
      toast.success("Secret deleted");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Secret could not be deleted"),
  });
  const filtered = useMemo(
    () => (secrets.data ?? []).filter((secret) => secret.name.toLowerCase().includes(search.toLowerCase())),
    [search, secrets.data],
  );

  return (
    <div className="mx-auto max-w-[1280px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        action={<Button disabled={!workspace.canWrite} onClick={() => setSearchParams({ new: "1" })} variant="primary"><Plus className="h-3.5 w-3.5" /> Create secret</Button>}
        breadcrumbs={[{ label: "Configuration" }, { label: "Secrets" }]}
        description={`Encrypted credentials for ${workspace.project?.name} / ${workspace.environment?.name}.`}
        title="Secret Vault"
      />
      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <Card className="p-4 md:col-span-2">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent/20 bg-accent/[0.06] text-accent"><ShieldCheck className="h-4 w-4" /></div>
            <div><h2 className="text-sm font-medium text-[#d7dde2]">Encrypted at rest</h2><p className="mt-1 text-xs leading-5 text-muted">Values are encrypted before persistence and are never returned by list or detail APIs.</p></div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted">Vault inventory</div>
          <div className="mt-2 text-2xl font-medium text-ink">{secrets.data?.length ?? 0}</div>
          <div className="mt-1 text-[10px] text-muted">secrets in this environment</div>
        </Card>
      </div>
      <Card className="overflow-hidden">
        <div className="flex items-center border-b border-line p-3">
          <div className="relative w-full max-w-xs"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted" /><Input className="h-8 min-h-0 pl-8 text-xs" onChange={(event) => setSearch(event.target.value)} placeholder="Search secret names…" value={search} /></div>
        </div>
        {secrets.isLoading ? (
          <TableSkeleton rows={7} />
        ) : filtered.length ? (
          <div>
            {filtered.map((secret) => (
              <div className="data-row group flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center" key={secret.id}>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-muted"><LockKeyhole className="h-4 w-4" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="font-mono text-xs font-medium text-[#d9dee3]">{secret.name}</span><Badge tone="neutral">v{secret.version}</Badge></div>
                  <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-muted"><EyeOff className="h-3 w-3" /> ••••••••••••••••</div>
                </div>
                <div className="text-left sm:text-right"><div className="text-[10px] text-muted">Updated {formatRelative(secret.updated_at)}</div><div className="mt-1 font-mono text-[9px] text-muted/70" title={formatTimestamp(secret.created_at)}>sec_{secret.id.slice(0, 8)}</div></div>
                <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                  <Button onClick={() => { setValue(""); setRotating(secret); }} size="sm" variant="secondary"><RefreshCcw className="h-3 w-3" /> Rotate</Button>
                  <Button aria-label="Delete secret" onClick={() => setDeleting(secret)} size="icon" variant="ghost"><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState action={<Button onClick={() => setSearchParams({ new: "1" })} size="sm" variant="primary"><Plus className="h-3 w-3" /> Create secret</Button>} description="Store API tokens and signing keys without exposing their values after creation." title="Vault is empty" />
        )}
      </Card>

      <Dialog
        footer={<><Button onClick={() => setSearchParams({})} variant="ghost">Cancel</Button><Button disabled={!name || !value} loading={create.isPending} onClick={() => create.mutate()} variant="primary">Encrypt and store</Button></>}
        onClose={() => setSearchParams({})}
        open={createOpen}
        title="Create secret"
        description="The value is accepted once, encrypted, and never readable through the API."
      >
        <div className="space-y-4">
          <FormField label="Name" hint="Uppercase letters, numbers and underscores only."><Input autoFocus className="font-mono" onChange={(event) => setName(event.target.value.toUpperCase())} placeholder="STRIPE_SECRET" value={name} /></FormField>
          <FormField label="Value"><Input onChange={(event) => setValue(event.target.value)} placeholder="Enter sensitive value" type="password" value={value} /></FormField>
        </div>
      </Dialog>

      <Dialog
        footer={<><Button onClick={() => setRotating(null)} variant="ghost">Cancel</Button><Button disabled={!value} loading={rotate.isPending} onClick={() => rotate.mutate()} variant="primary">Rotate secret</Button></>}
        onClose={() => setRotating(null)}
        open={Boolean(rotating)}
        title={`Rotate ${rotating?.name ?? "secret"}`}
        description="The previous encrypted value is replaced and the version is incremented."
      >
        <FormField label="New value"><Input autoFocus onChange={(event) => setValue(event.target.value)} type="password" value={value} /></FormField>
      </Dialog>

      <Dialog
        footer={<><Button onClick={() => setDeleting(null)} variant="ghost">Cancel</Button><Button loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting)} variant="danger">Delete secret</Button></>}
        onClose={() => setDeleting(null)}
        open={Boolean(deleting)}
        title="Delete secret"
        description={`${deleting?.name ?? "This secret"} will become unavailable to all integrations immediately.`}
      >
        <p className="text-sm text-muted">The encrypted value cannot be recovered after deletion.</p>
      </Dialog>
    </div>
  );
}
