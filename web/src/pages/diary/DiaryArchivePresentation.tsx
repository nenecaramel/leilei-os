import type { ReactNode, RefObject } from "react";
import type { WebApiClient } from "../../api/useWebApiClient";
import { DiaryCommentsSection, type DiaryComment, type DiaryCommentsMetadata } from "../DiaryComments";
import { PaperDetailDialog } from "../PaperDetailDialog";
import { PaperAuthorSignature } from "../PaperAuthorSignature";
import { formatDiaryPaperDate, formatDiaryRowMeta } from "../diary-presentation";
import type { DiaryEntry, DetailState, LoadState } from "./diary-page-types";
import { ModuleStateMessage } from "../../components/ModuleSearch";
import { MobileDiaryLoading, MobileDiaryRows } from "./DiaryListPresentation";

export function MobileArchivedDiaryList({
  state,
  onBack,
  onOpen,
  onRetry,
}: {
  state: LoadState;
  onBack(): void;
  onOpen(id: string, trigger: HTMLElement): void;
  onRetry(): void;
}) {
  const count = state.status === "ready" ? state.count : 0;

  let body: ReactNode;
  if (state.status === "loading") {
    body = <MobileDiaryLoading label="已归档 Diary 加载中" />;
  } else if (state.status === "error") {
    body = (
      <ModuleStateMessage
        state="error"
        placement="page"
        emptyText=""
        errorText="Unable to read archived diary entries."
        retryLabel="Retry"
        onRetry={onRetry}
      />
    );
  } else if (state.diaries.length === 0) {
    body = (
      <section className="memory-empty-state">
        <p>还没有归档日记</p>
      </section>
    );
  } else {
    body = (
      <MobileDiaryRows
        diaries={state.diaries}
        busy={false}
        label="已归档 Diary 列表"
        onOpen={onOpen}
      />
    );
  }

  return (
    <>
      <header className="memory-page-header memory-archive-header diary-archive-header">
        <div className="memory-page-heading">
          <div className="memory-page-title">Archive</div>
          <div className="memory-page-count">{count}篇日记</div>
        </div>
        <button
          type="button"
          className="memory-archive-back"
          onClick={onBack}
        >
          Return
        </button>
      </header>
      {body}
    </>
  );
}

export function MobileArchivedDiaryDetail({
  api,
  state,
  diary,
  triggerRef,
  errorMessage,
  restoring,
  onRestore,
  confirmingDelete,
  deleting,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onRetry,
  onBack,
  onCommentsChange,
}: {
  api: WebApiClient;
  state: DetailState;
  diary: DiaryEntry | null;
  triggerRef: RefObject<HTMLElement | null>;
  errorMessage: string | null;
  restoring: boolean;
  onRestore(id: string): void;
  confirmingDelete: boolean;
  deleting: boolean;
  onRequestDelete(id: string): void;
  onConfirmDelete(id: string): void;
  onCancelDelete(): void;
  onRetry(): void;
  onBack(): void;
  onCommentsChange(
    comments: DiaryComment[],
    metadata: DiaryCommentsMetadata,
  ): void;
}) {
  if (state === "loading") {
    return (
      <PaperDetailDialog
        id="diary-archive-detail-paper"
        open
        label="Reading archived Diary"
        dateLabel=""
        signature="—"
        triggerRef={triggerRef}
        onRequestClose={() => {
          if (restoring) return false;
          onBack();
          return true;
        }}
      >
        <div className="paper-detail-state paper-detail-state--loading" role="status" aria-live="polite"><p>Reading...</p></div>
      </PaperDetailDialog>
    );
  }

  if (state === "error" || !diary) {
    return (
      <PaperDetailDialog
        id="diary-archive-detail-paper"
        open
        label="无法读取已归档 Diary"
        dateLabel=""
        signature="—"
        triggerRef={triggerRef}
        onRequestClose={() => {
          onBack();
          return true;
        }}
      >
        <div className="paper-detail-state" role="alert">
          <p>无法读取归档日记</p>
          <span>该归档日记不存在、无权访问或暂时不可用。</span>
          <button type="button" className="memory-paper-control" onClick={onRetry}>重试</button>
        </div>
      </PaperDetailDialog>
    );
  }

  return (
    <PaperDetailDialog
      id="diary-archive-detail-paper"
      open
      label={`已归档 Diary ${diary.title}`}
      dateLabel={formatDiaryPaperDate(diary.date)}
      signature=""
      triggerRef={triggerRef}
      errorMessage={errorMessage}
      onRequestClose={() => {
        if (restoring || deleting) return false;
        onBack();
        return true;
      }}
      topRight={
        confirmingDelete ? (
          <>
            <button className="memory-paper-control" disabled={deleting} onClick={onCancelDelete}>取消</button>
            <span>·</span>
            <button className="memory-paper-control" disabled={deleting} onClick={() => onConfirmDelete(diary.id)}>{deleting ? "删除中…" : "确认永久删除"}</button>
          </>
        ) : (
          <>
            <button className="memory-paper-control" disabled={restoring || deleting} onClick={() => onRestore(diary.id)}>{restoring ? "恢复中…" : "恢复"}</button>
            <span>·</span>
            <button className="memory-paper-control" disabled={restoring || deleting} onClick={() => onRequestDelete(diary.id)}>删除</button>
          </>
        )
      }
      bottomLeft={
        <>
          <span>{formatDiaryRowMeta(diary)}</span>
          <PaperAuthorSignature value={diary.author} editable={false} />
        </>
      }
    >
      <h2 className="memory-paper-title">{diary.title}</h2>
      <p className="memory-paper-content">{diary.content}</p>
      <DiaryCommentsSection
        api={api}
        diaryId={diary.id}
        comments={diary.comments ?? []}
        metadata={diary.comments_metadata ?? {
          count: diary.comments?.length ?? 0,
          returned: diary.comments?.length ?? 0,
          truncated: false,
        }}
        readOnly
        disabled={restoring || deleting}
        onChange={onCommentsChange}
      />
    </PaperDetailDialog>
  );
}
