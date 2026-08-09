import { useEffect, useState, type RefObject } from "react";
import { DiaryPaperEditor } from "./DiaryPaperEditor.js";
import { PaperDetailDialog } from "./PaperDetailDialog.js";
import { formatDaySpaceDateLabel } from "./day-space-location.js";
import type { DaySpaceDiaryPrototype } from "./day-space-prototype-data.js";

export function DaySpaceDiaryDialog({
  diary,
  open,
  triggerRef,
  onSaved,
  onClosed,
}: {
  diary: DaySpaceDiaryPrototype;
  open: boolean;
  triggerRef: RefObject<HTMLElement | null>;
  onSaved(next: DaySpaceDiaryPrototype): void;
  onClosed(): void;
}) {
  const [title, setTitle] = useState(diary.title);
  const [content, setContent] = useState(diary.content);

  useEffect(() => {
    if (!open) return;
    setTitle(diary.title);
    setContent(diary.content);
  }, [diary.content, diary.id, diary.title, open]);

  const dirty = title !== diary.title || content !== diary.content;
  const invalid = !title.trim() || !content.trim();

  return (
    <PaperDetailDialog
      id={`diary-day-space-${diary.id}`}
      open={open}
      label={`Diary ${formatDaySpaceDateLabel(diary.date)}`}
      dateLabel={formatDaySpaceDateLabel(diary.date)}
      signature={diary.author}
      triggerRef={triggerRef}
      onRequestClose={() => {
        if (
          dirty &&
          typeof window !== "undefined" &&
          !window.confirm("放弃未保存的修改？")
        ) {
          return false;
        }
        onClosed();
        return true;
      }}
      topRight={
        <>
          <button
            className="memory-paper-control"
            type="button"
            onClick={onClosed}
          >
            取消
          </button>
          <span>·</span>
          <button
            className="memory-paper-control"
            type="button"
            disabled={!dirty || invalid}
            onClick={() => {
              if (invalid) return;
              onSaved({
                ...diary,
                title: title.trim(),
                content: content.trim(),
              });
              onClosed();
            }}
          >
            保存
          </button>
        </>
      }
    >
      <DiaryPaperEditor
        title={title}
        content={content}
        disabled={false}
        onTitleChange={setTitle}
        onContentChange={setContent}
      />
    </PaperDetailDialog>
  );
}
