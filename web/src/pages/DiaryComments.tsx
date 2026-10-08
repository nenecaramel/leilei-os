import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { WebApiError, type WebApiClient } from "../api/useWebApiClient";
import type { PaperAuthor } from "./PaperAuthorSignature";
import type { DiaryComment, DiaryCommentsMetadata } from "./diary/comments/diary-comment-types";
import { mergeComments, replaceComment } from "./diary/comments/diary-comment-transforms";
import { DiaryCommentComposer } from "./diary/comments/DiaryCommentComposer";
import { DiaryCommentRow } from "./diary/comments/DiaryCommentRows";

export type { DiaryComment, DiaryCommentsMetadata } from "./diary/comments/diary-comment-types";

type DiaryCommentListResponse = {
  success: true;
  data: {
    comments: DiaryComment[];
    metadata: {
      count: number;
      returned: number;
      has_more: boolean;
      next_before: string | null;
    };
  };
};

type DiaryCommentResponse = {
  success: true;
  data: DiaryComment;
};

type AddDiaryCommentResponse = {
  success: true;
  data: {
    comment: DiaryComment;
    metadata: {
      created: boolean;
      idempotent_replay: boolean;
    };
  };
};

function createIdempotencyKey(): string {
  return `web:diary-comment:${crypto.randomUUID()}`;
}

function resizeCommentTextarea(node: HTMLTextAreaElement | null): void {
  if (!node) return;
  node.style.height = "30px";
  node.style.height = `${Math.max(30, node.scrollHeight)}px`;
}

