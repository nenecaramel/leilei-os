import { readRecord } from "./native-live-mac-relay-response.js";

type FetchLike = typeof fetch;

/** One HTTP policy for all relay operations; business endpoints stay in the client. */
export class NativeLiveMacRelayHttp {
  protected readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/u, "");
    if (!this.baseUrl) throw new Error("Native live relay base URL is required.");
    if (!token.trim()) throw new Error("Native live relay token is required.");
  }

  protected async postRetryableBounded(
    path: string,
    body: unknown,
    maxAttempts: number,
    signal: AbortSignal | null = null,
  ): Promise<unknown> {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.post(path, body, signal);
      } catch (error) {
        if (
          signal?.aborted || !(isTransientRelayWaitError(error)
            || (error && typeof error === "object" && "relayCode" in error
              && error.relayCode === "RELAY_RESPONSE_BODY_UNAVAILABLE"
              && "httpStatus" in error && typeof error.httpStatus === "number"
              && error.httpStatus >= 200 && error.httpStatus < 300))
          || attempt >= maxAttempts
        ) {
          throw error;
        }
        await delayRelayRetry(
          Math.min(250 * 2 ** (attempt - 1), 1_000),
          signal,
        );
      }
    }
    throw new Error("Native live relay retry budget exhausted.");
  }

  protected async postRetryable(
    path: string,
    body: unknown,
  ): Promise<unknown> {
    let attempt = 0;
    while (true) {
      try {
        return await this.post(path, body);
      } catch (error) {
        if (!isTransientRelayWaitError(error)) {
          throw error;
        }
        attempt += 1;
        await delayRelayRetry(
          Math.min(250 * 2 ** Math.min(attempt - 1, 4), 3_000),
          null,
        );
      }
    }
  }

  protected async postWait(
    path: string,
    body: unknown,
    signal: AbortSignal | null = null,
  ): Promise<unknown> {
    let attempt = 0;
    while (true) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      try {
        return await this.post(path, body, signal);
      } catch (error) {
        if (!isTransientRelayWaitError(error) || signal?.aborted) {
          throw error;
        }
        attempt += 1;
        await delayRelayRetry(
          Math.min(250 * 2 ** Math.min(attempt - 1, 4), 3_000),
          signal,
        );
      }
    }
  }

  protected async post(
    path: string,
    body: unknown,
    signal: AbortSignal | null = null,
  ): Promise<unknown> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/internal/native-live-relay${path}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
          connection: "close",
        },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      },
    );

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      const invalidJson = error instanceof SyntaxError;
      throw Object.assign(new Error("Native live relay returned malformed JSON."), {
        httpStatus: response.status,
        relayPath: path,
        relayCode: invalidJson
          ? "RELAY_RESPONSE_INVALID_JSON"
          : "RELAY_RESPONSE_BODY_UNAVAILABLE",
        // Whitelist the type only. Parse/transport messages can contain body
        // fragments, credentials or transcript text and must not reach logs.
        responseErrorName: invalidJson
          ? "SyntaxError"
          : error instanceof TypeError ? "TypeError" : "Error",
      });
    }

    const record = readRecord(payload);
    if (!response.ok || record.success !== true) {
      const error =
        record.error
        && typeof record.error === "object"
        && !Array.isArray(record.error)
          ? record.error as Record<string, unknown>
          : {};
      throw Object.assign(
        new Error("Native live relay request failed."),
        {
          relayCode:
            typeof error.code === "string"
              ? error.code
              : null,
          relayMessage:
            typeof error.message === "string"
            && error.message.trim()
              ? error.message
              : null,
          finalizeCode:
            typeof error.finalizeCode === "string"
              ? error.finalizeCode
              : null,
          httpStatus: response.status,
        },
      );
    }
    return record.data;
  }
}

export function isTransientRelayWaitError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as {
    httpStatus?: unknown;
    name?: unknown;
  };
  if (
    typeof record.httpStatus === "number"
    && (
      record.httpStatus === 502
      || record.httpStatus === 503
      || record.httpStatus === 504
    )
  ) {
    return true;
  }
  return record.name === "TypeError";
}

export function delayRelayRetry(
  milliseconds: number,
  signal: AbortSignal | null,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function awaitRelayDeadline<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}
