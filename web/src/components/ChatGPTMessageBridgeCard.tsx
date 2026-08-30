import { useEffect, useRef, useState } from "react";
import type { WebApiClient } from "../api/useWebApiClient";
import type { BridgeEventReceipt, BridgeEventResponse } from "../system/bridge-types";

export function ChatGPTMessageBridgeCard({
  api,
}: {
  api: WebApiClient;
}) {
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
    const transportTerminal = bridgeReceipt?.status === "host_sent"
      || bridgeReceipt?.status === "delivery_unknown";
    if (!bridgeReceipt || (bridgeReceipt.processingStatus === "completed" && transportTerminal)) return;
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
    <section className="system-section message-bridge-card" aria-label="ChatGPT Message Bridge">
      <h2>Message Bridge</h2>
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
  const reconciliationLabel = receipt.deliveryReconciledAt
    ? `${transportLabel} · Later confirmed`
    : transportLabel;
  if (receipt.processingStatus === "completed") return `${reconciliationLabel} · Processing completed`;
  if (receipt.processingStatus === "claimed") return `${reconciliationLabel} · Received by model`;
  return reconciliationLabel;
}