export function DiaryCommentsSection({
  api,
  diaryId,
  comments,
  metadata,
  readOnly,
  disabled = false,
  onChange,
}: {
  api: WebApiClient;
  diaryId: string;
  comments: readonly DiaryComment[];
  metadata: DiaryCommentsMetadata;
  readOnly: boolean;
  disabled?: boolean;
  onChange(
    comments: DiaryComment[],
    metadata: DiaryCommentsMetadata,
  ): void;
}) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerAuthor, setComposerAuthor] = useState<PaperAuthor>("L");
  const [composerContent, setComposerContent] = useState("");
  const [composerKey, setComposerKey] = useState<string | null>(null);
  const [savingCreate, setSavingCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [editingRevision, setEditingRevision] = useState<number | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(
    undefined,
  );
  const [error, setError] = useState("");
  const [conflictId, setConflictId] = useState<string | null>(null);

  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const editingTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const composerRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (composerOpen) resizeCommentTextarea(composerTextareaRef.current);
  }, [composerContent, composerOpen]);

  useLayoutEffect(() => {
    if (!composerOpen) return;
    const frame = window.requestAnimationFrame(() => {
      composerRef.current?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [composerOpen]);

  useLayoutEffect(() => {
    if (editingId) resizeCommentTextarea(editingTextareaRef.current);
  }, [editingContent, editingId]);

  const commentById = useMemo(
    () => new Map(comments.map((comment) => [comment.id, comment])),
    [comments],
  );

  if (readOnly && metadata.count === 0) return null;

  function updateState(
    nextComments: DiaryComment[],
    nextMetadata: DiaryCommentsMetadata,
  ) {
    onChange(nextComments, nextMetadata);
  }

  function beginComposer() {
    if (readOnly || disabled) return;
    setComposerOpen(true);
    setComposerAuthor("L");
    setComposerContent("");
    setComposerKey(createIdempotencyKey());
    setError("");
  }

  function cancelComposer() {
    if (savingCreate) return;
    setComposerOpen(false);
    setComposerAuthor("L");
    setComposerContent("");
    setComposerKey(null);
    setError("");
  }

  async function saveComposer() {
    const content = composerContent.trim();
    if (!content || !composerKey || savingCreate || readOnly || disabled) return;
    setSavingCreate(true);
    setError("");
    try {
      const response = await api.request<AddDiaryCommentResponse>(
        `/diary/${encodeURIComponent(diaryId)}/comments`,
        {
          method: "POST",
          body: JSON.stringify({
            author: composerAuthor,
            content,
            idempotency_key: composerKey,
          }),
        },
      );
      const nextComments = mergeComments(comments, [response.data.comment]);
      const wasAlreadyVisible = comments.some(
        (comment) => comment.id === response.data.comment.id,
      );
      updateState(nextComments, {
        count: metadata.count + (wasAlreadyVisible ? 0 : 1),
        returned: nextComments.length,
        truncated: metadata.truncated,
      });
      setComposerOpen(false);
      setComposerAuthor("L");
      setComposerContent("");
      setComposerKey(null);
    } catch {
      setError("评论保存失败，请稍后重试。");
    } finally {
      setSavingCreate(false);
    }
  }

  function beginEdit(comment: DiaryComment) {
    if (readOnly || disabled) return;
    setEditingId(comment.id);
    setEditingContent(comment.content);
    setEditingRevision(comment.revision);
    setDeleteConfirmId(null);
    setOpenMenuId(null);
    setConflictId(null);
    setError("");
  }

  function cancelEdit() {
    if (savingEdit) return;
    setEditingId(null);
    setEditingContent("");
    setEditingRevision(null);
    setConflictId(null);
    setError("");
  }

  async function readLatest(commentId: string): Promise<DiaryComment | null> {
    try {
      const response = await api.request<DiaryCommentResponse>(
        `/diary/${encodeURIComponent(diaryId)}/comments/${encodeURIComponent(commentId)}`,
      );
      updateState(replaceComment(comments, response.data), metadata);
      return response.data;
    } catch {
      setError("读取最新评论失败，请稍后重试。");
      return null;
    }
  }

  async function saveEdit() {
    const content = editingContent.trim();
    if (
      !editingId ||
      editingRevision == null ||
      !content ||
      savingEdit ||
      readOnly ||
      disabled
    ) return;
    setSavingEdit(true);
    setError("");
    try {
      const response = await api.request<DiaryCommentResponse>(
        `/diary/${encodeURIComponent(diaryId)}/comments/${encodeURIComponent(editingId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            expected_revision: editingRevision,
            content,
          }),
        },
      );
      updateState(replaceComment(comments, response.data), metadata);
      setEditingId(null);
      setEditingContent("");
      setEditingRevision(null);
      setConflictId(null);
    } catch (cause) {
      if (
        cause instanceof WebApiError &&
        cause.code === "COMMENT_REVISION_CONFLICT"
      ) {
        const currentId = editingId;
        const latest = await readLatest(currentId);
        if (latest) {
          setConflictId(currentId);
          setEditingRevision(editingRevision);
        }
      } else if (
        cause instanceof WebApiError &&
        cause.code === "DIARY_ARCHIVED"
      ) {
        setError("该 Diary 已归档，评论现在为只读。");
      } else {
        setError("评论保存失败，请稍后重试。");
      }
    } finally {
      setSavingEdit(false);
    }
  }

  async function loadConflictLatest() {
    if (!conflictId) return;
    const latest = commentById.get(conflictId) ?? await readLatest(conflictId);
    if (!latest) return;
    setEditingContent(latest.content);
    setEditingRevision(latest.revision);
    setConflictId(null);
    setError("");
  }

  async function deleteComment(comment: DiaryComment) {
    if (deletingId || readOnly || disabled) return;
    setDeletingId(comment.id);
    setError("");
    try {
      await api.request(
        `/diary/${encodeURIComponent(diaryId)}/comments/${encodeURIComponent(comment.id)}`,
        {
          method: "DELETE",
          body: JSON.stringify({ expected_revision: comment.revision }),
        },
      );
      const nextComments = comments.filter((item) => item.id !== comment.id);
      updateState(nextComments, {
        count: Math.max(0, metadata.count - 1),
        returned: nextComments.length,
        truncated: metadata.truncated,
      });
      setDeleteConfirmId(null);
      setOpenMenuId(null);
    } catch (cause) {
      if (
        cause instanceof WebApiError &&
        cause.code === "COMMENT_REVISION_CONFLICT"
      ) {
        await readLatest(comment.id);
        setDeleteConfirmId(null);
        setError("这条评论已经发生变化，请确认最新内容后再删除。");
      } else if (
        cause instanceof WebApiError &&
        cause.code === "DIARY_ARCHIVED"
      ) {
        setError("该 Diary 已归档，评论现在为只读。");
      } else {
        setError("评论删除失败，请稍后重试。");
      }
    } finally {
      setDeletingId(null);
    }
  }

  async function loadOlder() {
    if (!metadata.truncated || loadingOlder || disabled) return;
    setLoadingOlder(true);
    setError("");
    try {
      const query = new URLSearchParams({ limit: "100" });
      if (olderCursor) query.set("before", olderCursor);
      const response = await api.request<DiaryCommentListResponse>(
        `/diary/${readOnly ? "archived/" : ""}${encodeURIComponent(diaryId)}/comments?${query.toString()}`,
      );
      const nextComments = mergeComments(comments, response.data.comments);
      updateState(nextComments, {
        count: response.data.metadata.count,
        returned: nextComments.length,
        truncated: response.data.metadata.has_more,
      });
      setOlderCursor(response.data.metadata.next_before);
    } catch {
      setError("更早评论加载失败，请稍后重试。");
    } finally {
      setLoadingOlder(false);
    }
  }

  return (
    <section className="diary-comments" aria-label="Diary comments">
      {!readOnly ? (
        composerOpen ? (
          <DiaryCommentComposer
            content={composerContent}
            author={composerAuthor}
            saving={savingCreate}
            disabled={disabled}
            composerRef={composerRef}
            textareaRef={composerTextareaRef}
            onContentChange={(event) => {
              setComposerContent(event.target.value);
              setError("");
            }}
            onAuthorChange={setComposerAuthor}
            onCancel={cancelComposer}
            onSave={() => void saveComposer()}
          />
        ) : (
          <button
            type="button"
            className="diary-comment-create-trigger"
            disabled={disabled}
            onClick={beginComposer}
          >
            写一条评论…
          </button>
        )
      ) : null}

      {metadata.truncated ? (
        <button
          type="button"
          className="diary-comment-older memory-paper-control"
          disabled={loadingOlder || disabled}
          onClick={() => void loadOlder()}
        >
          {loadingOlder ? "加载中…" : "查看更早评论"}
        </button>
      ) : null}

      <div className="diary-comment-list">
        {comments.map((comment) => {
          const edited = comment.updated_at !== comment.created_at;
          const editing = editingId === comment.id;
          const confirmingDelete = deleteConfirmId === comment.id;
          const deleting = deletingId === comment.id;
          return (
            <DiaryCommentRow
              key={comment.id}
              comment={comment}
              edited={edited}
              editing={editing}
              confirmingDelete={confirmingDelete}
              deleting={deleting}
              menuOpen={openMenuId === comment.id}
              readOnly={readOnly}
              disabled={disabled}
              editingContent={editingContent}
              savingEdit={savingEdit}
              conflict={conflictId === comment.id}
              editingTextareaRef={editingTextareaRef}
              onCancelDelete={() => setDeleteConfirmId(null)}
              onConfirmDelete={() => void deleteComment(comment)}
              onBeginEdit={() => beginEdit(comment)}
              onBeginDelete={() => setDeleteConfirmId(comment.id)}
              onToggleMenu={() =>
                setOpenMenuId((current) =>
                  current === comment.id ? null : comment.id
                )
              }
              onCancelMenuDelete={() => {
                setDeleteConfirmId(null);
                setOpenMenuId(null);
              }}
              onEditingContentChange={(event) => {
                setEditingContent(event.target.value);
                setError("");
              }}
              onLoadConflictLatest={() => void loadConflictLatest()}
              onCancelEdit={cancelEdit}
              onSaveEdit={() => void saveEdit()}
            />
          );
        })}
      </div>



      {error ? (
        <p className="diary-comment-error" role="alert">{error}</p>
      ) : null}
    </section>
  );
}
