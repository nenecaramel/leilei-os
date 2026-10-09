import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";

import { resizePaperTextarea } from "./paper-editor-autosize";

import type { TodoAuthor, TodoEntry, TodoEntryKind } from "./todo-types";
import { createTodoPaperEntryId } from "./todo-paper-storage";

import { normalizeRows, withText, splitTodoText, splitPastedTodoLines, planTodoPaste, mergeTodoRows, type EditableTodoRow } from "./todo-row-transforms";

export type TodoPaperEditorHandle = {
  getNormalizedEntries(): TodoEntry[];
};

export type TodoPaperEditorProps = {
  author: TodoAuthor;
  initialEntries: readonly TodoEntry[];
  onDirtyChange: (dirty: boolean) => void;
};

const NEXT_KIND: Record<TodoEntryKind, TodoEntryKind> = {
  pending: "completed",
  completed: "record",
  record: "pending",
};

const STATUS_LABEL: Record<TodoEntryKind, string> = {
  pending: "待办",
  completed: "已完成",
  record: "记录",
};

const PAPER_LINE_COUNT = 24;

function createCreationRow(author: TodoAuthor): EditableTodoRow {
  return {
    id: createTodoPaperEntryId(author),
    kind: "pending",
    text: "",
    creation: true,
  };
}

function normalizeVisibleRows(
  author: TodoAuthor,
  rows: readonly EditableTodoRow[],
): EditableTodoRow[] {
  const next = rows.map((row) => ({ ...row }));

  let lastContentIndex = -1;
  next.forEach((row, index) => {
    if (row.text.trim().length > 0) {
      lastContentIndex = index;
    }
  });

  const targetLength = Math.max(PAPER_LINE_COUNT, lastContentIndex + 2);

  while (next.length < targetLength) {
    next.push(createCreationRow(author));
  }

  while (
    next.length > targetLength &&
    next.at(-1)?.creation &&
    next.at(-1)?.text.length === 0
  ) {
    next.pop();
  }

  return next;
}

function createInitialRows(
  author: TodoAuthor,
  entries: readonly TodoEntry[],
): EditableTodoRow[] {
  return normalizeVisibleRows(
    author,
    entries.map((entry) => ({ ...entry })),
  );
}

function resizeTodoTextarea(textarea: HTMLTextAreaElement) {
  resizePaperTextarea(textarea, 30);
}

export const TodoPaperEditor = forwardRef<
  TodoPaperEditorHandle,
  TodoPaperEditorProps
