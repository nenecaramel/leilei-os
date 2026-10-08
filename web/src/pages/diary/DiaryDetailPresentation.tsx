import type { RefObject } from "react";
import type { WebApiClient } from "../../api/useWebApiClient";
import { DiaryCommentsSection, type DiaryComment, type DiaryCommentsMetadata } from "../DiaryComments";
import { PaperDetailDialog } from "../PaperDetailDialog";
import { PaperAuthorSignature, type PaperAuthorValue } from "../PaperAuthorSignature";
import { formatDiaryPaperDate, formatDiaryRowMeta } from "../diary-presentation";
import type { DiaryEntry, DetailState } from "./diary-page-types";
import { DiaryPaperDateEditor, DiaryPaperEditor, DiaryPaperMetadataEditor } from "../DiaryPaperEditor";

export function MobileDiaryDetail({
  api,
  state,
  diary,
  triggerRef,
  errorMessage,
  editing,
  updating,
  archiving,
  author,
  onAuthorChange,
  values,
  setValues,
  invalid,
  onEdit,
  onCancel,
  onSave,
  onArchive,
  onRetry,
  onRequestClose,
  onCommentsChange,
}: {
  api: WebApiClient;
  state: DetailState;
  diary: DiaryEntry | null;
  triggerRef: RefObject<HTMLElement | null>;
  errorMessage: string | null;
  editing: boolean;
  updating: boolean;
  archiving: boolean;
  author: PaperAuthorValue;
  onAuthorChange(value: Exclude<PaperAuthorValue, null>): void;
  values: Record<"title" | "content" | "date" | "tags" | "mood", string>;
  setValues: Record<
    "title" | "content" | "date" | "tags" | "mood",
    (value: string) => void
  >;
  invalid: boolean;
  onEdit(diary: DiaryEntry): void;
  onCancel(): void;
  onSave(): void;
  onArchive(id: string): void;
  onRetry(): void;
  onRequestClose(): boolean;
  onCommentsChange(
    comments: DiaryComment[],
    metadata: DiaryCommentsMetadata,
  ): void;
}) {
  if (state === "loading") {
    return (
      <PaperDetailDialog
        id="diary-detail-paper"
        open
        label="Reading Diary"
        dateLabel=""
        signature="—"
        triggerRef={triggerRef}
        onRequestClose={onRequestClose}
      >
        <div className="paper-detail-state paper-detail-state--loading" role="status" aria-live="polite"><p>Reading...</p></div>
      </PaperDetailDialog>
    );
  }

  if (state === "error" || !diary) {
    return (
      <PaperDetailDialog
        id="diary-detail-paper"
        open
        label="无法读取 Diary"
        dateLabel=""
        signature="—"
        triggerRef={triggerRef}
        onRequestClose={onRequestClose}
      >
        <div className="paper-detail-state" role="alert">
          <p>无法读取日记</p>
          <span>该日记不存在、无权访问或暂时不可用。</span>
          <button type="button" className="memory-paper-control" onClick={onRetry}>重试</button>
        </div>
      </PaperDetailDialog>
    );
  }

  return (
    <PaperDetailDialog
      id="diary-detail-paper"
      open
      label={`Diary ${diary.title}`}
      dateLabel={
        editing ? (
          <DiaryPaperDateEditor
            value={values.date}
            disabled={updating}
            onChange={setValues.date}
          />
        ) : formatDiaryPaperDate(diary.date)
      }
      signature=""
      triggerRef={triggerRef}
      errorMessage={errorMessage}
      onRequestClose={onRequestClose}
      topRight={
        editing ? (
          <>
            <button
              className="memory-paper-control"
              disabled={updating}
              onClick={onCancel}
            >
              取消
            </button>
            <span>·</span>
            <button
              className="memory-paper-control"
              disabled={updating || invalid}
              onClick={onSave}
            >
              {updating ? "保存中…" : "保存"}
            </button>
          </>
        ) : (
          <>
            <button
              className="memory-paper-control"
              disabled={archiving}
              onClick={() => {
                if (window.confirm(`确定归档“${diary.title}”吗？`)) {
                  onArchive(diary.id);
                }
              }}
            >
              {archiving ? "归档中…" : "归档"}
            </button>
            <span>·</span>
            <button
              className="memory-paper-control"
              disabled={archiving}
              onClick={() => onEdit(diary)}
            >
              编辑
            </button>
          </>
        )
      }
      bottomLeft={
        editing ? (
          <>
            <DiaryPaperMetadataEditor
              moodValue={values.mood}
              tagsValue={values.tags}
              disabled={updating}
              onMoodChange={setValues.mood}
              onTagsChange={setValues.tags}
            />
            <PaperAuthorSignature
              value={author}
              editable
              disabled={updating}
              onChange={onAuthorChange}
              error={author == null ? "请选择作者" : null}
            />
          </>
        ) : (
          <>
            <span>{formatDiaryRowMeta(diary)}</span>
            <PaperAuthorSignature value={diary.author} editable={false} />
          </>
        )
      }
    >
      {editing ? (
        <DiaryPaperEditor
          title={values.title}
          content={values.content}
          disabled={updating}
          onTitleChange={setValues.title}
          onContentChange={setValues.content}
        />
      ) : (
        <>
          <h2 className="memory-paper-title">{diary.title}</h2>
          <p className="memory-paper-content">{diary.content}</p>
        </>
      )}
      {!editing ? (
        <DiaryCommentsSection
          api={api}
          diaryId={diary.id}
          comments={diary.comments ?? []}
          metadata={diary.comments_metadata ?? {
            count: diary.comments?.length ?? 0,
            returned: diary.comments?.length ?? 0,
            truncated: false,
          }}
          readOnly={false}
          disabled={updating || archiving}
          onChange={onCommentsChange}
        />
      ) : null}
    </PaperDetailDialog>
  );
}
