import { useEffect, useRef, useState } from "react";
import type { WebApiClient } from "../api/useWebApiClient";
import { WebApiError } from "../api/web-api-error";
import type {
  SystemDataResponse,
  SystemDataSummary,
} from "../system/types";
import type {
  WebExportDocument,
  WebExportScope,
} from "../system/export-types";
import { downloadExportDocument } from "../system/download-export";
import {
  executeImport,
  previewImport,
  type WebImportExecution,
  type WebImportModule,
  type WebImportModuleSummary,
  type WebImportPreview,
} from "../system/import-types";
import { PageHeader } from "./PageHeader";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; summary: SystemDataSummary }
  | { status: "error" };

type ExportState =
  | { status: "idle" }
  | { status: "loading"; scope: WebExportScope }
  | { status: "error"; message: string };

type ImportState =
  | { status: "idle" }
  | {
      status: "previewing";
      filename: string;
      bytes: Uint8Array;
      size: number;
    }
  | {
      status: "ready";
      filename: string;
      preview: WebImportPreview;
      bytes: Uint8Array;
      size: number;
    }
  | {
      status: "restoring";
      filename: string;
      preview: WebImportPreview;
      size: number;
    }
  | {
      status: "success";
      filename: string;
      result: WebImportExecution;
    }
  | { status: "error"; message: string };

const IMPORT_MODULE_ORDER: WebImportModule[] = [
  "diary",
  "diary_comments",
  "todo",
  "workspaces",
  "conversations",
  "mind",
  "universe",
];

const IMPORT_MODULE_LABELS: Record<WebImportModule, string> = {
  diary: "Diary",
  diary_comments: "Diary comments",
  todo: "Todo",
  workspaces: "Workspaces",
  conversations: "Conversations",
  mind: "Mind",
  universe: "Universe",
};

const EMPTY_COUNTS: WebImportModuleSummary = {
  create: 0,
  duplicate: 0,
  conflict: 0,
  invalid: 0,
};

