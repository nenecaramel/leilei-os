import { useEffect, useRef, useState } from "react";
import type { WebApiClient } from "../api/useWebApiClient";
import { WebApiError } from "../api/web-api-error";
import type {
  SystemDataResponse,
  SystemDataSummary,
} from "../system/types";
import type { WebExportDocument, WebExportScope } from "../system/export-types";
import { downloadExportDocument } from "../system/download-export";
import { executeImport, previewImport, type WebImportModuleSummary, type WebImportPreview } from "../system/import-types";
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
  | { status: "restoring"; filename: string; size: number }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

type ImportPreviewRow = {
  key: ImportModuleKey;
  label: string;
  value: string;
};

const IMPORT_MODULE_ORDER = ["diary", "todo"] as const;
type ImportModuleKey = (typeof IMPORT_MODULE_ORDER)[number];

const IMPORT_MODULE_LABELS: Record<ImportModuleKey, string> = {
  diary: "Diary",
  todo: "Todo",
};

const EMPTY_IMPORT_COUNTS: WebImportModuleSummary = {
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

function CurrentCountRow({
  label,
  active,
}: {
  label: string;
  active: number | string;
}) {
  return (
    <div className="system-data-row">
      <strong>{label}</strong>
      <div className="system-count-pair">
        <CountCell label="Active" value={active} />
        <CountCell label="Archived" value="—" />
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

function countImport(summary: Record<string, WebImportModuleSummary>, key: keyof WebImportModuleSummary): number {
  return Object.values(summary).reduce((total, counts) => total + counts[key], 0);
}

function recordLabel(count: number): string {
  return `${count} ${count === 1 ? "record" : "records"}`;
}

function newRecordLabel(count: number): string {
  return `${count} new ${count === 1 ? "record" : "records"}`;
}

function fileSummary(filename: string, size: number): string {
  return `${filename} · ${(size / 1024).toFixed(1)} KB`;
}

function importCounts(summary: Record<string, WebImportModuleSummary>, module: ImportModuleKey): WebImportModuleSummary {
  return summary[module] ?? EMPTY_IMPORT_COUNTS;
}

function importPreviewIsBlocked(preview: WebImportPreview): boolean {
  return countImport(preview.summary, "conflict") > 0 || countImport(preview.summary, "invalid") > 0;
}

function importPreviewRows(preview: WebImportPreview): ImportPreviewRow[] {
  const blocked = importPreviewIsBlocked(preview);
  return IMPORT_MODULE_ORDER.flatMap((module) => {
    const counts = importCounts(preview.summary, module);
    if (blocked) {
      if (counts.conflict === 0 && counts.invalid === 0) return [];
      const states: string[] = [];
      if (counts.conflict > 0) states.push("Conflict");
      if (counts.invalid > 0) states.push("Invalid");
      return [{ key: module, label: IMPORT_MODULE_LABELS[module], value: states.join(" · ") }];
    }
    if (counts.create === 0) return [];
    return [{ key: module, label: IMPORT_MODULE_LABELS[module], value: `${counts.create} new` }];
  });
}

function blockedImportCopy(preview: WebImportPreview): string {
  const conflicts = countImport(preview.summary, "conflict");
  const invalid = countImport(preview.summary, "invalid");
  if (conflicts > 0 && invalid > 0) {
    return "This export contains conflicting or invalid records. Nothing will be overwritten.";
  }
  if (conflicts > 0) {
    return "Existing data would differ. Nothing will be overwritten.";
  }
  return "This export contains invalid records. Nothing will be overwritten.";
}

function readyImportSummary(preview: WebImportPreview): string {
  const created = countImport(preview.summary, "create");
  const duplicates = countImport(preview.summary, "duplicate");
  if (created === 0) return "Everything is already here";
  return `${newRecordLabel(created)}${duplicates > 0 ? ` · ${duplicates} already here` : ""}`;
}

function importErrorMessage(error: unknown, fallback: string): string {
  return error instanceof WebApiError && error.message.trim().length > 0
    ? error.message
    : fallback;
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
    } catch (error) {
      setImportState({ status: "error", message: importErrorMessage(error, "Unable to validate this export file.") });
    }
  }

  async function restoreImport(): Promise<void> {
    if (importState.status !== "ready") return;
    const current = importState;
    setImportState({ status: "restoring", filename: current.filename, size: current.size });
    try {
      const result = await executeImport(api, current.bytes, current.preview.preview_fingerprint);
      const created = countImport(result.summary, "create");
      const duplicates = countImport(result.summary, "duplicate");
      const duplicateCopy = duplicates > 0 ? ` Skipped ${recordLabel(duplicates)} already present.` : "";
      setImportState({ status: "success", message: `Restored ${recordLabel(created)}.${duplicateCopy}` });
      setReloadKey((value) => value + 1);
    } catch (error) {
      setImportState({ status: "error", message: importErrorMessage(error, "Unable to restore this export file.") });
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

  const readyCreateCount = importState.status === "ready"
    ? countImport(importState.preview.summary, "create")
    : 0;
  const readyBlocked = importState.status === "ready"
    ? importPreviewIsBlocked(importState.preview)
    : false;
  const readyRows = importState.status === "ready"
    ? importPreviewRows(importState.preview)
    : [];

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
              label="Diary"
              active={state.summary.diary.active}
              archived={
                state.summary.diary.archived
              }
            />
            <CurrentCountRow
              label="Todo"
              active={state.summary.todo?.active ?? "—"}
            />
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
        <div className="system-export-header">
          <strong className="system-export-label">Restore</strong>
        </div>
        <input
          ref={importInputRef}
          className="sr-only"
          type="file"
          accept="application/json,.json"
          aria-label="Choose export file"
          onChange={(event) => { onImportFile(event.target.files?.[0]); event.currentTarget.value = ""; }}
        />

        {importState.status === "idle" ? (
          <div className="system-import-row system-import-file-row">
            <span className="system-import-row-label">Export file</span>
            <button className="system-import-action" type="button" onClick={chooseImportFile}>Choose</button>
          </div>
        ) : null}

        {importState.status === "selected" ? (
          <div className="system-import-row system-import-file-row">
            <span className="system-import-row-label" title={fileSummary(importState.filename, importState.size)}>{fileSummary(importState.filename, importState.size)}</span>
            <button className="system-import-action" type="button" onClick={() => void previewSelected()}>Preview</button>
          </div>
        ) : null}

        {importState.status === "previewing" ? (
          <div className="system-import-row system-import-file-row" aria-live="polite">
            <span className="system-import-row-label" title={fileSummary(importState.filename, importState.size)}>{fileSummary(importState.filename, importState.size)}</span>
            <span className="system-import-status">Validating…</span>
          </div>
        ) : null}

        {importState.status === "ready" ? (
          <div className="system-import-ready" aria-live="polite">
            <div className="system-import-row system-import-file-row">
              <span className="system-import-row-label" title={fileSummary(importState.filename, importState.size)}>{fileSummary(importState.filename, importState.size)}</span>
              <button className="system-import-action" type="button" onClick={chooseImportFile}>Change</button>
            </div>
            {readyRows.map((row) => (
              <div className="system-import-row system-import-module-row" key={row.key}>
                <span className="system-import-row-label">{row.label}</span>
                <span className={readyBlocked ? "system-import-row-value system-import-row-value-blocked" : "system-import-row-value"}>{row.value}</span>
              </div>
            ))}
            {readyBlocked ? (
              <div className="system-import-row system-import-message-row">
                <span className="system-import-message-copy">{blockedImportCopy(importState.preview)}</span>
              </div>
            ) : readyCreateCount === 0 ? (
              <div className="system-import-row system-import-summary-row">
                <span className="system-import-row-label">Everything is already here</span>
              </div>
            ) : (
              <div className="system-import-row system-import-summary-row">
                <span className="system-import-row-label">{readyImportSummary(importState.preview)}</span>
                <button className="system-import-action" type="button" onClick={() => void restoreImport()}>Restore</button>
              </div>
            )}
          </div>
        ) : null}

        {importState.status === "restoring" ? (
          <div className="system-import-restoring" aria-live="polite">
            <div className="system-import-row system-import-file-row">
              <span className="system-import-row-label" title={fileSummary(importState.filename, importState.size)}>{fileSummary(importState.filename, importState.size)}</span>
            </div>
            <div className="system-import-row system-import-message-row">
              <span className="system-import-status">Restoring…</span>
            </div>
          </div>
        ) : null}

        {importState.status === "success" ? (
          <div className="system-import-row system-import-message-row" role="status">
            <span className="system-import-row-label">{importState.message}</span>
            <button className="system-import-action" type="button" onClick={resetImport}>Done</button>
          </div>
        ) : null}

        {importState.status === "error" ? (
          <div className="system-import-row system-import-message-row" role="alert">
            <span className="system-import-error-copy">{importState.message}</span>
            <button className="system-import-action" type="button" onClick={chooseImportFile}>Choose</button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
