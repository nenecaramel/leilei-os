import { useEffect, useState } from "react";
import type {
  WebApiClient,
} from "../api/useWebApiClient";
import type {
  SystemConnections,
  SystemConnectionsResponse,
} from "../system/types";
import { PageHeader } from "./PageHeader";

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
  loading: "Loading…",
  unavailable: "Unavailable",
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

  return (
    <div
      className={
        "page system-page " +
        "system-connections-page"
      }
    >
      <PageHeader
        eyebrow="Settings"
        title="Status"
        description={
          "Read-only service availability."
        }
      />

      <section
        className="system-section"
        aria-label="Connection status"
      >
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

        <div className="system-status-list">
          {([
            ["Web API", "web_api"],
            ["ChatGPT / Claude MCP", "public_mcp"],
            ["Internal MCP", "internal_mcp"],
          ] as const).map(([label, key]) => (
            <ConnectionRow
              key={key}
              label={label}
              status={state.status === "ready" ? state.connections[key]
                : state.status === "loading" ? "loading" : "unavailable"}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
