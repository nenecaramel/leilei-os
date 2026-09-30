import {
  createHash,
  createHmac,
} from "node:crypto";
import type {
  NativeLiveAttachmentStorageConfig,
} from "../../config/env.js";

export type NativeLiveAttachmentUploadSlot = {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
};

export type NativeLiveAttachmentDownloadSlot = {
  url: string;
  method: "GET";
  headers: Record<string, string>;
  expiresAt: string;
};

export type NativeLiveAttachmentObjectHead = {
  sizeBytes: number;
  mimeType: string | null;
  sha256: string | null;
};

export interface NativeLiveAttachmentObjectStore {
  createUploadSlot(input: {
    objectKey: string;
    mimeType: string;
    sha256: string;
  }): NativeLiveAttachmentUploadSlot;

  createDownloadSlot(input: {
    objectKey: string;
  }): NativeLiveAttachmentDownloadSlot;

  headObject(input: {
    objectKey: string;
  }): Promise<NativeLiveAttachmentObjectHead | null>;
}

export class S3PresignedAttachmentObjectStore
implements NativeLiveAttachmentObjectStore {
  private readonly endpoint: URL;

  constructor(
    private readonly config:
      NativeLiveAttachmentStorageConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.endpoint = new URL(config.endpoint);
    if (
      this.endpoint.protocol !== "https:"
      || this.endpoint.username
      || this.endpoint.password
      || this.endpoint.search
      || this.endpoint.hash
    ) {
      throw new Error(
        "Native Live attachment endpoint must be a clean HTTPS URL.",
      );
    }
  }

  createUploadSlot(input: {
    objectKey: string;
    mimeType: string;
    sha256: string;
  }): NativeLiveAttachmentUploadSlot {
    return this.presign(
      "PUT",
      input.objectKey,
      {
        "content-type": input.mimeType,
        "x-amz-meta-sha256": input.sha256,
      },
    );
  }

  createDownloadSlot(input: {
    objectKey: string;
  }): NativeLiveAttachmentDownloadSlot {
    return this.presign("GET", input.objectKey, {});
  }

  async headObject(input: {
    objectKey: string;
  }): Promise<NativeLiveAttachmentObjectHead | null> {
    const slot = this.presign("HEAD", input.objectKey, {});
    const response = await this.fetchImpl(slot.url, {
      method: "HEAD",
      headers: slot.headers,
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw Object.assign(
        new Error(
          "Attachment object HEAD failed with HTTP "
          + response.status,
        ),
        { httpStatus: response.status },
      );
    }
    const sizeHeader = response.headers.get("content-length");
    const sizeBytes =
      sizeHeader && /^\d+$/u.test(sizeHeader)
        ? Number(sizeHeader)
        : Number.NaN;
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
      throw new Error(
        "Attachment object HEAD did not return a valid content length.",
      );
    }
    return {
      sizeBytes,
      mimeType:
        response.headers.get("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          ?.toLowerCase()
        ?? null,
      sha256:
        response.headers.get("x-amz-meta-sha256")
          ?.trim()
          ?.toLowerCase()
        ?? null,
    };
  }

  private presign<T extends "PUT" | "GET" | "HEAD">(
    method: T,
    objectKey: string,
    headers: Record<string, string>,
  ): {
    url: string;
    method: T;
    headers: Record<string, string>;
    expiresAt: string;
  } {
    const now = this.now();
    const amzDate = formatAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const scope =
      dateStamp
      + "/"
      + this.config.region
      + "/s3/aws4_request";
    const host =
      this.config.bucket
      + "."
      + this.endpoint.host;
    const canonicalUri =
      "/"
      + objectKey
        .split("/")
        .map(encodeRfc3986)
        .join("/");

    const normalizedHeaders = new Map<string, string>();
    normalizedHeaders.set("host", host);
    for (const [key, value] of Object.entries(headers)) {
      normalizedHeaders.set(
        key.toLowerCase(),
        normalizeHeaderValue(value),
      );
    }
    const signedHeaderNames =
      [...normalizedHeaders.keys()].sort();
    const signedHeaders =
      signedHeaderNames.join(";");
    const canonicalHeaders =
      signedHeaderNames
        .map(
          (name) =>
            name
            + ":"
            + normalizedHeaders.get(name)!,
        )
        .join("\n")
      + "\n";

    const query = new Map<string, string>([
      ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
      [
        "X-Amz-Credential",
        this.config.accessKeyId + "/" + scope,
      ],
      ["X-Amz-Date", amzDate],
      [
        "X-Amz-Expires",
        String(this.config.presignTtlSeconds),
      ],
      ["X-Amz-SignedHeaders", signedHeaders],
    ]);
    const canonicalQuery = canonicalQueryString(query);
    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      sha256Hex(canonicalRequest),
    ].join("\n");
    const signature = createHmac(
      "sha256",
      signingKey(
        this.config.secretAccessKey,
        dateStamp,
        this.config.region,
      ),
    )
      .update(stringToSign)
      .digest("hex");

    const url =
      this.endpoint.protocol
      + "//"
      + host
      + canonicalUri
      + "?"
      + canonicalQuery
      + "&X-Amz-Signature="
      + signature;
    const expiresAt =
      new Date(
        now.getTime()
        + this.config.presignTtlSeconds * 1_000,
      ).toISOString();

    return {
      url,
      method,
      headers: Object.fromEntries(
        [...normalizedHeaders.entries()]
          .filter(([name]) => name !== "host"),
      ),
      expiresAt,
    };
  }
}

function canonicalQueryString(
  query: ReadonlyMap<string, string>,
): string {
  return [...query.entries()]
    .map(
      ([key, value]) =>
        [encodeRfc3986(key), encodeRfc3986(value)]
          .join("="),
    )
    .sort()
    .join("&");
}

function normalizeHeaderValue(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/gu, (character) =>
      "%"
      + character
        .charCodeAt(0)
        .toString(16)
        .toUpperCase()
    );
}

function sha256Hex(value: string): string {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

function signingKey(
  secret: string,
  dateStamp: string,
  region: string,
): Buffer {
  const dateKey = createHmac(
    "sha256",
    "AWS4" + secret,
  ).update(dateStamp).digest();
  const regionKey = createHmac(
    "sha256",
    dateKey,
  ).update(region).digest();
  const serviceKey = createHmac(
    "sha256",
    regionKey,
  ).update("s3").digest();
  return createHmac(
    "sha256",
    serviceKey,
  ).update("aws4_request").digest();
}

function formatAmzDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[:-]|\.\d{3}/gu, "");
}
