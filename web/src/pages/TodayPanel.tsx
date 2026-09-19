import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { TodoAuthor, TodoEntry } from "./todo-types";

export function TodayPanel({
  author,
  notes,
  onOpen,
  triggerRef,
}: {
  author: TodoAuthor;
  notes: readonly TodoEntry[];
  onOpen: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const notesRef = useRef<HTMLSpanElement | null>(null);
  const [hasOverflow, setHasOverflow] = useState(false);

  useLayoutEffect(() => {
    const element = notesRef.current;
    if (!element) return;

    const measure = () =>
      setHasOverflow(element.scrollHeight > element.clientHeight + 1);

    measure();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [notes]);

  return (
    <button
      ref={triggerRef}
      className={`today-panel today-panel-${author.toLowerCase()}`}
      type="button"
      aria-haspopup="dialog"
      aria-controls={`today-panel-dialog-${author.toLowerCase()}`}
      onClick={onOpen}
    >
      <span className="today-panel-author">{author}</span>
      <span ref={notesRef} className="today-panel-notes">
        {notes.map((note) => (
          <span className={`today-note today-note-${note.kind}`} key={note.id}>
            <span
              className="today-note-mark"
              data-kind={note.kind}
              aria-hidden="true"
            >
              <span />
            </span>
            <span>{note.text}</span>
          </span>
        ))}
      </span>
      {hasOverflow ? (
        <span className="today-panel-overflow" aria-hidden="true">...</span>
      ) : null}
    </button>
  );
}
