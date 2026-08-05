import React, { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { HomeAuthor, HomeNote } from "./home-prototype-data";

export function TodayPanelDialog({
  author,
  notes,
  open,
  onClose,
  triggerRef,
}: {
  author: HomeAuthor;
  notes: HomeNote[];
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const frameWindow = window;
    const frame = frameWindow.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      frameWindow.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      triggerRef.current?.focus();
    };
  }, [onClose, open, triggerRef]);

  if (!open) return null;
  const lowerAuthor = author.toLowerCase();
  return (
    <div className="today-panel-dialog-layer" role="presentation">
      <button className="today-panel-dialog-backdrop" type="button" aria-label="关闭今日记录" onClick={onClose} />
      <section
        className={`today-panel-dialog today-panel-dialog-${lowerAuthor}`}
        id={`today-panel-dialog-${lowerAuthor}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`today-panel-dialog-title-${lowerAuthor}`}
      >
        <header className="today-panel-dialog-header">
          <div>
            <span className="eyebrow">Today</span>
            <h2 id={`today-panel-dialog-title-${lowerAuthor}`}>{author} 的今日记录</h2>
            <p>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" }).format(new Date())}</p>
          </div>
          <button ref={closeButtonRef} className="icon-button" type="button" aria-label="关闭今日记录" onClick={onClose}>×</button>
        </header>
        <div className="today-panel-dialog-content">
          {notes.map((note) => (
            <article className={`today-dialog-note today-note-${note.kind}`} key={note.id}>
              <span className="today-note-mark" aria-hidden="true" />
              <p>{note.text}</p>
              <small>{note.kind === "pending" ? "待留意" : note.kind === "completed" ? "已完成" : "记录"}</small>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
