import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Braces,
  Edit3,
  KeyRound,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField, Input, Select, Textarea } from "@/components/ui/Form";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { api, ApiError } from "@/lib/api";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import type { Endpoint } from "@/types";

type AuthType = Endpoint["authentication_type"];

const blankForm = {
  name: "",
  base_url: "",
  method: "GET" as Endpoint["method"],
  path: "/",
  headers: "{}",
  authentication_type: "none" as AuthType,
  authName: "",
  authValue: "",
  authPassword: "",
  timeout_seconds: "15",
  tags: "",
};

export function EndpointsPage() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Endpoint | null>(null);
  const [deleting, setDeleting] = useState<Endpoint | null>(null);
  const [form, setForm] = useState(blankForm);
  const [formError, setFormError] = useState<string | null>(null);
  const formOpen = editing !== null || searchParams.get("new") === "1";

  useEffect(() => {
    if (!formOpen) setForm(blankForm);
  }, [formOpen]);

  const endpoints = useQuery({
    queryKey: ["endpoints", workspace.environment?.id],
    queryFn: () => api.get<Endpoint[]>("/endpoints", workspace.headers),
    enabled: Boolean(workspace.environment),
  });

  const save = useMutation({
    mutationFn: () => {
      let headers: Record<string, string>;
      try {
        headers = JSON.parse(form.headers) as Record<string, string>;
      } catch {
        throw new Error("Headers must contain a valid JSON object.");
      }
      let auth_config: Record<string, string> | undefined;
      if (form.authentication_type === "bearer" && form.authValue) auth_config = { token: form.authValue };
      if (form.authentication_type === "api_key" && form.authValue) {
        auth_config = { header_name: form.authName || "X-API-Key", value: form.authValue };
      }
      if (form.authentication_type === "basic" && form.authValue && form.authPassword) {
        auth_config = { username: form.authValue, password: form.authPassword };
      }
      const payload: Record<string, unknown> = {
        name: form.name,
        base_url: form.base_url,
        method: form.method,
        path: form.path,
        headers,
        authentication_type: form.authentication_type,
        timeout_seconds: Number(form.timeout_seconds),
        tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      };
      if (!editing || auth_config) payload.auth_config = auth_config ?? null;
      return editing
        ? api.patch<Endpoint>(`/endpoints/${editing.id}`, payload, workspace.headers)
        : api.post<Endpoint>("/endpoints", payload, workspace.headers);
    },
    onSuccess: async () => {
      setEditing(null);
      setSearchParams({});
      setForm(blankForm);
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: ["endpoints"] });
      toast.success(editing ? "Endpoint updated" : "Endpoint created");
    },
    onError: (error) => {
      const message = error instanceof ApiError || error instanceof Error ? error.message : "Endpoint could not be saved";
      setFormError(message);
      toast.error(message);
    },
  });
  const remove = useMutation({
    mutationFn: (endpoint: Endpoint) => api.delete(`/endpoints/${endpoint.id}`, workspace.headers),
    onSuccess: async () => {
      setDeleting(null);
      await queryClient.invalidateQueries({ queryKey: ["endpoints"] });
      toast.success("Endpoint deleted");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Endpoint could not be deleted"),
  });

  const openEdit = (endpoint: Endpoint) => {
    setEditing(endpoint);
    setForm({
      name: endpoint.name,
      base_url: endpoint.base_url,
      method: endpoint.method,
      path: endpoint.path,
      headers: JSON.stringify(endpoint.headers, null, 2),
      authentication_type: endpoint.authentication_type,
      authName: "",
      authValue: "",
      authPassword: "",
      timeout_seconds: String(endpoint.timeout_seconds),
      tags: endpoint.tags.join(", "),
    });
  };
  const closeForm = () => {
    setEditing(null);
    setSearchParams({});
    setForm(blankForm);
    setFormError(null);
  };
  const filtered = useMemo(
    () =>
      (endpoints.data ?? []).filter((endpoint) =>
        `${endpoint.name} ${endpoint.base_url} ${endpoint.tags.join(" ")}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [endpoints.data, search],
  );

  return (
    <div className="mx-auto max-w-[1380px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        action={<Button disabled={!workspace.canWrite} onClick={() => setSearchParams({ new: "1" })} variant="primary"><Plus className="h-3.5 w-3.5" /> Register endpoint</Button>}
        breadcrumbs={[{ label: "Configuration" }, { label: "Endpoints" }]}
        description={`Reusable request definitions and encrypted credentials for ${workspace.environment?.name}.`}
        title="Endpoint Registry"
      />
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b border-line p-3">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted" />
            <Input className="h-8 min-h-0 pl-8 text-xs" onChange={(event) => setSearch(event.target.value)} placeholder="Search endpoints…" value={search} />
          </div>
          <span className="ml-auto text-[10px] text-muted">{filtered.length} registered</span>
        </div>
        {endpoints.isLoading ? (
          <TableSkeleton rows={8} />
        ) : filtered.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-left">
              <thead><tr className="h-10 border-b border-line text-[10px] uppercase tracking-wider text-muted"><th className="px-4 font-medium">Endpoint</th><th className="px-3 font-medium">Method</th><th className="px-3 font-medium">Authentication</th><th className="px-3 font-medium">Timeout</th><th className="px-3 font-medium">Tags</th><th className="w-24" /></tr></thead>
              <tbody>
                {filtered.map((endpoint) => (
                  <tr className="data-row text-xs" key={endpoint.id}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2"><Braces className="h-3.5 w-3.5 text-muted" /><span className="font-medium text-[#d7dde2]">{endpoint.name}</span></div>
                      <div className="mt-1 max-w-xl truncate font-mono text-[10px] text-muted">{endpoint.base_url}{endpoint.path}</div>
                    </td>
                    <td className="px-3 py-3"><Badge tone={endpoint.method === "GET" ? "success" : "info"}>{endpoint.method}</Badge></td>
                    <td className="px-3 py-3"><span className="flex items-center gap-1.5 capitalize text-[11px] text-muted"><KeyRound className="h-3 w-3" /> {endpoint.authentication_type.replace("_", " ")}</span></td>
                    <td className="px-3 py-3 font-mono text-[10px] text-muted">{endpoint.timeout_seconds}s</td>
                    <td className="px-3 py-3"><div className="flex flex-wrap gap-1">{endpoint.tags.slice(0, 3).map((tag) => <Badge key={tag} tone="neutral">{tag}</Badge>)}</div></td>
                    <td className="px-3 py-3"><div className="flex justify-end gap-1"><Button aria-label="Edit endpoint" onClick={() => openEdit(endpoint)} size="icon" variant="ghost"><Edit3 className="h-3.5 w-3.5" /></Button><Button aria-label="Delete endpoint" onClick={() => setDeleting(endpoint)} size="icon" variant="ghost"><Trash2 className="h-3.5 w-3.5" /></Button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState action={<Button onClick={() => setSearchParams({ new: "1" })} size="sm" variant="primary"><Plus className="h-3 w-3" /> Register endpoint</Button>} description="Store a reusable API definition, timeout policy and encrypted authentication configuration." title="No registered endpoints" />
        )}
      </Card>

      <Dialog
        footer={<><Button onClick={closeForm} variant="ghost">Cancel</Button><Button disabled={!form.name || !form.base_url} loading={save.isPending} onClick={() => save.mutate()} variant="primary">{editing ? "Save changes" : "Register endpoint"}</Button></>}
        onClose={closeForm}
        open={formOpen}
        title={editing ? "Edit endpoint" : "Register endpoint"}
        description="Credentials are encrypted at rest and never returned by the API."
        wide
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name"><Input autoFocus onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Stripe API" value={form.name} /></FormField>
          <FormField label="Method"><Select onChange={(event) => setForm((current) => ({ ...current, method: event.target.value as Endpoint["method"] }))} value={form.method}>{["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => <option key={method}>{method}</option>)}</Select></FormField>
          <FormField className="sm:col-span-2" label="Base URL"><Input onChange={(event) => setForm((current) => ({ ...current, base_url: event.target.value }))} placeholder="https://api.stripe.com" type="url" value={form.base_url} /></FormField>
          <FormField label="Path"><Input className="font-mono" onChange={(event) => setForm((current) => ({ ...current, path: event.target.value }))} value={form.path} /></FormField>
          <FormField label="Timeout (seconds)"><Input max={60} min={1} onChange={(event) => setForm((current) => ({ ...current, timeout_seconds: event.target.value }))} type="number" value={form.timeout_seconds} /></FormField>
          <FormField className="sm:col-span-2" label="Headers"><Textarea className="h-28 font-mono text-xs" onChange={(event) => setForm((current) => ({ ...current, headers: event.target.value }))} spellCheck={false} value={form.headers} /></FormField>
          <FormField label="Authentication"><Select onChange={(event) => setForm((current) => ({ ...current, authentication_type: event.target.value as AuthType }))} value={form.authentication_type}><option value="none">None</option><option value="bearer">Bearer token</option><option value="api_key">API key header</option><option value="basic">Basic auth</option></Select></FormField>
          <FormField label="Tags" hint="Comma-separated"><Input onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))} placeholder="payments, external" value={form.tags} /></FormField>
          {form.authentication_type === "api_key" && <FormField label="Header name"><Input onChange={(event) => setForm((current) => ({ ...current, authName: event.target.value }))} placeholder="X-API-Key" value={form.authName} /></FormField>}
          {form.authentication_type !== "none" && <FormField label={form.authentication_type === "basic" ? "Username" : form.authentication_type === "bearer" ? "Bearer token" : "API key"} hint={editing ? "Leave blank to keep the existing value." : undefined}><Input onChange={(event) => setForm((current) => ({ ...current, authValue: event.target.value }))} type={form.authentication_type === "basic" ? "text" : "password"} value={form.authValue} /></FormField>}
          {form.authentication_type === "basic" && <FormField label="Password"><Input onChange={(event) => setForm((current) => ({ ...current, authPassword: event.target.value }))} type="password" value={form.authPassword} /></FormField>}
          {formError && <div className="sm:col-span-2 rounded-[7px] border border-danger/20 bg-danger/[0.06] px-3 py-2.5 text-xs text-danger">{formError}</div>}
        </div>
      </Dialog>

      <Dialog
        footer={<><Button onClick={() => setDeleting(null)} variant="ghost">Cancel</Button><Button loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting)} variant="danger">Delete endpoint</Button></>}
        onClose={() => setDeleting(null)}
        open={Boolean(deleting)}
        title="Delete endpoint"
        description={`Request history remains available, but ${deleting?.name ?? "this endpoint"} can no longer be executed from the registry.`}
      >
        <p className="text-sm text-muted">This action cannot be undone.</p>
      </Dialog>
    </div>
  );
}
