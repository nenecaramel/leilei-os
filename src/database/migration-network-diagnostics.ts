import dns from "node:dns/promises";
import net from "node:net";

const PRIVATE_POSTGRES_HOST = "postgres.railway.internal";
const PRIVATE_POSTGRES_PORT = 5432;
const TCP_PROBE_TIMEOUT_MS = 5_000;

type DnsAddress = { family: number };

type DiagnosticsDependencies = {
  lookup: (hostname: string) => Promise<DnsAddress[]>;
  probeTcp: (hostname: string, port: number) => Promise<ProbeResult>;
};

type ProbeResult = {
  ok: boolean;
  errorCode?: string;
};

export type MigrationNetworkDiagnostics = {
  hostClass: "RAILWAY_PROXY" | "RAILWAY_INTERNAL" | "OTHER";
  portSet: boolean;
  environmentIdSet: boolean;
  rewriteApplied: boolean;
  privateDns: "PASS" | "FAIL";
  privateDnsFamilies: "IPv4" | "IPv6" | "BOTH" | "NONE";
  privateDnsErrorCode: string;
  privateTcp: "PASS" | "FAIL";
  privateTcpErrorCode: string;
  originalTcp: "PASS" | "FAIL";
  originalTcpErrorCode: string;
};

const defaultDependencies: DiagnosticsDependencies = {
  lookup: async (hostname) => dns.lookup(hostname, { all: true }),
  probeTcp: (hostname, port) => probeTcp(hostname, port),
};

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : "UNKNOWN";
  }
  return "UNKNOWN";
}

function classifyHost(hostname: string): MigrationNetworkDiagnostics["hostClass"] {
  if (hostname.endsWith(".railway.internal")) {
    return "RAILWAY_INTERNAL";
  }
  if (
    hostname.endsWith(".proxy.rlwy.net")
    || hostname.endsWith(".railway.app")
    || hostname.endsWith(".rlwy.net")
  ) {
    return "RAILWAY_PROXY";
  }
  return "OTHER";
}

function classifyDnsFamilies(addresses: DnsAddress[]): MigrationNetworkDiagnostics["privateDnsFamilies"] {
  const families = new Set(addresses.map((address) => address.family === 6 ? "IPv6" : "IPv4"));
  if (families.size === 2) {
    return "BOTH";
  }
  const onlyFamily = families.values().next().value;
  return onlyFamily === "IPv4" || onlyFamily === "IPv6" ? onlyFamily : "NONE";
}

function defaultOriginalPort(url: URL): number | undefined {
  if (url.port) {
    return Number(url.port);
  }
  if (url.protocol === "postgres:" || url.protocol === "postgresql:") {
    return 5432;
  }
  return undefined;
}

function probeTcp(hostname: string, port: number): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.createConnection({ host: hostname, port });
    const finish = (result: ProbeResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(TCP_PROBE_TIMEOUT_MS, () => finish({ ok: false, errorCode: "ETIMEDOUT" }));
    socket.once("connect", () => finish({ ok: true }));
    socket.once("error", (error: unknown) => finish({ ok: false, errorCode: errorCode(error) }));
  });
}

function probeStatus(result: ProbeResult): "PASS" | "FAIL" {
  return result.ok ? "PASS" : "FAIL";
}

export async function collectMigrationNetworkDiagnostics(
  databaseUrl: string,
  railwayEnvironmentId: string | undefined,
  migrationDatabaseUrl: string,
  dependencies: Partial<DiagnosticsDependencies> = {},
): Promise<MigrationNetworkDiagnostics> {
  const deps = { ...defaultDependencies, ...dependencies };
  let parsedUrl: URL | undefined;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    parsedUrl = undefined;
  }

  let privateDns: MigrationNetworkDiagnostics["privateDns"] = "FAIL";
  let privateDnsFamilies: MigrationNetworkDiagnostics["privateDnsFamilies"] = "NONE";
  let privateDnsErrorCode = "";
  try {
    const addresses = await deps.lookup(PRIVATE_POSTGRES_HOST);
    privateDns = "PASS";
    privateDnsFamilies = classifyDnsFamilies(addresses);
  } catch (error) {
    privateDnsErrorCode = errorCode(error);
  }

  const privateTcpResult = await deps.probeTcp(PRIVATE_POSTGRES_HOST, PRIVATE_POSTGRES_PORT);
  let originalTcpResult: ProbeResult = { ok: false, errorCode: "DATABASE_URL_MISSING" };
  if (parsedUrl) {
    const originalPort = defaultOriginalPort(parsedUrl);
    if (originalPort !== undefined) {
      originalTcpResult = await deps.probeTcp(parsedUrl.hostname, originalPort);
    } else {
      originalTcpResult = { ok: false, errorCode: "ORIGINAL_PORT_MISSING" };
    }
  }

  return {
    hostClass: parsedUrl ? classifyHost(parsedUrl.hostname) : "OTHER",
    portSet: Boolean(parsedUrl?.port),
    environmentIdSet: Boolean(railwayEnvironmentId?.trim()),
    rewriteApplied: databaseUrl !== migrationDatabaseUrl,
    privateDns,
    privateDnsFamilies,
    privateDnsErrorCode,
    privateTcp: probeStatus(privateTcpResult),
    privateTcpErrorCode: privateTcpResult.errorCode ?? "",
    originalTcp: probeStatus(originalTcpResult),
    originalTcpErrorCode: originalTcpResult.errorCode ?? "",
  };
}

export function logMigrationNetworkDiagnostics(diagnostics: MigrationNetworkDiagnostics): void {
  console.log(`DATABASE_URL_HOST_CLASS=${diagnostics.hostClass}`);
  console.log(`DATABASE_URL_PORT_SET=${diagnostics.portSet ? "YES" : "NO"}`);
  console.log(`RAILWAY_ENVIRONMENT_ID_SET=${diagnostics.environmentIdSet ? "YES" : "NO"}`);
  console.log(`MIGRATION_URL_REWRITE_APPLIED=${diagnostics.rewriteApplied ? "YES" : "NO"}`);
  console.log(`PRIVATE_DNS=${diagnostics.privateDns}`);
  console.log(`PRIVATE_DNS_FAMILIES=${diagnostics.privateDnsFamilies}`);
  console.log(`PRIVATE_DNS_ERROR_CODE=${diagnostics.privateDnsErrorCode}`);
  console.log(`PRIVATE_TCP=${diagnostics.privateTcp}`);
  console.log(`PRIVATE_TCP_ERROR_CODE=${diagnostics.privateTcpErrorCode}`);
  console.log(`ORIGINAL_TCP=${diagnostics.originalTcp}`);
  console.log(`ORIGINAL_TCP_ERROR_CODE=${diagnostics.originalTcpErrorCode}`);
}
