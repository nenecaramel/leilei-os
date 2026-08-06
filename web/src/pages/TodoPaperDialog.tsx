import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import type { HomeAuthor, HomeNote } from "./home-prototype-data";
import { PaperDetailDialog } from "./PaperDetailDialog";
import {
  TodoPaperEditor,
  type TodoPaperEditorHandle,
} from "./TodoPaperEditor";
import {
  formatTodoPaperDate,
  formatTodoStorageDate,
  writeTodoPaperEntries,
} from "./todo-paper-storage";

export type TodoPaperDialogProps = {
  author: HomeAuthor;
  date: Date;
  open: boolean;
  entries: readonly HomeNote[];
  triggerRef: RefObject<HTMLButtonElement | null>;
  onSaved: (entries: HomeNote[]) => void;
  onClosed: () => void;
  storage?: Storage;
};

export function TodoPaperDialog({
  author,
  date,
  open,
  entries,
  triggerRef,
  onSaved,
  onClosed,
  storage,
}: TodoPaperDialogProps) {
  const editorRef = useRef<TodoPaperEditorHandle>(null);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dateKey = formatTodoStorageDate(date);
  const dateLabel = formatTodoPaperDate(date);

  useEffect(() => {
    if (!open) return;
    setDirty(false);
    setSaveError(null);
  }, [author, dateKey, open]);

  const handleDirtyChange = useCallback((nextDirty: boolean) => {
    setDirty(nextDirty);
    if (nextDirty) setSaveError(null);
  }, []);

  const handleRequestClose = useCallback(() => {
    if (!dirty) {
      onClosed();
      return true;
    }

    const nextEntries = editorRef.current?.getNormalizedEntries() ?? [];

    try {
      const targetStorage =
        storage ??
        (typeof window === "undefined" ? null : window.localStorage);

      if (!targetStorage) {
        throw new Error("Todo paper storage unavailable");
      }

      writeTodoPaperEntries(targetStorage, author, dateKey, nextEntries);
      onSaved(nextEntries);
      onClosed();
      return true;
    } catch {
      setSaveError("保存失败，请重试");
      return false;
    }
  }, [author, dateKey, dirty, onClosed, onSaved, storage]);

  return (
    <PaperDetailDialog
      id={`today-panel-dialog-${author.toLowerCase()}`}
      open={open}
      label={`${author} Todo ${dateLabel}`}
      dateLabel={dateLabel}
      signature={author}
      triggerRef={triggerRef}
      onRequestClose={handleRequestClose}
      errorMessage={saveError}
    >
      <TodoPaperEditor
        ref={editorRef}
        author={author}
        initialEntries={entries}
        onDirtyChange={handleDirtyChange}
      />
    </PaperDetailDialog>
  );
}
