const NOTION_API_BASE = "https://api.notion.com/v1";
export const NOTION_API_VERSION = "2026-03-11";
export const DEFAULT_NOTION_REQUEST_TIMEOUT_MS = 10_000;

export type NotionApiErrorCode =
  | "NOT_CONFIGURED"
  | "AUTHENTICATION_FAILED"
  | "ACCESS_DENIED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "VALIDATION"
  | "UPSTREAM";

export class NotionApiError extends Error {
  constructor(
    public readonly code: NotionApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NotionApiError";
  }
}

export type NotionJsonObject = Record<string, unknown>;

export type NotionTransportOptions = {
  requestTimeoutMs?: number;
};

export type NotionRequestOptions = {
  timeoutMs?: number;
};

function asJsonObject(value: unknown): NotionJsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as NotionJsonObject;
}

function mapStatus(status: number): NotionApiError {
  if (status === 400 || status === 406) {
    return new NotionApiError("VALIDATION", "Notion rejected the request.");
  }
  if (status === 401) {
    return new NotionApiError("AUTHENTICATION_FAILED", "Notion authentication failed.");
  }
  if (status === 403) {
    return new NotionApiError("ACCESS_DENIED", "Notion access was denied.");
  }
  if (status === 404) {
    return new NotionApiError("NOT_FOUND", "The Notion resource was not found or is inaccessible.");
  }
  if (status === 409) {
    return new NotionApiError("CONFLICT", "Notion reported a conflict.");
  }
  if (status === 429) {
    return new NotionApiError("RATE_LIMITED", "Notion is temporarily rate limited.");
  }
  return new NotionApiError("UPSTREAM", "Notion is temporarily unavailable.");
}

function isFormDataBody(body: BodyInit | null | undefined): boolean {
  return typeof FormData !== "undefined" && body instanceof FormData;
}

function configuredTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_NOTION_REQUEST_TIMEOUT_MS;
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_NOTION_REQUEST_TIMEOUT_MS;
  }
  return Math.max(1, Math.floor(value));
}

export class NotionTransport {
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly token: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
    options: NotionTransportOptions = {},
  ) {
    this.requestTimeoutMs = configuredTimeout(options.requestTimeoutMs);
  }

  async requestRaw(
    path: string,
    init: RequestInit = {},
    requestOptions: NotionRequestOptions = {},
  ): Promise<Response> {
    const token = this.token?.trim();
    if (!token) {
      throw new NotionApiError("NOT_CONFIGURED", "Notion access is not configured.");
    }

    if (!path.startsWith("/") || path.startsWith("//") || path.includes("://")) {
      throw new NotionApiError(
        "VALIDATION",
        "A relative Notion API path beginning with / is required.",
      );
    }

    const timeoutOverride = requestOptions.timeoutMs;
    if (
      timeoutOverride !== undefined &&
      (!Number.isFinite(timeoutOverride) || timeoutOverride <= 0)
    ) {
      throw new NotionApiError("UPSTREAM", "Notion is temporarily unavailable.");
    }
    const timeoutMs = timeoutOverride === undefined
      ? this.requestTimeoutMs
      : Math.max(1, Math.min(this.requestTimeoutMs, Math.floor(timeoutOverride)));

    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Notion-Version", NOTION_API_VERSION);
    if (init.body !== undefined && init.body !== null && !isFormDataBody(init.body)) {
      if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    }

    const controller = new AbortController();
    const callerSignal = init.signal;
    const abortFromCaller = () => controller.abort();
    if (callerSignal?.aborted) {
      abortFromCaller();
    } else {
      callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();

    let response: Response;
    try {
      response = await this.fetchImpl(`${NOTION_API_BASE}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch {
      throw new NotionApiError("UPSTREAM", "Notion is temporarily unavailable.");
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    }

    if (!response.ok) throw mapStatus(response.status);
    return response;
  }

  async requestJson(
    path: string,
    init: RequestInit = {},
    requestOptions: NotionRequestOptions = {},
  ): Promise<NotionJsonObject> {
    const response = await this.requestRaw(path, init, requestOptions);
    try {
      const value = await response.json();
      const payload = asJsonObject(value);
      if (!payload) throw new Error("Invalid Notion response");
      return payload;
    } catch (error) {
      if (error instanceof NotionApiError) throw error;
      throw new NotionApiError("UPSTREAM", "Notion returned an invalid response.");
    }
  }
}
