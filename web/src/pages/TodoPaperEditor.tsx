import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import type { HomeAuthor, HomeNote, HomeNoteKind } from "./home-prototype-data";
import {
  createTodoPaperEntryId,
  normalizeTodoPaperEntries,
} from "./todo-paper-storage";

type EditableTodoRow = HomeNote & { creation?: boolean };

export type TodoPaperEditorHandle = {
  getNormalizedEntries(): HomeNote[];
};

export type TodoPaperEditorProps = {
  author: HomeAuthor;
  initialEntries: readonly HomeNote[];
  onDirtyChange: (dirty: boolean) => void;
};

const NEXT_KIND: Record<HomeNoteKind, HomeNoteKind> = {
  pending: "completed",
  completed: "record",
  record: "pending",
};

const STATUS_LABEL: Record<HomeNoteKind, string> = {
  pending: "待办",
  completed: "已完成",
  record: "记录",
};

const PAPER_LINE_COUNT = 24;

function getCaretOffsetFromPoint(
  document: Document,
  clientX: number,
  clientY: number,
  fallback: number,
): number {
  const caretDocument = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  const position = caretDocument.caretPositionFromPoint?.(clientX, clientY);
  if (position) return position.offset;

  const range = caretDocument.caretRangeFromPoint?.(clientX, clientY);
  return range?.startOffset ?? fallback;
}

function createCreationRow(author: HomeAuthor): EditableTodoRow {
  return {
    id: createTodoPaperEntryId(author),
    author,
    kind: "pending",
    text: "",
    creation: true,
  };
}

function createInitialRows(
  author: HomeAuthor,
  entries: readonly HomeNote[],
): EditableTodoRow[] {
  const rows: EditableTodoRow[] = entries.map((entry) => ({ ...entry }));

  while (rows.length < PAPER_LINE_COUNT) {
    rows.push(createCreationRow(author));
  }

  return rows;
}

function resizeTodoTextarea(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function normalizeRows(rows: readonly EditableTodoRow[]): HomeNote[] {
  return normalizeTodoPaperEntries(
    rows.map(({ id, author, kind, text }) => ({
      id,
      author,
      kind,
      text,
    })),
  );
}

export const TodoPaperEditor = forwardRef<
  TodoPaperEditorHandle,
  TodoPaperEditorProps
>(function TodoPaperEditor(
  { author, initialEntries, onDirtyChange },
  ref,
) {
  const initialSnapshot = useMemo(
    () => JSON.stringify(normalizeTodoPaperEntries(initialEntries)),
    [initialEntries],
  );
  const [rows, setRows] = useState<EditableTodoRow[]>(() =>
    createInitialRows(author, initialEntries),
  );
  const textareaRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const pendingCaretRef = useRef<{ rowId: string; offset: number } | null>(null);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeRowId) return;

    const handlePointerAway = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;

      const activeTextarea = textareaRefs.current.get(activeRowId);
      const activeRow = activeTextarea?.closest(".todo-paper-row");

      if (activeRow?.contains(target)) return;
      setActiveRowId(null);
    };

    document.addEventListener("mousedown", handlePointerAway);

    return () => {
      document.removeEventListener("mousedown", handlePointerAway);
    };
  }, [activeRowId]);

  useEffect(() => {
    setRows(createInitialRows(author, initialEntries));
  }, [author, initialSnapshot]);

  useEffect(() => {
    const currentSnapshot = JSON.stringify(
      normalizeRows(rows),
    );
    onDirtyChange(currentSnapshot !== initialSnapshot);
  }, [initialSnapshot, onDirtyChange, rows]);

  const focusRow = (id: string) => {
    requestAnimationFrame(() => {
      textareaRefs.current.get(id)?.focus();
    });
  };

  useImperativeHandle(
    ref,
    () => ({
      getNormalizedEntries: () => normalizeRows(rows),
    }),
    [rows],
  );

  const updateText = (id: string, text: string) => {
    setRows((current) => {
      const index = current.findIndex((row) => row.id === id);
      if (index < 0) return current;

      const target = current[index];
      const next = [...current];
      next[index] = {
        ...target,
        text,
        creation: target.creation && text.trim().length === 0
          ? true
          : undefined,
      };

      return next;
    });
  };

  const activateRowAt = (index: number) => {
    const target = rows[index];
    if (!target) return;

    setActiveRowId(target.id);
    focusRow(target.id);
  };

  const cycleStatus = (id: string) => {
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? { ...row, kind: NEXT_KIND[row.kind] }
          : row,
      ),
    );
  };

  const handleInput = (
    id: string,
    event: FormEvent<HTMLTextAreaElement>,
  ) => {
    const textarea = event.currentTarget;
    resizeTodoTextarea(textarea);
    updateText(id, textarea.value);
  };

  const handleKeyDown = (
    index: number,
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key === "Enter") {
      event.preventDefault();
      activateRowAt(index + 1);
      return;
    }

    if (
      event.key === "Backspace" &&
      event.currentTarget.value.trim().length === 0 &&
      index > 0
    ) {
      event.preventDefault();
      activateRowAt(index - 1);
    }
  };

  return (
    <div className="todo-paper-editor">
      {rows.map((row, index) => (
        <div
          className="todo-paper-row"
          data-creation={row.creation ? "true" : undefined}
          key={row.id}
        >
          <button
            className="todo-paper-status"
            type="button"
            data-kind={row.kind}
            aria-label={`切换状态：${STATUS_LABEL[row.kind]}`}
            onClick={() => cycleStatus(row.id)}
          >
            <span aria-hidden="true" />
          </button>

          {activeRowId === row.id ? (
            <textarea
              ref={(node) => {
                if (!node) {
                  textareaRefs.current.delete(row.id);
                  return;
                }

                textareaRefs.current.set(row.id, node);
                resizeTodoTextarea(node);

                const pending = pendingCaretRef.current;
                if (pending?.rowId === row.id) {
                  pendingCaretRef.current = null;

                  requestAnimationFrame(() => {
                    const offset = Math.max(
                      0,
                      Math.min(pending.offset, node.value.length),
                    );
                    node.focus();
                    node.setSelectionRange(offset, offset);
                  });
                }
              }}
              rows={1}
              value={row.text}
              aria-label={`Todo 第 ${index + 1} 行`}
              onInput={(event) => handleInput(row.id, event)}
              onKeyDown={(event) => handleKeyDown(index, event)}
              onBlur={() => {
                setActiveRowId((current) =>
                  current === row.id ? null : current
                );
              }}
            />
          ) : (
            <button
              className="todo-paper-line-view"
              type="button"
              aria-label={`编辑 Todo 第 ${index + 1} 行`}
              onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                pendingCaretRef.current = {
                  rowId: row.id,
                  offset: Math.max(
                    0,
                    Math.min(
                      row.text.length,
                      getCaretOffsetFromPoint(
                        event.currentTarget.ownerDocument,
                        event.clientX,
                        event.clientY,
                        row.text.length,
                      ),
                    ),
                  ),
                };
                setActiveRowId(row.id);
              }}
            >
              {row.text}
            </button>
          )}
        </div>
      ))}
    </div>
  );
});
