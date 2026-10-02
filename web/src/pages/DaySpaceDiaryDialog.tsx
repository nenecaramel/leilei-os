import { useEffect, useRef, useState, type RefObject } from "react";
import { WebApiError } from "../api/web-api-error.js";
import { DiaryPaperEditor } from "./DiaryPaperEditor..js";
import { PaperAuthorSignature, type PaperAuthorValue } from "./PaperAuthorSignature..js";
import { PaperDetailDialog } from "./PaperDetailDialog..js";
import { formatDaySpaceDateLabel } from "./day-space-location.js";
import type { DaySpaceApi, DaySpaceDiary } from "./day-space-api.js";

export function DaySpaceDiaryDialog({
  diary,
  api,
  open,
  triggerRef,
  onSaved,
  onClosed,
}: {
  diary: DaySpaceDiary;
  api: DaySpaceApi;
  open: boolean;
  triggerRef: RefObject<HTMLElement | null>;
  onSaved(next: DaySpaceDiary): void;
  onClosed(): void;
}) {
  const [title, setTitle] = useState(diary.title);
  const [content, setContent] = useState(diary.content);
  const [author, setAuthor] = useState<PaperAuthorValue>(diary.author);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveRef = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(diary.title);
    setContent(diary.content);
    setAuthor(diary.author);
    setError(null);
    saveRef.current = null;
  }, [diary.content, diary.id, diary.title, diary.author, open]);

  const dirty = title !== diary.title || content !== diary.content || author !== diary.author;
  const invalid = !title.trim() || !content.trim() || !author;

  const save = async (): Promise<boolean> => {
    if (!dirty) { onClosed(); return true; }
    if (invalid || !author) { setError("请选择作者"); return false; }
    if (saveRef.current) return saveRef.current;
    setSaving(true);
    const request = api.updateDiary({
      id: diary.id,
      title: title.trim(),
      content: content.trim(),
      author,
      date: diary.date,
      tags: diary.tags,
      mood: diary.mood,
    }).then((next) => {
      onSaved(next);
      onClosed();
      return true;
    }).catch((cause: unknown) => {
      setError(cause instanceof WebApiError && cause.code === "AUTHOR_REQUIRED" ? "请选择作者" : "保存失败，请重试");
      return false;
    }).finally(() => { setSaving(false); saveRef.current = null; });
    saveRef.current = request;
    return request;
  };

  return (
    <PaperDetailDialog
      id={`diary-day-space-${diary.id}`}
      open={open}
      label={`Diary ${formatDaySpaceDateLabel(diary.date)}`}
      dateLabel={formatDaySpaceDateLabel(diary.date)}
      signature=""
      triggerRef={triggerRef}
      errorMessage={error}
      onRequestClose={async () => {
        if (!dirty) { onClosed(); return true; }
        if (typeof window !== "undefined" && !window.confirm("放弃未保存的修改？")) return false;
        onClosed();
        return true;
      }}
      topRight={
        <>
          <button className="memory-paper-control" type="button" disabled={saving} onClick={onClosed}>取消</button>
          <span>·</span>
          <button className="memory-paper-control" type="button" disabled={!dirty || invalid || saving} onClick={() => { void save(); }}>保存</button>
        </>
      }
    >
      <DiaryPaperEditor title={title} content={content} disabled={saving} onTitleChange={(value) => { setTitle(value); setError(null); }} onContentChange={(value) => { setContent(value); setError(null); }} />
      <PaperAuthorSignature value={author} editable={!saving} disabled={saving} onChange={(value) => { setAuthor(value); setError(null); }} />
    </PaperDetailDialog>
  );
}
