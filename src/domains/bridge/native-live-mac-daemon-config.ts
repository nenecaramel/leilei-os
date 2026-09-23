import { createHash } from "node:crypto";
import { homedir, hostname } from "node:os";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type NativeLiveMacDaemonConfig = {
  relayBaseUrl: string;
  relayToken: string;
  listenerInstanceId: string;
};

export function resolveNativeLiveMacDaemonConfig(
  environment: NodeJS.ProcessEnv,
  machine: {
    hostname: () => string;
    homedir: () => string;
  } = { hostname, homedir },
): NativeLiveMacDaemonConfig {
  const relayBaseUrl = firstNonBlank(
    environment.LEILEI_NATIVE_LIVE_RELAY_URL,
    environment.MCP_SERVER_URL,
  );
  if (!relayBaseUrl) {
    throw new Error(
      "Native Live relay URL is required. Set LEILEI_NATIVE_LIVE_RELAY_URL or MCP_SERVER_URL.",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(relayBaseUrl);
  } catch {
    throw new Error("Native Live relay URL must be a valid absolute URL.");
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error("Native Live relay URL must use http or https.");
  }

  const relayToken = firstNonBlank(
    environment.LEILEI_NATIVE_LIVE_RELAY_TOKEN,
    environment.MCP_AUTH_TOKEN,
  );
  if (!relayToken) {
    throw new Error(
      "Native Live relay token is required. Set LEILEI_NATIVE_LIVE_RELAY_TOKEN or MCP_AUTH_TOKEN.",
    );
  }

  const configuredListenerId = firstNonBlank(
    environment.LEILEI_NATIVE_LIVE_LISTENER_ID,
  );
  const listenerInstanceId = configuredListenerId
    ?? stableListenerInstanceId(machine.hostname(), machine.homedir());

  if (!UUID_PATTERN.test(listenerInstanceId)) {
    throw new Error(
      "LEILEI_NATIVE_LIVE_LISTENER_ID must be a UUID when explicitly configured.",
    );
  }

  return {
    relayBaseUrl: relayBaseUrl.replace(/\/+$/u, ""),
    relayToken,
    listenerInstanceId,
  };
}

export function stableListenerInstanceId(
  host: string,
  home: string,
): string {
  const digest = createHash("sha256")
    .update("leileios:native-live-listener:v1\0")
    .update(host.normalize("NFC"))
    .update("\0")
    .update(home.normalize("NFC"))
    .digest();

  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function firstNonBlank(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) return normalized;
  }
  return null;
}
