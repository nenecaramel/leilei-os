import { lookup as dnsLookup } from "node:dns/promises";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from "node:https";
import { isIP } from "node:net";

export type ResolvedHostAddress = {
  address: string;
  family: 4 | 6;
};

export type MetadataLookupCallback = (
  error: NodeJS.ErrnoException | null,
  address?: string | readonly ResolvedHostAddress[],
  family?: number,
) => void;

export type MetadataRequestOptions = {
  protocol: "https:";
  hostname: string;
  port: string;
  path: string;
  method: "GET";
  servername: string;
  rejectUnauthorized?: boolean;
  timeoutMs: number;
  lookup?: (
    hostname: string,
    options: { all?: boolean },
    callback: MetadataLookupCallback,
  ) => void;
};

type MetadataResponse = {
  statusCode?: number;
  headers: Record<string, string | string[] | undefined>;
  on(event: "data", listener: (chunk: unknown) => void): MetadataResponse;
  on(event: "end", listener: () => void): MetadataResponse;
  on(event: "error", listener: (error: Error) => void): MetadataResponse;
};

type MetadataRequest = {
  setTimeout(timeoutMs: number): MetadataRequest;
  on(event: "timeout", listener: () => void): MetadataRequest;
  on(event: "error", listener: (error: Error) => void): MetadataRequest;
  destroy(error?: Error): MetadataRequest;
  end?(): void;
};

export type MetadataRequestFactory = (
  options: MetadataRequestOptions,
  callback: (response: MetadataResponse) => void,
) => MetadataRequest;

export type MetadataFetcher = {
  fetch(clientId: string): Promise<Record<string, unknown>>;
};

type HostResolver = (
  hostname: string,
) => Promise<readonly ResolvedHostAddress[]>;

const MAX_METADATA_BYTES = 5 * 1024;

function parseIpv4(value: string): number | undefined {
  const parts = value.split(".");
  if (parts.length !== 4) return undefined;
  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/u.test(part)) return undefined;
    const number = Number(part);
    return number <= 255 ? number : undefined;
  });
  if (octets.some((part) => part === undefined)) return undefined;
  return (((octets[0]! * 256 + octets[1]!) * 256 + octets[2]!) * 256) + octets[3]!;
}

