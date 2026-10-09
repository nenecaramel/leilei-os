import type { ReactNode } from "react";

/** Shared reading/editing controls, in the same order on every module paper. */
export function PaperDetailActions({
  editing,
  busy,
  invalid,
  onCancel,
  onSave,
  onEdit,
  readingAction,
}: {
  editing: boolean;
  busy: boolean;
  invalid: boolean;
  onCancel(): void;
  onSave(): void;
  onEdit(): void;
  readingAction?: ReactNode;
}) {
  return editing ? (
    <>
      <button
        className="memory-paper-control"
        disabled={busy}
        onClick={onCancel}
      >
        取消
      </button>
      <span>·</span>
      <button
        className="memory-paper-control"
        disabled={busy || invalid}
        onClick={onSave}
      >
        {busy ? "保存中…" : "保存"}
      </button>
    </>
  ) : (
    <>
      {readingAction}
      {readingAction ? <span>·</span> : null}
      <button className="memory-paper-control" disabled={busy} onClick={onEdit}>
        编辑
      </button>
    </>
  );
}
