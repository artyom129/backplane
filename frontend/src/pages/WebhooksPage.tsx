import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronRight,
  CircleSlash,
  ExternalLink,
  Plus,
  RefreshCcw,
  RotateCcw,
  Search,
  ShieldCheck,
  Webhook,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Badge, statusTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CopyButton";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField, Input, Select } from "@/components/ui/Form";
import { JsonViewer } from "@/components/ui/JsonViewer";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatBytes, formatRelative, formatTimestamp, shortId } from "@/lib/format";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import type {
  Delivery,
  Page,
  WebhookDestination,
  WebhookEndpoint,
  WebhookEvent,
  WebhookEventDetail,
} from "@/types";

type InspectorTab = "overview" | "headers" | "payload" | "deliveries";

function SignatureBadge({ status }: { status: WebhookEvent["signature_status"] }) {
  if (status === "verified") return <Badge tone="success">Verified</Badge>;
  if (status === "invalid") return <Badge tone="error">Invalid</Badge>;
  return <Badge tone="neutral">Not configured</Badge>;
}

function DeliveryTimeline({
  deliveries,
  onRetry,
  retrying,
}: {
  deliveries: Delivery[];
  onRetry(id: string): void;
  retrying: boolean;
}) {
  if (!deliveries.length) {
    return (
      <EmptyState
        compact
        description="No active destination was configured when this event arrived."
        title="No delivery attempts"
      />
    );
  }
  return (
    <div className="space-y-0">
      {deliveries.map((delivery, index) => (
        <div className="relative flex gap-3 pb-5 last:pb-0" key={delivery.id}>
          {index < deliveries.length - 1 && (
            <span className="absolute left-[7px] top-4 h-full w-px bg-line" />
          )}
          <span
            className={cn(
              "relative z-10 mt-1.5 h-[15px] w-[15px] shrink-0 rounded-full border-4 border-raised",
              delivery.status === "delivered"
                ? "bg-accent"
                : delivery.status === "dead_letter" || delivery.status === "failed"
                  ? "bg-danger"
                  : "bg-warning",
            )}
          />
          <div className="min-w-0 flex-1 rounded-lg border border-line bg-surface p-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-[#d7dde2]">{delivery.destination_name}</span>
              <Badge tone={statusTone(delivery.status)}>Attempt {delivery.attempt_number}</Badge>
              <time className="ml-auto text-[10px] text-muted">{formatTimestamp(delivery.created_at)}</time>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[10px] text-muted">
              <span>HTTP {delivery.status_code ?? "—"}</span>
              <span>{delivery.duration_ms ? `${delivery.duration_ms.toFixed(0)} ms` : "No response"}</span>
              <span className="capitalize">{delivery.status.replace("_", " ")}</span>
            </div>
            {delivery.error && <p className="mt-2 text-xs text-danger">{delivery.error}</p>}
            {["failed", "dead_letter"].includes(delivery.status) && (
              <Button
                className="mt-3"
                loading={retrying}
                onClick={() => onRetry(delivery.id)}
                size="sm"
                variant="secondary"
              >
                <RefreshCcw className="h-3 w-3" /> Retry now
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function WebhooksPage() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { eventId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [createEndpointOpen, setCreateEndpointOpen] = useState(searchParams.get("new") === "1");
  const [createDestinationOpen, setCreateDestinationOpen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("overview");
  const [endpointForm, setEndpointForm] = useState({
    name: "",
    signing_secret: "",
    signature_header: "X-Webhook-Signature",
  });
  const [destinationForm, setDestinationForm] = useState({
    webhook_endpoint_id: "",
    name: "",
    url: "",
    method: "POST",
    secret: "",
  });

  useEffect(() => {
    if (searchParams.get("new") === "1") setCreateEndpointOpen(true);
  }, [searchParams]);

  const endpoints = useQuery({
    queryKey: ["webhook-endpoints", workspace.project?.id],
    queryFn: () => api.get<WebhookEndpoint[]>("/webhooks/endpoints", workspace.headers),
    enabled: Boolean(workspace.project),
  });
  const events = useQuery({
    queryKey: ["webhook-events", workspace.project?.id],
    queryFn: () => api.get<Page<WebhookEvent>>("/webhooks/events?page_size=50", workspace.headers),
    enabled: Boolean(workspace.project),
    refetchInterval: 10_000,
  });
  const eventDetail = useQuery({
    queryKey: ["webhook-event", eventId],
    queryFn: () => api.get<WebhookEventDetail>(`/webhooks/events/${eventId}`, workspace.headers),
    enabled: Boolean(eventId),
  });

  const createEndpoint = useMutation({
    mutationFn: () =>
      api.post<WebhookEndpoint>(
        "/webhooks/endpoints",
        {
          name: endpointForm.name,
          signing_secret: endpointForm.signing_secret || null,
          signature_header: endpointForm.signature_header,
        },
        workspace.headers,
      ),
    onSuccess: async (endpoint) => {
      setCreateEndpointOpen(false);
      setSearchParams({});
      setEndpointForm({ name: "", signing_secret: "", signature_header: "X-Webhook-Signature" });
      setDestinationForm((current) => ({ ...current, webhook_endpoint_id: endpoint.id }));
      await queryClient.invalidateQueries({ queryKey: ["webhook-endpoints"] });
      toast.success("Inbound webhook endpoint created");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Endpoint could not be created"),
  });

  const createDestination = useMutation({
    mutationFn: () =>
      api.post<WebhookDestination>(
        "/webhooks/destinations",
        {
          ...destinationForm,
          secret: destinationForm.secret || null,
          headers: {},
          timeout_seconds: 15,
        },
        workspace.headers,
      ),
    onSuccess: async () => {
      setCreateDestinationOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["webhook-destinations"] });
      toast.success("Forwarding destination created");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Destination could not be created"),
  });

  const replay = useMutation({
    mutationFn: (id: string) => api.post<{ deliveries_enqueued: number }>(`/webhooks/events/${id}/replay`, {}, workspace.headers),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["webhook-event", eventId] });
      toast.success(`${result.deliveries_enqueued} delivery${result.deliveries_enqueued === 1 ? "" : "ies"} enqueued`);
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Replay failed"),
  });
  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/webhooks/deliveries/${id}/retry`, {}, workspace.headers),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["webhook-event", eventId] });
      toast.success("Delivery retry enqueued");
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : "Retry failed"),
  });

  const filteredEvents = useMemo(
    () =>
      (events.data?.items ?? []).filter((event) =>
        `${event.event_type} ${event.endpoint_name} ${event.source_ip}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [events.data?.items, search],
  );
  const selected = eventDetail.data;

  return (
    <div className="mx-auto max-w-[1540px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        action={
          <div className="flex items-center gap-2">
            {endpoints.data?.length ? (
              <Button disabled={!workspace.canWrite} onClick={() => setCreateDestinationOpen(true)} variant="secondary">
                <ExternalLink className="h-3.5 w-3.5" /> Add destination
              </Button>
            ) : null}
            <Button disabled={!workspace.canWrite} onClick={() => setCreateEndpointOpen(true)} variant="primary">
              <Plus className="h-3.5 w-3.5" /> Create webhook
            </Button>
          </div>
        }
        breadcrumbs={[{ label: "Operations" }, { label: "Webhooks" }]}
        description="Capture, inspect and reliably forward inbound events."
        title="Webhook Inbox"
      />

      {endpoints.data?.length ? (
        <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {endpoints.data.map((endpoint) => (
            <Card className="p-3.5" key={endpoint.id}>
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-accent/20 bg-accent/[0.06] text-accent">
                  <Webhook className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-medium text-[#d9dee3]">{endpoint.name}</span>
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  </div>
                  <div className="mt-1 truncate font-mono text-[10px] text-muted">{endpoint.url}</div>
                </div>
                <CopyButton value={endpoint.url} />
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      <div className={cn("grid gap-5", eventId && "2xl:grid-cols-[minmax(0,1fr)_470px]") }>
        <Card className="min-w-0 overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-line p-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted" />
              <Input
                className="h-8 min-h-0 pl-8 text-xs"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Filter by event, endpoint or IP…"
                value={search}
              />
            </div>
            <div className="ml-auto flex items-center gap-3 text-[10px] text-muted">
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> Live capture</span>
              <span>{events.data?.total ?? 0} events</span>
            </div>
          </div>
          {events.isLoading ? (
            <TableSkeleton rows={8} />
          ) : filteredEvents.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left">
                <thead>
                  <tr className="h-10 border-b border-line text-[10px] uppercase tracking-wider text-muted">
                    <th className="px-4 font-medium">Time</th>
                    <th className="px-3 font-medium">Event</th>
                    <th className="px-3 font-medium">Signature</th>
                    <th className="px-3 font-medium">Delivery</th>
                    <th className="px-3 font-medium">Source</th>
                    <th className="px-3 font-medium">Size</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((event) => (
                    <tr
                      className={cn(
                        "data-row cursor-pointer text-xs",
                        event.id === eventId && "bg-white/[0.035]",
                      )}
                      key={event.id}
                      onClick={() => navigate(`/webhooks/${event.id}`)}
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-[10px] text-muted" title={formatTimestamp(event.received_at)}>
                        {formatRelative(event.received_at)}
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-mono text-[11px] font-medium text-[#d9dee3]">{event.event_type}</div>
                        <div className="mt-1 text-[10px] text-muted">{event.endpoint_name} · {shortId(event.id)}</div>
                      </td>
                      <td className="px-3 py-3"><SignatureBadge status={event.signature_status} /></td>
                      <td className="px-3 py-3">
                        <Badge tone={statusTone(event.delivery_status)}>
                          {event.delivery_status?.replace("_", " ") ?? "captured"}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 font-mono text-[10px] text-muted">{event.source_ip}</td>
                      <td className="px-3 py-3 text-[10px] text-muted">{formatBytes(event.size_bytes)}</td>
                      <td className="px-3 py-3"><ChevronRight className="h-3.5 w-3.5 text-muted" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              action={
                !endpoints.data?.length ? (
                  <Button onClick={() => setCreateEndpointOpen(true)} size="sm" variant="primary">
                    <Plus className="h-3 w-3" /> Create webhook endpoint
                  </Button>
                ) : undefined
              }
              description={
                endpoints.data?.length
                  ? "POST an event to one of the inbound URLs above. It will appear here immediately."
                  : "Create an inbound endpoint to receive and inspect your first event."
              }
              title="No webhook events"
            />
          )}
        </Card>

        {eventId && (
          <Card className="h-fit min-w-0 overflow-hidden 2xl:sticky 2xl:top-20">
            {eventDetail.isLoading ? (
              <TableSkeleton rows={7} />
            ) : selected ? (
              <>
                <div className="border-b border-line p-4">
                  <div className="flex items-start gap-3">
                    <Button aria-label="Close inspector" onClick={() => navigate("/webhooks")} size="icon" variant="ghost">
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div className="min-w-0 flex-1">
                      <div className="eyebrow">Event inspector</div>
                      <h2 className="mt-1 truncate font-mono text-sm font-medium text-ink">{selected.event_type}</h2>
                      <div className="mt-1 font-mono text-[10px] text-muted">evt_{selected.id}</div>
                    </div>
                    <Button
                      loading={replay.isPending}
                      onClick={() => replay.mutate(selected.id)}
                      size="sm"
                      variant="secondary"
                    >
                      <RotateCcw className="h-3 w-3" /> Replay
                    </Button>
                  </div>
                </div>
                <Tabs<InspectorTab>
                  items={[
                    { value: "overview", label: "Overview" },
                    { value: "headers", label: "Headers" },
                    { value: "payload", label: "Payload" },
                    { value: "deliveries", label: "Attempts", count: selected.deliveries.length },
                  ]}
                  onChange={setInspectorTab}
                  value={inspectorTab}
                />
                <div className="max-h-[calc(100vh-230px)] overflow-auto p-4">
                  {inspectorTab === "overview" && (
                    <div className="space-y-5">
                      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line">
                        {[
                          ["Received", formatTimestamp(selected.received_at)],
                          ["Source IP", selected.source_ip],
                          ["Method", selected.method],
                          ["Size", formatBytes(selected.size_bytes)],
                        ].map(([label, value]) => (
                          <div className="bg-surface p-3" key={label}>
                            <div className="text-[10px] text-muted">{label}</div>
                            <div className="mt-1 font-mono text-[11px] text-[#d4dae0]">{value}</div>
                          </div>
                        ))}
                      </div>
                      <div>
                        <div className="eyebrow mb-2">Signature validation</div>
                        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface p-3">
                          {selected.signature_status === "verified" ? (
                            <ShieldCheck className="h-4 w-4 text-accent" />
                          ) : selected.signature_status === "invalid" ? (
                            <XCircle className="h-4 w-4 text-danger" />
                          ) : (
                            <CircleSlash className="h-4 w-4 text-muted" />
                          )}
                          <div>
                            <div className="text-xs font-medium text-[#d4dae0] capitalize">
                              {selected.signature_status.replace("_", " ")}
                            </div>
                            <div className="mt-0.5 text-[10px] text-muted">
                              HMAC SHA-256 verification result at ingress
                            </div>
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="eyebrow mb-2">Query parameters</div>
                        <JsonViewer value={selected.query_params} />
                      </div>
                    </div>
                  )}
                  {inspectorTab === "headers" && <JsonViewer value={selected.headers} />}
                  {inspectorTab === "payload" && (
                    selected.payload !== null ? (
                      <JsonViewer value={selected.payload} />
                    ) : (
                      <div className="rounded-lg border border-line bg-surface p-4 font-mono text-xs leading-5 text-[#cbd1d7] whitespace-pre-wrap">
                        {selected.raw_body || "Empty payload"}
                      </div>
                    )
                  )}
                  {inspectorTab === "deliveries" && (
                    <DeliveryTimeline
                      deliveries={selected.deliveries}
                      onRetry={(id) => retry.mutate(id)}
                      retrying={retry.isPending}
                    />
                  )}
                </div>
              </>
            ) : (
              <EmptyState compact description="This event may have been deleted." title="Event unavailable" />
            )}
          </Card>
        )}
      </div>

      <Dialog
        footer={
          <>
            <Button onClick={() => setCreateEndpointOpen(false)} variant="ghost">Cancel</Button>
            <Button
              disabled={!endpointForm.name}
              loading={createEndpoint.isPending}
              onClick={() => createEndpoint.mutate()}
              variant="primary"
            >
              Create endpoint
            </Button>
          </>
        }
        onClose={() => setCreateEndpointOpen(false)}
        open={createEndpointOpen}
        title="Create inbound webhook"
        description="A stable public URL will be generated for this project."
      >
        <div className="space-y-4">
          <FormField label="Name">
            <Input
              autoFocus
              onChange={(event) => setEndpointForm((form) => ({ ...form, name: event.target.value }))}
              placeholder="Stripe production"
              value={endpointForm.name}
            />
          </FormField>
          <FormField label="Signing secret" hint="Optional. Incoming HMAC SHA-256 signatures are checked against this secret.">
            <Input
              onChange={(event) => setEndpointForm((form) => ({ ...form, signing_secret: event.target.value }))}
              placeholder="whsec_••••••••"
              type="password"
              value={endpointForm.signing_secret}
            />
          </FormField>
          <FormField label="Signature header">
            <Input
              onChange={(event) => setEndpointForm((form) => ({ ...form, signature_header: event.target.value }))}
              value={endpointForm.signature_header}
            />
          </FormField>
        </div>
      </Dialog>

      <Dialog
        footer={
          <>
            <Button onClick={() => setCreateDestinationOpen(false)} variant="ghost">Cancel</Button>
            <Button
              disabled={!destinationForm.webhook_endpoint_id || !destinationForm.name || !destinationForm.url}
              loading={createDestination.isPending}
              onClick={() => createDestination.mutate()}
              variant="primary"
            >
              Add destination
            </Button>
          </>
        }
        onClose={() => setCreateDestinationOpen(false)}
        open={createDestinationOpen}
        title="Add forwarding destination"
        description={`Events are delivered through ${workspace.environment?.name} with 1m, 5m and 15m retry delays.`}
      >
        <div className="space-y-4">
          <FormField label="Inbound endpoint">
            <Select
              onChange={(event) => setDestinationForm((form) => ({ ...form, webhook_endpoint_id: event.target.value }))}
              value={destinationForm.webhook_endpoint_id}
            >
              <option value="">Select endpoint</option>
              {endpoints.data?.map((endpoint) => <option key={endpoint.id} value={endpoint.id}>{endpoint.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Destination name">
            <Input onChange={(event) => setDestinationForm((form) => ({ ...form, name: event.target.value }))} placeholder="Payments worker" value={destinationForm.name} />
          </FormField>
          <FormField label="Destination URL">
            <div className="flex gap-2">
              <Select className="w-24" onChange={(event) => setDestinationForm((form) => ({ ...form, method: event.target.value }))} value={destinationForm.method}>
                <option>POST</option><option>PUT</option><option>PATCH</option>
              </Select>
              <Input onChange={(event) => setDestinationForm((form) => ({ ...form, url: event.target.value }))} placeholder="https://worker.example.com/hooks" type="url" value={destinationForm.url} />
            </div>
          </FormField>
          <FormField label="Signing secret" hint="BACKPLANE signs each forwarded body in X-Backplane-Signature.">
            <Input onChange={(event) => setDestinationForm((form) => ({ ...form, secret: event.target.value }))} type="password" value={destinationForm.secret} />
          </FormField>
        </div>
      </Dialog>
    </div>
  );
}
