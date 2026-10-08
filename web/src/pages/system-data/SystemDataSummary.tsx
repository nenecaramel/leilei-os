import type {
  WebImportModule,
  WebImportModuleSummary,
} from "../../system/import-types";
import { formatModuleCounts, moduleCounts } from "./system-data-format";

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
  conversations: "Conversation records",
  mind: "Mind records",
  universe: "Universe",
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

export function SimpleCountRow({
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

export function ArchivedCountRow({
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

export function ModuleSummaryRows({
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

