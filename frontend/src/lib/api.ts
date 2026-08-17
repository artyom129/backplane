import type { Tokens } from "@/types";

const API_URL = import.meta.env.VITE_API_URL ?? "/api/v1";
const REFRESH_KEY = "backplane.refresh";

type ErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let authFailureHandler: (() => void) | null = null;
let workspaceHeaders: Record<string, string> = {};

export function setAuthFailureHandler(handler: (() => void) | null): void {
  authFailureHandler = handler;
}

export function setWorkspaceHeaders(headers: Record<string, string>): void {
  workspaceHeaders = headers;
}

export function saveTokens(tokens: Tokens): void {
  accessToken = tokens.access_token;
  sessionStorage.setItem(REFRESH_KEY, tokens.refresh_token);
}

export function clearTokens(): void {
  accessToken = null;
  sessionStorage.removeItem(REFRESH_KEY);
}

export function currentRefreshToken(): string | null {
  return sessionStorage.getItem(REFRESH_KEY);
}

async function parseError(response: Response): Promise<ApiError> {
  let payload: ErrorPayload = {};
  try {
    payload = (await response.json()) as ErrorPayload;
  } catch {
    // A reverse proxy can return a non-JSON response before FastAPI handles the request.
  }
  return new ApiError(
    response.status,
    payload.error?.code ?? "request_failed",
    payload.error?.message ?? `Request failed with HTTP ${response.status}.`,
    payload.error?.details,
  );
}

async function renewAccessToken(): Promise<boolean> {
  const refreshToken = currentRefreshToken();
  if (!refreshToken) return false;
  const response = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!response.ok) {
    clearTokens();
    authFailureHandler?.();
    return false;
  }
  saveTokens((await response.json()) as Tokens);
  return true;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  for (const [key, value] of Object.entries(workspaceHeaders)) {
    if (!headers.has(key)) headers.set(key, value);
  }

  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (response.status === 401 && retry && !path.startsWith("/auth/")) {
    refreshing ??= renewAccessToken().finally(() => {
      refreshing = null;
    });
    if (await refreshing) return request<T>(path, init, false);
  }
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get<T>(path: string, headers?: Record<string, string>): Promise<T> {
    return request<T>(path, { headers });
  },
  post<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return request<T>(path, {
      method: "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  patch<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
    return request<T>(path, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    });
  },
  delete<T = void>(path: string, headers?: Record<string, string>): Promise<T> {
    return request<T>(path, { method: "DELETE", headers });
  },
};

export async function openEventStream(
  path: string,
  headers: Record<string, string>,
  signal: AbortSignal,
  onData: (data: string) => void,
): Promise<void> {
  const streamHeaders = new Headers(headers);
  streamHeaders.set("Accept", "text/event-stream");
  if (accessToken) streamHeaders.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(`${API_URL}${path}`, { headers: streamHeaders, signal });
  if (!response.ok || !response.body) throw await parseError(response);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame
        .split("\n")
        .find((part) => part.startsWith("data: "));
      if (line && line !== "data: {}") onData(line.slice(6));
    }
  }
}
