type FetchLike = typeof fetch;

export type NativeLiveWakeBrokerCursor = {
  generation: string;
  version: number;
};

export type NativeLiveWakeBrokerWaitResult = {
  outcome: "ready" | "timeout" | "reset";
  cursor: NativeLiveWakeBrokerCursor;
};

export class NativeLiveMacWakeBrokerClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/u, "");
    if (!this.baseUrl) {
      throw new Error("Native Live wake broker base URL is required.");
    }
    if (!token.trim()) {
      throw new Error("Native Live wake broker token is required.");
    }
  }

  async snapshot(
    signal: AbortSignal | null = null,
  ): Promise<NativeLiveWakeBrokerCursor> {
    const data = await this.request(
      "/state",
      { method: "GET" },
      signal,
      5_000,
    );
    return parseCursor(data);
  }

  async wait(input: {
    cursor: NativeLiveWakeBrokerCursor;
    signal?: AbortSignal | null;
  }): Promise<NativeLiveWakeBrokerWaitResult> {
    const data = await this.request(
      "/wait",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          generation: input.cursor.generation,
          after_version: input.cursor.version,
          timeout_ms: 25_000,
        }),
      },
      input.signal ?? null,
      35_000,
    );
    const record = readRecord(data);
    if (
      record.outcome !== "ready"
      && record.outcome !== "timeout"
      && record.outcome !== "reset"
    ) {
      throw new Error(
        "Native Live wake broker returned an invalid wait outcome.",
      );
    }
    return {
      outcome: record.outcome,
      cursor: parseCursor(record),
    };
  }

  private async request(
    path: string,
    init: RequestInit,
    externalSignal: AbortSignal | null,
    timeoutMs: number,
  ): Promise<unknown> {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = externalSignal
      ? AbortSignal.any([externalSignal, timeoutSignal])
      : timeoutSignal;
    const response = await this.fetchImpl(
      this.baseUrl + path,
      {
        ...init,
        headers: {
          authorization: "Bearer " + this.token,
          ...(init.headers ?? {}),
        },
        signal,
      },
    );
    if (!response.ok) {
      throw new Error(
        "Native Live wake broker request failed with HTTP "
          + response.status
          + ".",
      );
    }
    return response.json();
  }
}

function parseCursor(value: unknown): NativeLiveWakeBrokerCursor {
  const record = readRecord(value);
  if (
    typeof record.generation !== "string"
    || !record.generation.trim()
    || !Number.isSafeInteger(record.version)
    || (record.version as number) < 0
  ) {
    throw new Error(
      "Native Live wake broker returned an invalid cursor.",
    );
  }
  return {
    generation: record.generation,
    version: record.version as number,
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Native Live wake broker response is invalid.");
  }
  return value as Record<string, unknown>;
}
