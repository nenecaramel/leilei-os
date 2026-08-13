import { useEffect, useRef, useState } from "react";
import type {
  WebApiClient,
} from "../api/useWebApiClient";
import type {
  SystemDataResponse,
  SystemDataSummary,
} from "../system/types";
import type { WebExportDocument, WebExportScope } from "../system/export-types";
import { downloadExportDocument } from "../system/download-export";
import { executeImport, previewImport, type WebImportPreview } from "../system/import-types";
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

type ImportState =
  | { status: "idle" }
  | { status: "selected"; filename: string; bytes: Uint8Array; size: number }
  | { status: "previewing"; filename: string; bytes: Uint8Array; size: number }
  | { status: "ready"; filename: string; preview: WebImportPreview; bytes: Uint8Array; size: number }
  | { status: "restoring"; filename: string }
  | { status: "error"; message: string };

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
  const [importState, setImportState] = useState<ImportState>({ status: "idle" });
  const importInputRef = useRef<HTMLInputElement>(null);
  const importSelectionRef = useRef(0);

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

  function onImportFile(file: File | undefined): void {
    if (!file) return;
    const selection = importSelectionRef.current + 1;
    importSelectionRef.current = selection;
    if (file.size > 10 * 1024 * 1024) {
      setImportState({ status: "error", message: "Import package is too large." });
      return;
    }
    void file.arrayBuffer().then((buffer) => {
      if (selection !== importSelectionRef.current) return;
      setImportState({ status: "selected", filename: file.name, bytes: new Uint8Array(buffer), size: file.size });
    }).catch(() => {
      if (selection === importSelectionRef.current) setImportState({ status: "error", message: "Unable to read this export file." });
    });
  }

  async function previewSelected(): Promise<void> {
    if (importState.status !== "selected") return;
    const current = importState;
    setImportState({ status: "previewing", filename: current.filename, bytes: current.bytes, size: current.size });
    try {
      const preview = await previewImport(api, current.bytes);
      setImportState({ status: "ready", filename: current.filename, preview, bytes: current.bytes, size: current.size });
    } catch {
      setImportState({ status: "error", message: "Unable to validate this export file." });
    }
  }

  async function restoreImport(): Promise<void> {
    if (importState.status !== "ready") return;
    const current = importState;
    setImportState({ status: "restoring", filename: current.filename });
    try {
      await executeImport(api, current.bytes, current.preview.preview_fingerprint);
      setImportState({ status: "idle" });
      setReloadKey((value) => value + 1);
    } catch {
      setImportState({ status: "error", message: "Unable to restore this export file." });
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

      <section
        className="system-section system-export-card"
        aria-label="Export data"
      >
        <div className="system-export-header">
          <strong className="system-export-label">
            Export
          </strong>
        </div>

        <div
          className="system-export-action-row"
          aria-label="Export scope"
        >
          {([
            ["all", "All"],
            ["memory", "Memory"],
            ["diary", "Diary"],
            ["task", "Task"],
            ["todo", "Todo"],
          ] as const).map(([scope, label]) => (
            <button
              className="system-export-action"
              type="button"
              key={scope}
              disabled={exportState.status === "loading"}
              onClick={() => void runExport(scope)}
            >
              {label}
            </button>
          ))}
        </div>

        <label
          className="system-export-audit"
          data-active={includeAudit ? "true" : "false"}
        >
          <input
            className="sr-only system-export-audit-input"
            type="checkbox"
            checked={includeAudit}
            onChange={(event) => setIncludeAudit(event.target.checked)}
          />
          <span className="system-export-audit-text">
            Include audit/lifecycle events
          </span>
          {includeAudit ? (
            <span
              className="system-export-audit-check"
              aria-hidden="true"
            >
              ✓
            </span>
          ) : null}
        </label>

        {exportState.status === "error" ? (
          <p className="system-export-error" role="alert">
            Unable to export data.
          </p>
        ) : null}
      </section>

      <section className="system-section system-import-card" aria-label="Restore data">
        <div className="system-export-header"><strong className="system-export-label">Restore</strong></div>
        <p className="system-note">Validate an export before restoring new records. Existing records are never overwritten.</p>
        <input
          ref={importInputRef}
          className="sr-only"
          type="file"
          accept="application/json,.json"
          onChange={(event) => { onImportFile(event.target.files?.[0]); event.currentTarget.value = ""; }}
        />
        <button className="secondary-button" type="button" disabled={importState.status === "previewing" || importState.status === "restoring"} onClick={() => importInputRef.current?.click()}>
          Choose export file
        </button>
        {importState.status === "selected" ? <button className="secondary-button" type="button" onClick={() => void previewSelected()}>Preview restore</button> : null}
        {importState.status === "previewing" ? <p className="system-state-copy" aria-live="polite">Validating…</p> : null}
        {importState.status === "ready" ? (
          <div className="system-import-preview" aria-live="polite">
            <p>{importState.filename} · {(importState.size / 1024).toFixed(1)} KB</p>
            <p>{importState.preview.can_execute ? "Ready to restore new records." : "No new records can be restored."}</p>
            {Object.entries(importState.preview.summary).map(([module, counts]) => <p key={module}>{module}: create {counts.create}, duplicate {counts.duplicate}, conflict {counts.conflict}, invalid {counts.invalid}</p>)}
            <button className="secondary-button" type="button" disabled={!importState.preview.can_execute} onClick={() => void restoreImport()}>Restore selected data</button>
          </div>
        ) : null}
        {importState.status === "restoring" ? <p className="system-state-copy" aria-live="polite">Restoring…</p> : null}
        {importState.status === "error" ? <p className="system-export-error" role="alert">{importState.message}</p> : null}
      </section>
    </div>
  );
}