>(function TodoPaperEditor({ author, initialEntries, onDirtyChange }, ref) {
  const initialSnapshot = useMemo(
    () =>
      JSON.stringify(
        initialEntries
          .map(({ id, kind, text }) => ({
            id,
            kind,
            text: text.trim(),
          }))
          .filter((entry) => entry.text.length > 0),
      ),
    [initialEntries],
  );

  const [rows, setRows] = useState<EditableTodoRow[]>(() =>
    createInitialRows(author, initialEntries),
  );

  const textareaRefs = useRef(new Map<string, HTMLTextAreaElement>());
  useLayoutEffect(() => {
    const resize = () => textareaRefs.current.forEach(resizeTodoTextarea);
    const first = textareaRefs.current.values().next().value;
    const editor = first?.closest(".todo-paper-editor");
    let width = editor?.clientWidth;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (editor?.clientWidth === width) return;
            width = editor?.clientWidth;
            resize();
          });
    if (editor) observer?.observe(editor);
    window.addEventListener("resize", resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);
  const pendingCaretRef = useRef<{ rowId: string; offset: number } | null>(
    null,
  );
  const isComposingRef = useRef(false);

  useEffect(() => {
    setRows(createInitialRows(author, initialEntries));
  }, [author, initialSnapshot]);

  useEffect(() => {
    const currentSnapshot = JSON.stringify(normalizeRows(rows));
    onDirtyChange(currentSnapshot !== initialSnapshot);
  }, [initialSnapshot, onDirtyChange, rows]);

  useLayoutEffect(() => {
    const pending = pendingCaretRef.current;
    if (!pending) return;
    const textarea = textareaRefs.current.get(pending.rowId);
    if (!textarea) return;
    pendingCaretRef.current = null;
    const offset = Math.max(0, Math.min(pending.offset, textarea.value.length));
    textarea.focus();
    textarea.setSelectionRange(offset, offset);
    resizeTodoTextarea(textarea);
  }, [rows]);

  useImperativeHandle(
    ref,
    () => ({
      getNormalizedEntries: () => normalizeRows(rows),
    }),
    [rows],
  );

  const focusRow = (rowId: string, offset: number) => {
    const textarea = textareaRefs.current.get(rowId);
    if (!textarea) {
      pendingCaretRef.current = { rowId, offset };
      return;
    }

    requestAnimationFrame(() => {
      const nextOffset = Math.max(0, Math.min(offset, textarea.value.length));
      textarea.focus();
      textarea.setSelectionRange(nextOffset, nextOffset);
    });
  };

  const updateText = (id: string, text: string) => {
    setRows((current) => {
      const index = current.findIndex((row) => row.id === id);
      if (index < 0) return current;

      const next = [...current];
      next[index] = withText(next[index], text);
      return normalizeVisibleRows(author, next);
    });
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

  const splitRow = (
    index: number,
    selectionStart: number,
    selectionEnd: number,
  ) => {
    setRows((current) => {
      const row = current[index];
      if (!row) return current;

      const { before, after } = splitTodoText(row.text, selectionStart, selectionEnd);
      const next = [...current];
      next[index] = withText(row, before);

      const following = next[index + 1];
      let targetRow: EditableTodoRow;

      if (
        following?.creation &&
        following.text.length === 0
      ) {
        targetRow = withText(following, after);
        next[index + 1] = targetRow;
      } else {
        targetRow = withText(createCreationRow(author), after);
        next.splice(index + 1, 0, targetRow);
      }

      pendingCaretRef.current = {
        rowId: targetRow.id,
        offset: 0,
      };

      return normalizeVisibleRows(author, next);
    });
  };

  const mergeWithPrevious = (index: number) => {
    if (index <= 0) return;

    setRows((current) => {
      const change = mergeTodoRows(current, index, "previous");
      if (!change) return current;
      pendingCaretRef.current = change.caret;
      return normalizeVisibleRows(author, change.rows);
    });
  };

  const mergeWithNext = (index: number) => {
    setRows((current) => {
      const change = mergeTodoRows(current, index, "next");
      if (!change) return current;
      pendingCaretRef.current = change.caret;
      return normalizeVisibleRows(author, change.rows);
    });
  };

  const pasteMultiline = (
    index: number,
    event: ClipboardEvent<HTMLTextAreaElement>,
  ) => {
    const clipboardText = event.clipboardData.getData("text/plain");
    if (!/[\r\n]/.test(clipboardText)) return;

    event.preventDefault();

    const textarea = event.currentTarget;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    const lines = splitPastedTodoLines(clipboardText);

    setRows((current) => {
      const row = current[index];
      if (!row) return current;

      const plan = planTodoPaste(row.text, start, end, lines);
      const next = [...current];

      next[index] = withText(row, plan.first);

      const insertedRows = plan.following.map((text) =>
        withText(createCreationRow(author), text)
      );

      next.splice(index + 1, 0, ...insertedRows);

      const target = insertedRows.at(-1);
      if (target) {
        pendingCaretRef.current = {
          rowId: target.id,
          offset: plan.caretOffset,
        };
      }

      return normalizeVisibleRows(author, next);
    });
  };

  const handleKeyDown = (
    index: number,
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    const textarea = event.currentTarget;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    const collapsed = start === end;

    if (event.key === "Enter") {
      if (
        isComposingRef.current ||
        event.nativeEvent.isComposing ||
        event.keyCode === 229
      ) {
        return;
      }

      if (event.shiftKey) {
        return;
      }

      event.preventDefault();
      splitRow(index, start, end);
      return;
    }

    if (
      event.key === "Backspace" &&
      collapsed &&
      start === 0 &&
      index > 0
    ) {
      event.preventDefault();
      mergeWithPrevious(index);
      return;
    }

    if (
      event.key === "Delete" &&
      collapsed &&
      end === textarea.value.length
    ) {
      event.preventDefault();
      mergeWithNext(index);
      return;
    }

    if (
      event.key === "ArrowLeft" &&
      collapsed &&
      start === 0 &&
      index > 0
    ) {
      const previous = rows[index - 1];
      if (!previous) return;
      event.preventDefault();
      focusRow(previous.id, previous.text.length);
      return;
    }

    if (
      event.key === "ArrowRight" &&
      collapsed &&
      end === textarea.value.length
    ) {
      const next = rows[index + 1];
      if (!next) return;
      event.preventDefault();
      focusRow(next.id, 0);
      return;
    }

    if (
      event.key === "ArrowUp" &&
      collapsed &&
      start === 0 &&
      index > 0
    ) {
      const previous = rows[index - 1];
      if (!previous) return;
      event.preventDefault();
      focusRow(previous.id, previous.text.length);
      return;
    }

    if (
      event.key === "ArrowDown" &&
      collapsed &&
      end === textarea.value.length
    ) {
      const next = rows[index + 1];
      if (!next) return;
      event.preventDefault();
      focusRow(next.id, 0);
    }
  };

  const handleChange = (
    rowId: string,
    event: ChangeEvent<HTMLTextAreaElement>,
  ) => {
    resizeTodoTextarea(event.currentTarget);
    updateText(rowId, event.currentTarget.value);
  };

  return (
    <div className="todo-paper-editor" data-editor-mode="continuous">
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
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => cycleStatus(row.id)}
          >
            <span aria-hidden="true" />
          </button>

          <div className="paper-textarea-layout">
            <textarea
              ref={(node) => {
                if (!node) {
                  textareaRefs.current.delete(row.id);
                  return;
                }

                textareaRefs.current.set(row.id, node);
                resizeTodoTextarea(node);
              }}
              rows={1}
              value={row.text}
              tabIndex={index === 0 ? 0 : -1}
              aria-label={`Todo 第 ${index + 1} 行`}
              onChange={(event) => handleChange(row.id, event)}
              onPaste={(event) => pasteMultiline(index, event)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              onKeyDown={(event) => handleKeyDown(index, event)}
              onBlur={() => {
                isComposingRef.current = false;
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
});