function CountCell({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="system-count-cell">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SimpleCountRow({
  label,
  value,
  valueLabel = "Stored",
}: {
  label: string;
  value: number | string;
  valueLabel?: string;
}) {
  return (
    <div className="system-data-row">
      <strong>{label}</strong>
      <div className="system-count-pair">
        <CountCell label={valueLabel} value={value} />
      </div>
    </div>
  );
}

function ArchivedCountRow({
  label,
  active,
  archived,
}: {
  label: string;
  active: number | string;
  archived: number | string;
}) {
  return (
    <div className="system-data-row">
      <strong>{label}</strong>
      <div className="system-count-pair">
        <CountCell label="Active" value={active} />
        <CountCell label="Archived" value={archived} />
      </div>
    </div>
  );
}

function moduleCounts(
  summary: Partial<Record<WebImportModule, WebImportModuleSummary>>,
  module: WebImportModule,
): WebImportModuleSummary {
  return summary[module] ?? EMPTY_COUNTS;
}

function countImport(
  summary: Partial<Record<WebImportModule, WebImportModuleSummary>>,
  key: keyof WebImportModuleSummary,
): number {
  return Object.values(summary).reduce(
    (total, counts) => total + (counts?.[key] ?? 0),
    0,
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatExportedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function fileSummary(filename: string, size: number): string {
  return `${filename} · ${formatBytes(size)}`;
}

function formatModuleCounts(counts: WebImportModuleSummary): string {
  const parts: string[] = [];
  if (counts.create > 0) parts.push(`${counts.create} new`);
  if (counts.duplicate > 0) parts.push(`${counts.duplicate} already here`);
  if (counts.conflict > 0) parts.push(`${counts.conflict} conflict`);
  if (counts.invalid > 0) parts.push(`${counts.invalid} invalid`);
  return parts.length > 0 ? parts.join(" · ") : "No records";
}

function importBlocked(preview: WebImportPreview): boolean {
  return (
    countImport(preview.summary, "conflict") > 0
    || countImport(preview.summary, "invalid") > 0
  );
}

function importErrorMessage(error: unknown, fallback: string): string {
  return error instanceof WebApiError && error.message.trim().length > 0
    ? error.message
    : fallback;
}

function exportErrorMessage(error: unknown): string {
  if (!(error instanceof WebApiError)) return "Unable to create this backup.";
  if (error.code === "EXPORT_IN_PROGRESS") {
    return error.message.trim().length > 0
      ? error.message
      : "A conversation or Mind update is still being finalized.";
  }
  if (error.code === "EXPORT_TOO_LARGE") {
    return "This backup is too large to export as one JSON file.";
  }
  return error.message.trim().length > 0
    ? error.message
    : "Unable to create this backup.";
}

function ModuleSummaryRows({
  summary,
  includedModules,
  blocked = false,
}: {
  summary: Partial<Record<WebImportModule, WebImportModuleSummary>>;
  includedModules: WebImportModule[];
  blocked?: boolean;
}) {
  const included = new Set(includedModules);
  return (
    <>
      {IMPORT_MODULE_ORDER.filter((module) => included.has(module)).map(
        (module) => (
          <div className="system-import-row system-import-module-row" key={module}>
            <span className="system-import-row-label">
              {IMPORT_MODULE_LABELS[module]}
            </span>
            <span
              className={
                blocked
                  ? "system-import-row-value system-import-row-value-blocked"
                  : "system-import-row-value"
              }
            >
              {formatModuleCounts(moduleCounts(summary, module))}
            </span>
          </div>
        ),
      )}
    </>
  );
}

export function SystemDataPageContent({
  api,
}: {
  api: WebApiClient;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [exportState, setExportState] =
    useState<ExportState>({ status: "idle" });
  const [includeAudit, setIncludeAudit] = useState(false);
  const [importState, setImportState] =
    useState<ImportState>({ status: "idle" });
  const importInputRef = useRef<HTMLInputElement>(null);
  const importSelectionRef = useRef(0);

  async function runExport(scope: WebExportScope): Promise<void> {
    setExportState({ status: "loading", scope });
    const path =
      `/system/export?scope=${scope}${includeAudit ? "&include_audit=true" : ""}`;
    try {
      const document = await api.request<WebExportDocument>(path);
      downloadExportDocument(document, scope);
      setExportState({ status: "idle" });
    } catch (error) {
      setExportState({
        status: "error",
        message: exportErrorMessage(error),
      });
    }
  }

  function chooseImportFile(): void {
    importInputRef.current?.click();
  }

  function resetImport(): void {
    importSelectionRef.current += 1;
    setImportState({ status: "idle" });
  }

  function onImportFile(file: File | undefined): void {
    if (!file) return;
    const selection = importSelectionRef.current + 1;
    importSelectionRef.current = selection;
    if (file.size > 50 * 1024 * 1024) {
      setImportState({
        status: "error",
        message: "Import package is too large.",
      });
      return;
    }

    void file.arrayBuffer()
      .then(async (buffer) => {
        if (selection !== importSelectionRef.current) return;
        const bytes = new Uint8Array(buffer);
        setImportState({
          status: "previewing",
          filename: file.name,
          bytes,
          size: file.size,
        });
        try {
          const preview = await previewImport(api, bytes);
          if (selection !== importSelectionRef.current) return;
          setImportState({
            status: "ready",
            filename: file.name,
            preview,
            bytes,
            size: file.size,
          });
        } catch (error) {
          if (selection !== importSelectionRef.current) return;
          setImportState({
            status: "error",
            message: importErrorMessage(
              error,
              "Unable to validate this backup file.",
            ),
          });
        }
      })
      .catch(() => {
        if (selection !== importSelectionRef.current) return;
        setImportState({
          status: "error",
          message: "Unable to read this backup file.",
        });
      });
  }

  async function restoreImport(): Promise<void> {
    if (importState.status !== "ready") return;
    const current = importState;
    setImportState({
      status: "restoring",
      filename: current.filename,
      preview: current.preview,
      size: current.size,
    });
    try {
      const result = await executeImport(
        api,
        current.bytes,
        current.preview.preview_fingerprint,
      );
      setImportState({
        status: "success",
        filename: current.filename,
        result,
      });
      setReloadKey((value) => value + 1);
    } catch (error) {
      setImportState({
        status: "error",
        message: importErrorMessage(
          error,
          "Unable to restore this backup file.",
        ),
      });
    }
  }

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    api.request<SystemDataResponse>("/system/data")
      .then((response) => {
        if (!active) return;
        setState({ status: "ready", summary: response.data });
      })
      .catch(() => {
        if (!active) return;
        setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [api, reloadKey]);

  const readyBlocked =
    importState.status === "ready" && importBlocked(importState.preview);
  const readyCreates =
    importState.status === "ready"
      ? countImport(importState.preview.summary, "create")
      : 0;

  return (
    <div className="page system-page system-data-page">
      <PageHeader
        eyebrow="System"
        title="Data"
        description="Portable data, backups, and add-only restore."
      />

      <section className="system-section" aria-label="Portable data summary">
        {state.status === "loading" ? (
          <p className="system-state-copy" role="status" aria-live="polite">
            Reading data summary…
          </p>
        ) : null}

        {state.status === "error" ? (
          <div className="system-state-message">
            <p>Unable to read data summary.</p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setReloadKey((value) => value + 1)}
            >
              Retry
            </button>
          </div>
        ) : null}

        {state.status === "ready" ? (
          <div className="system-data-list">
            <ArchivedCountRow
              label="Diary"
              active={state.summary.diary.active}
              archived={state.summary.diary.archived}
            />
            <SimpleCountRow
              label="Diary comments"
              value={state.summary.diary_comments.count}
            />
            <SimpleCountRow label="Todo" value={state.summary.todo.count} />
            <SimpleCountRow
              label="Workspaces"
              value={state.summary.workspaces.count}
            />
            <ArchivedCountRow
              label="Conversations"
              active={state.summary.conversations.active}
              archived={state.summary.conversations.archived}
            />
            <SimpleCountRow label="Mind" value={state.summary.mind.count} />
            <SimpleCountRow
              label="Universe"
              value={state.summary.universe.nodes}
              valueLabel="Nodes"
            />
          </div>
        ) : null}
      </section>

      <section
        className="system-section system-export-card"
        aria-label="Create backup"
      >
        <div className="system-export-header">
          <strong className="system-export-label">Backup</strong>
        </div>

        <div className="system-export-action-row" aria-label="Backup scope">
          {([
            ["all", "Full Backup"],
            ["diary", "Diary"],
            ["todo", "Todo"],
          ] as const).map(([scope, label]) => (
            <button
              className="system-export-action"
              type="button"
              key={scope}
              disabled={exportState.status === "loading"}
              onClick={() => void runExport(scope)}
            >
              {exportState.status === "loading"
                && exportState.scope === scope
                ? "Creating…"
                : label}
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
            Include diagnostic audit/lifecycle events
          </span>
          {includeAudit ? (
            <span className="system-export-audit-check" aria-hidden="true">
              ✓
            </span>
          ) : null}
        </label>
        <p className="system-backup-note">
          Audit events are diagnostic only and are not restored. Full Backup
          contains portable LeileiOS product data; machine-local Workspace
          paths are not included.
        </p>

        {exportState.status === "error" ? (
          <p className="system-export-error" role="alert">
            {exportState.message}
          </p>
        ) : null}
      </section>

      <section
        className="system-section system-import-card"
        aria-label="Restore backup"
      >
        <div className="system-export-header">
          <strong className="system-export-label">Restore</strong>
        </div>
        <input
          ref={importInputRef}
          className="sr-only"
          type="file"
          accept="application/json,.json"
          aria-label="Choose backup file"
          onChange={(event) => {
            onImportFile(event.target.files?.[0]);
            event.currentTarget.value = "";
          }}
        />

        {importState.status === "idle" ? (
          <div className="system-import-row system-import-file-row">
            <span className="system-import-row-label">Backup file</span>
            <button
              className="system-import-action"
              type="button"
              onClick={chooseImportFile}
            >
              Choose
            </button>
          </div>
        ) : null}

        {importState.status === "previewing" ? (
          <div className="system-import-row system-import-file-row" aria-live="polite">
            <span
              className="system-import-row-label"
              title={fileSummary(importState.filename, importState.size)}
            >
              {fileSummary(importState.filename, importState.size)}
            </span>
            <span className="system-import-status">Checking…</span>
          </div>
        ) : null}

        {importState.status === "ready" ? (
          <div className="system-import-ready" aria-live="polite">
            <div className="system-import-row system-import-file-row">
              <span
                className="system-import-row-label"
                title={fileSummary(importState.filename, importState.size)}
              >
                {fileSummary(importState.filename, importState.size)}
              </span>
              <button
                className="system-import-action"
                type="button"
                onClick={chooseImportFile}
              >
                Change
              </button>
            </div>
            <div className="system-import-row">
              <span className="system-import-row-label">Backup format</span>
              <span className="system-import-row-value">
                v{importState.preview.schema_version}
              </span>
            </div>
            <div className="system-import-row">
              <span className="system-import-row-label">Exported</span>
              <span className="system-import-row-value">
                {formatExportedAt(importState.preview.exported_at)}
              </span>
            </div>
            <div className="system-import-row">
              <span className="system-import-row-label">Audit</span>
              <span className="system-import-row-value">
                {importState.preview.audit_included
                  ? "Included · diagnostic only"
                  : "Not included"}
              </span>
            </div>

            <ModuleSummaryRows
              summary={importState.preview.summary}
              includedModules={importState.preview.included_modules}
              blocked={readyBlocked}
            />

            {readyBlocked ? (
              <div className="system-import-message-row">
                <p className="system-import-message-copy">
                  This backup contains conflicts or invalid records. Restore is
                  add-only: existing data is never overwritten, so nothing will
                  be written until those records are resolved.
                </p>
              </div>
            ) : readyCreates === 0 ? (
              <div className="system-import-message-row">
                <p className="system-import-message-copy">
                  Everything in this backup is already here.
                </p>
              </div>
            ) : (
              <div className="system-import-row system-import-summary-row">
                <span className="system-import-row-label">
                  {readyCreates} new {readyCreates === 1 ? "record" : "records"}
                  {" · "}existing data will not be overwritten
                </span>
                <button
                  className="system-import-action"
                  type="button"
                  disabled={!importState.preview.can_execute}
                  onClick={() => void restoreImport()}
                >
                  Restore
                </button>
              </div>
            )}
          </div>
        ) : null}

        {importState.status === "restoring" ? (
          <div className="system-import-restoring" aria-live="polite">
            <div className="system-import-row system-import-file-row">
              <span className="system-import-row-label">
                {fileSummary(importState.filename, importState.size)}
              </span>
              <span className="system-import-status">Restoring…</span>
            </div>
          </div>
        ) : null}

        {importState.status === "success" ? (
          <div className="system-import-ready" role="status">
            <div className="system-import-row">
              <span className="system-import-row-label">Restore complete</span>
              <button
                className="system-import-action"
                type="button"
                onClick={resetImport}
              >
                Done
              </button>
            </div>
            <ModuleSummaryRows
              summary={importState.result.summary}
              includedModules={importState.result.included_modules}
            />
          </div>
        ) : null}

        {importState.status === "error" ? (
          <div className="system-import-row system-import-message-row" role="alert">
            <span className="system-import-error-copy">
              {importState.message}
            </span>
            <button
              className="system-import-action"
              type="button"
              onClick={chooseImportFile}
            >
              Choose
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
