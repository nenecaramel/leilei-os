import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import type { WebApiClient } from "../api/useWebApiClient";
import { WebApiError } from "../api/web-api-error";
import type { TodoAuthor, TodoEntry, TodoPaper } from "./todo-types";
import { saveTodoPaper } from "./todo-api";
import { PaperDetailDialog } from "./PaperDetailDialog";
import {
  TodoPaperEditor,
  type TodoPaperEditorHandle,
} from "./TodoPaperEditor";
import { formatTodoPaperDate, formatTodoStorageDate } from "./todo-paper-storage";

export type TodoPaperDialogProps = {
  api?: WebApiClient;
  author: TodoAuthor;
  date: Date;
  open: boolean;
  paper?: TodoPaper | null;
  /** @deprecated retained only so legacy callers can migrate without storage fallback. */
  entries?: readonly TodoEntry[];
  /** @deprecated ignored; localStorage is no longer a source of truth. */
  storage?: Storage;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onSaved: (paper: TodoPaper) => void;
  onClosed: () => void;
};

export function TodoPaperDialog({ api, author, date, open, paper, entries = [], triggerRef, onSaved, onClosed }: TodoPaperDialogProps) {
  const editorRef = useRef<TodoPaperEditorHandle>(null);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dateKey = formatTodoStorageDate(date);
  const dateLabel = formatTodoPaperDate(date);

  useEffect(() => {
    if (!open) return;
    setDirty(false);
    setSaveError(null);
    savePromiseRef.current = null;
  }, [author, dateKey, open, paper?.revision]);

  const handleDirtyChange = useCallback((nextDirty: boolean) => {
    setDirty(nextDirty);
    if (nextDirty) setSaveError(null);
  }, []);

  const handleRequestClose = useCallback((): Promise<boolean> => {
    if (savePromiseRef.current) return savePromiseRef.current;
    if (!dirty) {
      onClosed();
      return Promise.resolve(true);
    }
    const entries = editorRef.current?.getNormalizedEntries() ?? [];
    const request = (api
      ? saveTodoPaper(api, { date: dateKey, author, revision: paper?.revision ?? null, entries })
      : Promise.reject(new Error("Web API unavailable")))
      .then((committed) => {
        onSaved(committed);
        onClosed();
        return true;
      })
      .catch((error: unknown) => {
        setSaveError(error instanceof WebApiError && error.code === "TODO_PAPER_CONFLICT"
          ? "这张纸张已在其他设备修改，请重新打开后再保存。"
          : "保存失败，请重试");
        return false;
      })
      .finally(() => { savePromiseRef.current = null; });
    savePromiseRef.current = request;
    return request;
  }, [api, author, dateKey, dirty, onClosed, onSaved, paper?.revision]);

  const initialEntries: TodoEntry[] = [...(paper?.entries ?? entries)];
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
      <TodoPaperEditor ref={editorRef} author={author} initialEntries={initialEntries} onDirtyChange={handleDirtyChange} />
    </PaperDetailDialog>
  );
}
