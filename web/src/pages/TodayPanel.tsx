import React from "react";
import type { RefObject } from "react";
import type { HomeAuthor, HomeNote } from "./home-prototype-data";

export function TodayPanel({
  author,
  notes,
  onOpen,
  triggerRef,
}: {
  author: HomeAuthor;
  notes: HomeNote[];
  onOpen: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
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
      <span className="today-panel-notes">
        {notes.slice(0, 3).map((note) => (
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
    </button>
  );
}
