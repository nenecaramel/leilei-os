import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import type { HomeAuthor, HomeNote, HomeNoteKind } from "./home-prototype-data";
import {
  createTodoPaperEntryId,
  normalizeTodoPaperEntries,
} from "./todo-paper-storage";

type EditableTodoRow = HomeNote & { creation?: boolean };

export type TodoPaperEditorHandle = {
  getNormalizedEntries(): HomeNote[];
  focusFirstRow(): void;
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
  return [
    ...entries.map((entry) => ({ ...entry })),
    createCreationRow(author),
  ];
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
      focusFirstRow: () => {
        const first = rows[0];
        if (first) textareaRefs.current.get(first.id)?.focus();
      },
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

      if (target.creation && text.trim().length > 0) {
        next.push(createCreationRow(author));
      }

      return next;
    });
  };

  const insertRowAfter = (index: number) => {
    const row: EditableTodoRow = {
      id: createTodoPaperEntryId(author),
      author,
      kind: "pending",
      text: "",
    };

    setRows((current) => {
      const next = [...current];
      next.splice(index + 1, 0, row);
      return next;
    });
    focusRow(row.id);
  };

  const removeEmptyRow = (index: number) => {
    const target = rows[index];
    if (!target || target.creation || target.text.trim().length > 0) {
      return;
    }

    const previous = rows[index - 1] ?? rows[index + 1];
    previous && textareaRefs.current.get(previous.id)?.focus();

    setRows((current) =>
      current.filter((row) => row.id !== target.id),
    );
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
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
    updateText(id, textarea.value);
  };

  const handleKeyDown = (
    index: number,
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key === "Enter") {
      event.preventDefault();
      insertRowAfter(index);
      return;
    }

    if (
      event.key === "Backspace" &&
      event.currentTarget.value.trim().length === 0
    ) {
      const row = rows[index];
      if (!row?.creation) {
        event.preventDefault();
        removeEmptyRow(index);
      }
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

          <textarea
            ref={(node) => {
              if (node) textareaRefs.current.set(row.id, node);
              else textareaRefs.current.delete(row.id);
            }}
            rows={1}
            value={row.text}
            aria-label={`Todo 第 ${index + 1} 行`}
            data-paper-autofocus={index === 0 ? "true" : undefined}
            onInput={(event) => handleInput(row.id, event)}
            onKeyDown={(event) => handleKeyDown(index, event)}
          />
        </div>
      ))}
    </div>
  );
});
