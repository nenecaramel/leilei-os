import { useEffect, useState } from "react";
import type {
  WebApiClient,
} from "../api/useWebApiClient";
import type {
  SystemDataResponse,
  SystemDataSummary,
} from "../system/types";
import type { WebExportDocument, WebExportScope } from "../system/export-types";
import { downloadExportDocument } from "../system/download-export";
import { PageHeader } from "./PageHeader";

type LoadState =
  | { status: "loading" }
  | {
      status: "ready";
      summary: SystemDataSummary;
    }
  | { status: "error" };

type ExportState =
  | { status: "idle" }
  | { status: "loading"; scope: WebExportScope }
  | { status: "error" };

function CountCell({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="system-count-cell">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ArchivedCountRow({
  label,
  active,
  archived,
}: {
  label: string;
  active: number;
  archived: number;
}) {
  return (
    <div className="system-data-row">
      <strong>{label}</strong>
      <div className="system-count-pair">
        <CountCell
          label="Active"
          value={active}
        />
        <CountCell
          label="Archived"
          value={archived}
        />
      </div>
    </div>
  );
}

export function SystemDataPageContent({
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
  const [exportState, setExportState] = useState<ExportState>({ status: "idle" });
  const [includeAudit, setIncludeAudit] = useState(false);

  async function runExport(scope: WebExportScope): Promise<void> {
    setExportState({ status: "loading", scope });
    const path = `/system/export?scope=${scope}${includeAudit ? "&include_audit=true" : ""}`;
    try {
      const document = await api.request<WebExportDocument>(path);
      downloadExportDocument(document);
      setExportState({ status: "idle" });
    } catch {
      setExportState({ status: "error" });
    }
  }

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    api
      .request<SystemDataResponse>(
        "/system/data",
      )
      .then((response) => {
        if (!active) return;
        setState({
          status: "ready",
          summary: response.data,
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
    <div className="page system-page system-data-page">
      <PageHeader
        eyebrow="System"
        title="Data"
        description="A read-only summary of your stored records."
      />

      <section
        className="system-section"
        aria-label="Data summary"
      >
        {state.status === "loading" ? (
          <p className="system-state-copy">
            Reading data summary…
          </p>
        ) : null}

        {state.status === "error" ? (
          <div className="system-state-message">
            <p>Unable to read data summary.</p>
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
          <div className="system-data-list">
            <ArchivedCountRow
              label="Memory"
              active={state.summary.memory.active}
              archived={
                state.summary.memory.archived
              }
            />
            <ArchivedCountRow
              label="Diary"
              active={state.summary.diary.active}
              archived={
                state.summary.diary.archived
              }
            />
            <ArchivedCountRow
              label="Task"
              active={state.summary.task.active}
              archived={
                state.summary.task.archived
              }
            />
            <div className="system-data-row">
              <strong>Health</strong>
              <div className="system-count-pair">
                <CountCell
                  label="Total"
                  value={
                    state.summary.health.total
                  }
                />
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="system-section system-export-section" aria-label="Export data">
        <div className="system-export-option">
          <label>
            <input
              type="checkbox"
              checked={includeAudit}
              onChange={(event) => setIncludeAudit(event.target.checked)}
            />
            Include audit/lifecycle events
          </label>
        </div>
        <div className="system-export-actions">
          {([
            ["all", "Export all"],
            ["memory", "Export Memory"],
            ["diary", "Export Diary"],
            ["task", "Export Task"],
            ["todo", "Export Todo"],
          ] as const).map(([scope, label]) => (
            <button
              className="secondary-button"
              type="button"
              key={scope}
              disabled={exportState.status === "loading"}
              onClick={() => void runExport(scope)}
            >
              {label}
            </button>
          ))}
        </div>
        {exportState.status === "error" ? (
          <p className="system-export-error" role="alert">
            Unable to export data.
          </p>
        ) : null}
      </section>
    </div>
  );
}