function parseIpv6(value: string): bigint | undefined {
  const withoutZone = value.split("%", 1)[0]!;
  let normalized = withoutZone.toLowerCase();
  if (normalized.includes(".")) {
    const separator = normalized.lastIndexOf(":");
    if (separator < 0) return undefined;
    const ipv4 = parseIpv4(normalized.slice(separator + 1));
    if (ipv4 === undefined) return undefined;
    normalized = `${normalized.slice(0, separator)}:${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }

  const sections = normalized.split("::");
  if (sections.length > 2) return undefined;
  const left = sections[0] ? sections[0].split(":") : [];
  const right = sections.length === 2 && sections[1]
    ? sections[1].split(":")
    : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/u.test(part))) {
    return undefined;
  }
  const missing = 8 - left.length - right.length;
  if (sections.length === 1 && missing !== 0) return undefined;
  if (missing < 0) return undefined;
  const parts = [
    ...left,
    ...Array.from({ length: missing }, () => "0"),
    ...right,
  ];
  if (parts.length !== 8) return undefined;
  return parts.reduce((result, part) => (result << 16n) | BigInt(`0x${part}`), 0n);
}

function inIpv6Range(value: bigint, prefix: bigint, bits: number): boolean {
  const mask = ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
  return (value & mask) === (prefix & mask);
}

function isSpecialIpv4(value: number): boolean {
  const first = value >>> 24;
  const second = (value >>> 16) & 0xff;
  const third = (value >>> 8) & 0xff;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 31 && third === 196) ||
    (first === 192 && second === 52 && third === 193) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 175 && third === 48) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function ipv6Literal(value: string): bigint {
  const parsed = parseIpv6(value);
  if (parsed === undefined) throw new Error(`invalid IPv6 range: ${value}`);
  return parsed;
}

const IPV6_SPECIAL_RANGES = ([
  ["::1", 128],
  ["::", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["100:0:0:1::", 64],
  ["2001::", 23],
  ["2001:1::1", 128],
  ["2001:1::2", 128],
  ["2001:1::3", 128],
  ["2001:2::", 48],
  ["2001:3::", 32],
  ["2001:4:112::", 48],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:30::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["2620:4f:8000::", 48],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const).map(([prefix, bits]) => ({ prefix: ipv6Literal(prefix), bits }));

export function isSpecialUseIp(value: string): boolean {
  const family = isIP(value);
  if (family === 4) {
    const parsed = parseIpv4(value);
    return parsed === undefined || isSpecialIpv4(parsed);
  }
  if (family !== 6) return true;

  const parsed = parseIpv6(value);
  if (parsed === undefined) return true;
  return IPV6_SPECIAL_RANGES.some(({ prefix, bits }) => inIpv6Range(parsed, prefix, bits));
}

function validateMetadataUrl(value: string): URL {
  if (
    value.length === 0 ||
    value !== value.trim() ||
    Buffer.byteLength(value, "utf8") > 120 ||
    /(?:^|\/)\.{1,2}(?:\/|$)/u.test(value)
  ) {
    throw new Error("invalid CIMD URL");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid CIMD URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.port === "0" ||
    url.pathname === "/" ||
    /(?:^|\/)\.{1,2}(?:\/|$)/u.test(url.pathname) ||
    /%2e/iu.test(url.pathname) ||
    url.hostname.length === 0
  ) {
    throw new Error("invalid CIMD URL");
  }
  return url;
}

export function isCompliantCimdClientIdentifier(value: string): boolean {
  try {
    validateMetadataUrl(value);
    return true;
  } catch {
    return false;
  }
}

export function isCompliantSecureJsonUrl(value: string): boolean {
  try {
    validateMetadataUrl(value);
    return true;
  } catch {
    return false;
  }
}

async function defaultResolveHost(hostname: string): Promise<readonly ResolvedHostAddress[]> {
  const answers = await dnsLookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => {
    if (answer.family !== 4 && answer.family !== 6) {
      throw new Error("CIMD DNS response has an unknown address family");
    }
    return { address: answer.address, family: answer.family };
  });
}

const defaultRequest: MetadataRequestFactory = (options, callback) => {
  const requestOptions: HttpsRequestOptions = {
    protocol: options.protocol,
    hostname: options.hostname,
    port: options.port,
    path: options.path,
    method: options.method,
    servername: options.servername,
    lookup: options.lookup as HttpsRequestOptions["lookup"],
  };
  return httpsRequest(
    requestOptions,
    callback as (response: IncomingMessage) => void,
  );
};

async function resolveHostWithTimeout(
  resolveHost: HostResolver,
  hostname: string,
  timeoutMs: number,
): Promise<readonly ResolvedHostAddress[]> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      resolveHost(hostname),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("CIMD DNS resolution timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function asBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === "string") return Buffer.from(chunk);
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  throw new Error("invalid metadata response body");
}

export function createSecureJsonFetcher(options: {
  resolveHost?: HostResolver;
  request?: MetadataRequestFactory;
  timeoutMs?: number;
} = {}): MetadataFetcher {
  const resolveHost = options.resolveHost ?? defaultResolveHost;
  const request = options.request ?? defaultRequest;
  const timeoutMs = options.timeoutMs ?? 5_000;

  return {
    async fetch(clientId) {
      const url = validateMetadataUrl(clientId);
      const literalHostname = url.hostname.replace(/^\[|\]$/gu, "");
      if (isIP(literalHostname) && isSpecialUseIp(literalHostname)) {
        throw new Error("CIMD destination is special-use or unsafe");
      }
      let addresses: readonly ResolvedHostAddress[];
      try {
        addresses = await resolveHostWithTimeout(resolveHost, url.hostname, timeoutMs);
      } catch {
        throw new Error("CIMD DNS resolution failed");
      }
      if (
        addresses.length === 0 ||
        addresses.some(({ address, family }) =>
          (family !== 4 && family !== 6) ||
          isIP(address) !== family ||
          isSpecialUseIp(address))
      ) {
        throw new Error("CIMD destination is special-use or unsafe");
      }

      const pinned = addresses[0]!;
      const requestOptions: MetadataRequestOptions = {
        protocol: "https:",
        hostname: url.hostname,
        port: url.port || "443",
        path: url.pathname,
        method: "GET",
        servername: url.hostname,
        timeoutMs,
        lookup: (_hostname, lookupOptions, callback) => {
          if (lookupOptions.all) {
            callback(null, addresses);
            return;
          }
          callback(null, pinned.address, pinned.family);
        },
      };

      return new Promise<Record<string, unknown>>((resolve, reject) => {
        let settled = false;
        let totalBytes = 0;
        const chunks: Buffer[] = [];
        let clientRequest: MetadataRequest;
        const fail = (error: Error): void => {
          if (settled) return;
          settled = true;
          clientRequest?.destroy(error);
          reject(error);
        };

        try {
          clientRequest = request(requestOptions, (response) => {
            if (response.statusCode !== 200) {
              fail(new Error("CIMD response must have status 200"));
              return;
            }
            const contentType = response.headers["content-type"];
            if (
              typeof contentType !== "string" ||
              !/^application\/json(?:\s*;|\s*$)/iu.test(contentType)
            ) {
              fail(new Error("CIMD response must be JSON"));
              return;
            }
            response.on("data", (chunk) => {
              try {
                const buffer = asBuffer(chunk);
                totalBytes += buffer.byteLength;
                if (totalBytes > MAX_METADATA_BYTES) {
                  fail(new Error("CIMD response exceeds 5 KiB"));
                  return;
                }
                chunks.push(buffer);
              } catch (error) {
                fail(error instanceof Error ? error : new Error("invalid metadata response body"));
              }
            });
            response.on("end", () => {
              if (settled) return;
              try {
                const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                if (
                  parsed === null ||
                  typeof parsed !== "object" ||
                  Array.isArray(parsed)
                ) {
                  throw new Error("CIMD response must be a JSON object");
                }
                settled = true;
                resolve(parsed as Record<string, unknown>);
              } catch (error) {
                fail(error instanceof Error ? error : new Error("invalid CIMD JSON"));
              }
            });
            response.on("error", (error) => fail(error));
          });
          clientRequest.setTimeout(timeoutMs);
          clientRequest.on("timeout", () => fail(new Error("CIMD request timed out")));
          clientRequest.on("error", (error) => fail(error));
          clientRequest.end?.();
        } catch (error) {
          fail(error instanceof Error ? error : new Error("CIMD request failed"));
        }
      });
    },
  };
}

export function createSecureMetadataFetcher(options: {
  resolveHost?: HostResolver;
  request?: MetadataRequestFactory;
  timeoutMs?: number;
} = {}): MetadataFetcher {
  return createSecureJsonFetcher(options);
}
