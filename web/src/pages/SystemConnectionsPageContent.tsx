import { useEffect, useRef, useState } from "react";
import type {
  WebApiClient,
} from "../api/useWebApiClient";
import type {
  SystemConnections,
  SystemConnectionsResponse,
} from "../system/types";
import { PageHeader } from "./PageHeader";
import type { BridgeEventReceipt, BridgeEventResponse } from "../system/bridge-types";

type LoadState =
  | { status: "loading" }
  | {
      status: "ready";
      connections: SystemConnections;
    }
  | { status: "error" };

const STATUS_LABELS = {
  online: "Online",
  available: "Available",
  not_enabled: "Not enabled",
} as const;

function ConnectionRow({
  label,
  status,
}: {
  label: string;
  status: keyof typeof STATUS_LABELS;
}) {
  return (
    <div className="system-status-row">
      <span>{label}</span>
      <strong>{STATUS_LABELS[status]}</strong>
    </div>
  );
}

export function SystemConnectionsPageContent({
  api,
}: {
  api: WebApiClient;
}) {
  const [reloadKey, setReloadKey] =
    useState(0);
  const [state, setState] =
    useState<LoadState>({
      status: "loading",
    });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    api
      .request<SystemConnectionsResponse>(
        "/system/connections",
      )
      .then((response) => {
        if (!active) return;
        setState({
          status: "ready",
          connections: response.data,
        });
      })
      .catch(() => {
        if (!active) return;
        setState({ status: "error" });
      });

    return () => {
      active = false;
    };
  }, [api, reloadKey]);

  const [bridgeText, setBridgeText] = useState("");
  const [bridgeReceipt, setBridgeReceipt] = useState<BridgeEventReceipt | null>(null);
  const [bridgeSending, setBridgeSending] = useState(false);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const bridgeKeyRef = useRef<string | null>(null);

  const submitBridge = async () => {
    const text = bridgeText.trim();
    if (!text || bridgeSending) return;
    if (!bridgeKeyRef.current) bridgeKeyRef.current = crypto.randomUUID();
    setBridgeSending(true);
    setBridgeError(null);
    try {
      const response = await api.request<BridgeEventResponse>("/bridge/events", {
        method: "POST",
        headers: { "Idempotency-Key": bridgeKeyRef.current },
        body: JSON.stringify({ text }),
      });
      setBridgeReceipt(response.data);
      setBridgeText("");
      bridgeKeyRef.current = null;
    } catch {
      setBridgeError("Unable to send the message. Retry to continue the same attempt.");
    } finally {
      setBridgeSending(false);
    }
  };

  useEffect(() => {
    if (!bridgeReceipt || bridgeReceipt.processingStatus === "completed") return;
    const bridgeEventId = bridgeReceipt.id;
    let active = true;
    const poll = async () => {
      try {
        const response = await api.request<BridgeEventResponse>(`/bridge/events/${encodeURIComponent(bridgeEventId)}`);
        if (active) setBridgeReceipt(response.data);
      } catch { /* retain the last owner-scoped receipt and try the next interval */ }
    };
    const handle = window.setInterval(() => { void poll(); }, 10_000);
    void poll();
    return () => { active = false; window.clearInterval(handle); };
  }, [api, bridgeReceipt?.id, bridgeReceipt?.status, bridgeReceipt?.processingStatus]);

  return (
    <div
      className={
        "page system-page " +
        "system-connections-page"
      }
    >
      <PageHeader
        eyebrow="System"
        title="Connections"
        description={
          "Read-only service availability."
        }
      />

      <section
        className="system-section"
        aria-label="Connection status"
      >
        {state.status === "loading" ? (
          <p className="system-state-copy" role="status" aria-live="polite">
            Checking connections…
          </p>
        ) : null}

        {state.status === "error" ? (
          <div className="system-state-message">
            <p>
              Unable to read connection status.
            </p>
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                setReloadKey(
                  (value) => value + 1,
                )
              }
            >
              Retry
            </button>
          </div>
        ) : null}

        {state.status === "ready" ? (
          <div className="system-status-list">
            <ConnectionRow
              label="Web API"
              status={
                state.connections.web_api
              }
            />
            <ConnectionRow
              label="ChatGPT / MCP"
              status={
                state.connections.public_mcp
              }
            />
            <ConnectionRow
              label="Internal MCP"
              status={
                state.connections.internal_mcp
              }
            />
          </div>
        ) : null}
      </section>

      <section className="system-section system-bridge-section" aria-label="ChatGPT Message Bridge">
        <h2>ChatGPT Message Bridge</h2>
        <p className="system-note">Send one message to the connected ChatGPT conversation.</p>
        <textarea
          value={bridgeText}
          maxLength={4000}
          onChange={(event) => setBridgeText(event.target.value)}
          placeholder="Message"
          rows={3}
          disabled={bridgeSending}
        />
        <button className="secondary-button" type="button" disabled={!bridgeText.trim() || bridgeSending} onClick={() => void submitBridge()}>
          {bridgeSending ? "Sending…" : "Send"}
        </button>
        {bridgeError ? <p className="system-bridge-error" role="alert">{bridgeError}</p> : null}
        {bridgeReceipt ? <p className="system-bridge-status" role="status">{bridgeStatusLabel(bridgeReceipt)}</p> : null}
      </section>
    </div>
  );
}

function bridgeStatusLabel(receipt: BridgeEventReceipt): string {
  const transportLabel = (() => {
    const status = receipt.status;
    switch (status) {
      case "pending": return "Queued";
      case "reserved": return "Delivering";
      case "host_sent": return "Sent to ChatGPT";
      case "delivery_unknown": return "Delivery uncertain — do not resend";
    }
  })();
  if (receipt.processingStatus === "completed") return `${transportLabel} · Processing completed`;
  if (receipt.processingStatus === "claimed") return `${transportLabel} · Received by model`;
  if (receipt.deliveryReconciledAt) return `${transportLabel} · Later confirmed`;
  return transportLabel;
}
