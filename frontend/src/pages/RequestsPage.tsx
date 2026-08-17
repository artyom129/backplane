import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Braces,
  Clock3,
  History,
  LoaderCircle,
  Search,
  Send,
  ServerCrash,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField, Input, Select, Textarea } from "@/components/ui/Form";
import { JsonViewer } from "@/components/ui/JsonViewer";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatBytes, formatRelative, formatTimestamp } from "@/lib/format";
import { useWorkspace } from "@/providers/WorkspaceProvider";
import type { Endpoint, Page, RequestRecord } from "@/types";

type InspectorTab = "body" | "headers" | "request";

export function RequestsPage() {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);
  const [endpointId, setEndpointId] = useState("");
  const [method, setMethod] = useState<Endpoint["method"]>("GET");
  const [url, setUrl] = useState("");
  const [headersText, setHeadersText] = useState("{}");
  const [bodyText, setBodyText] = useState("");
  const [response, setResponse] = useState<RequestRecord | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("body");
  const [historySearch, setHistorySearch] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

  const endpoints = useQuery({
    queryKey: ["endpoints", workspace.environment?.id],
    queryFn: () => api.get<Endpoint[]>("/endpoints", workspace.headers),
    enabled: Boolean(workspace.environment),
  });
  const history = useQuery({
    queryKey: ["requests", workspace.project?.id],
    queryFn: () => api.get<Page<RequestRecord>>("/requests?page_size=25", workspace.headers),
    enabled: Boolean(workspace.project),
  });

  useEffect(() => {
    if (searchParams.get("focus") === "search") searchRef.current?.focus();
  }, [searchParams]);

  const selectEndpoint = (id: string) => {
    setEndpointId(id);
    const endpoint = endpoints.data?.find((item) => item.id === id);
    if (endpoint) {
      setMethod(endpoint.method);
      setUrl(`${endpoint.base_url.replace(/\/$/, "")}/${endpoint.path.replace(/^\//, "")}`);
      setHeadersText(JSON.stringify(endpoint.headers, null, 2));
    }
  };

  const sendRequest = useMutation({
    mutationFn: async () => {
      setInputError(null);
      let parsedHeaders: Record<string, string>;
      let parsedBody: unknown = null;
      try {
        parsedHeaders = JSON.parse(headersText) as Record<string, string>;
        if (bodyText.trim()) parsedBody = JSON.parse(bodyText);
      } catch {
        throw new Error("Headers and body must contain valid JSON.");
      }
      return api.post<RequestRecord>(
        "/requests/execute",
        {
          endpoint_id: endpointId || null,
          method,
          url,
          headers: parsedHeaders,
          body: parsedBody,
        },
        workspace.headers,
      );
    },
    onSuccess: async (record) => {
      setResponse(record);
      setInspectorTab("body");
      await queryClient.invalidateQueries({ queryKey: ["requests", workspace.project?.id] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", workspace.project?.id] });
      if (record.outcome === "success") toast.success(`Request completed with HTTP ${record.status_code}`);
      else toast.error(record.error ?? `Request returned HTTP ${record.status_code}`);
    },
    onError: (error) => {
      const message = error instanceof ApiError || error instanceof Error ? error.message : "Request failed.";
      setInputError(message);
      toast.error(message);
    },
  });

  const loadHistory = async (record: RequestRecord) => {
    try {
      setResponse(await api.get<RequestRecord>(`/requests/${record.id}`, workspace.headers));
      setInspectorTab("body");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Request details could not be loaded");
    }
  };

  const filteredHistory = useMemo(
    () =>
      (history.data?.items ?? []).filter((item) =>
        `${item.method} ${item.url} ${item.status_code ?? ""}`
          .toLowerCase()
          .includes(historySearch.toLowerCase()),
      ),
    [history.data?.items, historySearch],
  );

  const canHaveBody = !["GET", "DELETE"].includes(method);

  return (
    <div className="mx-auto max-w-[1540px] p-4 sm:p-6 lg:p-8">
      <PageHeader
        breadcrumbs={[{ label: "Operations" }, { label: "Requests" }]}
        description="Execute authenticated API calls and inspect every byte of the response."
        title="Request Console"
      />
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_330px]">
        <Card className="overflow-hidden">
          <div className="grid min-h-[650px] lg:grid-cols-[minmax(310px,0.85fr)_minmax(400px,1.15fr)]">
            <form
              className="border-b border-line p-4 lg:border-b-0 lg:border-r"
              onSubmit={(event) => {
                event.preventDefault();
                sendRequest.mutate();
              }}
            >
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <div className="eyebrow">Request configuration</div>
                  <div className="mt-1 text-xs text-muted">{workspace.environment?.name} environment</div>
                </div>
                <Braces className="h-4 w-4 text-muted" />
              </div>
              <div className="space-y-4">
                <FormField label="Registered endpoint">
                  <Select onChange={(event) => selectEndpoint(event.target.value)} value={endpointId}>
                    <option value="">Ad-hoc request</option>
                    {endpoints.data?.map((endpoint) => (
                      <option key={endpoint.id} value={endpoint.id}>
                        {endpoint.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="URL">
                  <div className="flex gap-2">
                    <Select
                      className="w-[104px] shrink-0 font-mono font-medium"
                      onChange={(event) => setMethod(event.target.value as Endpoint["method"])}
                      value={method}
                    >
                      {(["GET", "POST", "PUT", "PATCH", "DELETE"] as const).map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </Select>
                    <Input
                      className="font-mono text-xs"
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder="https://api.example.com/v1/health"
                      required
                      type="url"
                      value={url}
                    />
                  </div>
                </FormField>
                <FormField label="Headers" hint="Sensitive authorization headers are redacted in history.">
                  <Textarea
                    className="h-32 font-mono text-xs leading-5"
                    onChange={(event) => setHeadersText(event.target.value)}
                    spellCheck={false}
                    value={headersText}
                  />
                </FormField>
                {canHaveBody && (
                  <FormField label="JSON body">
                    <Textarea
                      className="h-44 font-mono text-xs leading-5"
                      onChange={(event) => setBodyText(event.target.value)}
                      placeholder={'{\n  "event": "ping"\n}'}
                      spellCheck={false}
                      value={bodyText}
                    />
                  </FormField>
                )}
                {inputError && (
                  <div className="rounded-[7px] border border-danger/20 bg-danger/[0.06] px-3 py-2.5 text-xs text-danger">
                    {inputError}
                  </div>
                )}
                <Button
                  className="w-full"
                  disabled={!workspace.canWrite || !url}
                  loading={sendRequest.isPending}
                  type="submit"
                  variant="primary"
                >
                  <Send className="h-3.5 w-3.5" /> Send request
                </Button>
              </div>
            </form>

            <section className="relative min-w-0 bg-[#0c0f12]">
              {sendRequest.isPending && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0c0f12]/80 backdrop-blur-sm">
                  <div className="text-center">
                    <LoaderCircle className="mx-auto h-5 w-5 animate-spin text-accent" />
                    <div className="mt-3 text-xs text-muted">Waiting for upstream response…</div>
                  </div>
                </div>
              )}
              {response ? (
                <div>
                  <div className="border-b border-line p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <Badge tone={response.outcome === "success" ? "success" : "error"}>
                        {response.status_code ? `HTTP ${response.status_code}` : "Network error"}
                      </Badge>
                      <div className="flex items-center gap-1.5 text-xs text-muted">
                        <Clock3 className="h-3 w-3" /> {response.duration_ms.toFixed(0)} ms
                      </div>
                      <div className="text-xs text-muted">{formatBytes(response.response_size)}</div>
                      <time className="ml-auto text-[10px] text-muted">{formatTimestamp(response.created_at)}</time>
                    </div>
                    <div className="mt-3 truncate font-mono text-[11px] text-[#abb4bd]">
                      {response.method} {response.url}
                    </div>
                  </div>
                  <Tabs<InspectorTab>
                    items={[
                      { value: "body", label: "Response" },
                      { value: "headers", label: "Headers" },
                      { value: "request", label: "Request" },
                    ]}
                    onChange={setInspectorTab}
                    value={inspectorTab}
                  />
                  <div className="p-4">
                    {response.error ? (
                      <div className="rounded-lg border border-danger/20 bg-danger/[0.05] p-4">
                        <div className="flex items-center gap-2 text-sm font-medium text-danger">
                          <ServerCrash className="h-4 w-4" /> Request failed
                        </div>
                        <p className="mt-2 text-xs leading-5 text-muted">{response.error}</p>
                      </div>
                    ) : inspectorTab === "body" ? (
                      response.response_body !== null && response.response_body !== undefined ? (
                        <JsonViewer value={response.response_body} />
                      ) : (
                        <div className="rounded-lg border border-line bg-[#090c0f] p-4 font-mono text-xs leading-5 text-[#c5ccd3] whitespace-pre-wrap">
                          {response.response_text || "The response body is empty."}
                        </div>
                      )
                    ) : inspectorTab === "headers" ? (
                      <JsonViewer value={response.response_headers ?? {}} />
                    ) : (
                      <JsonViewer
                        value={{
                          headers: response.request_headers ?? {},
                          body: response.request_body ?? null,
                        }}
                      />
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex min-h-[620px] items-center justify-center p-6">
                  <EmptyState
                    description="Configure a registered endpoint or enter an ad-hoc URL. The complete response will appear here."
                    title="Ready to send"
                  />
                </div>
              )}
            </section>
          </div>
        </Card>

        <Card className="h-fit overflow-hidden">
          <div className="border-b border-line p-3">
            <div className="mb-3 flex items-center gap-2 px-1">
              <History className="h-3.5 w-3.5 text-muted" />
              <span className="text-xs font-medium text-[#d7dce1]">Request history</span>
              <span className="ml-auto text-[10px] text-muted">{history.data?.total ?? 0}</span>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted" />
              <Input
                className="h-8 min-h-0 pl-8 text-xs"
                onChange={(event) => setHistorySearch(event.target.value)}
                placeholder="Filter requests…"
                ref={searchRef}
                value={historySearch}
              />
            </div>
          </div>
          {history.isLoading ? (
            <TableSkeleton rows={8} />
          ) : filteredHistory.length ? (
            <div className="max-h-[650px] overflow-auto">
              {filteredHistory.map((record) => (
                <button
                  className={cn(
                    "data-row flex w-full items-center gap-3 px-3 py-3 text-left",
                    response?.id === record.id && "bg-white/[0.035]",
                  )}
                  key={record.id}
                  onClick={() => void loadHistory(record)}
                  type="button"
                >
                  <span className={`font-mono text-[10px] font-medium ${record.outcome === "success" ? "text-accent" : "text-danger"}`}>
                    {record.method}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[10px] text-[#cbd2d8]">{record.url}</div>
                    <div className="mt-1 flex items-center gap-2 text-[9px] text-muted">
                      <span>{record.status_code ?? "ERR"}</span>
                      <span>·</span>
                      <span>{record.duration_ms.toFixed(0)} ms</span>
                      <span>·</span>
                      <span>{formatRelative(record.created_at)}</span>
                    </div>
                  </div>
                  <ArrowRight className="h-3 w-3 text-muted/50" />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState compact description="Executed requests will be retained here." title="No matching history" />
          )}
        </Card>
      </div>
    </div>
  );
}
