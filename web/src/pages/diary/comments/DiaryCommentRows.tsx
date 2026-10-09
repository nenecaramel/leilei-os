import type { ChangeEventHandler, Ref } from "react";
import type { DiaryComment } from "./diary-comment-types";
import { formatCommentTime } from "./diary-comment-transforms";

type DiaryCommentRowProps = {
  comment: DiaryComment;
  edited: boolean;
  editing: boolean;
  confirmingDelete: boolean;
  deleting: boolean;
  menuOpen: boolean;
  readOnly: boolean;
  disabled: boolean;
  editingContent: string;
  savingEdit: boolean;
  conflict: boolean;
  editingTextareaRef: Ref<HTMLTextAreaElement>;
  onCancelDelete(): void;
  onConfirmDelete(): void;
  onBeginEdit(): void;
  onBeginDelete(): void;
  onToggleMenu(): void;
  onCancelMenuDelete(): void;
  onEditingContentChange: ChangeEventHandler<HTMLTextAreaElement>;
  onLoadConflictLatest(): void;
  onCancelEdit(): void;
  onSaveEdit(): void;
};

export function DiaryCommentRow({
  comment, edited, editing, confirmingDelete, deleting, menuOpen,
  readOnly, disabled, editingContent, savingEdit, conflict, editingTextareaRef,
  onCancelDelete, onConfirmDelete, onBeginEdit, onBeginDelete, onToggleMenu,
  onCancelMenuDelete, onEditingContentChange, onLoadConflictLatest, onCancelEdit, onSaveEdit,
}: DiaryCommentRowProps) {
  return (
    <article
      className="diary-comment"
      data-comment-id={comment.id}
    >
      <div className="diary-comment-meta">
        <span>
          {comment.author} · {formatCommentTime(comment.created_at)}
          {edited ? " · 已编辑" : ""}
        </span>
        {!readOnly && !editing ? (
          <>
            <span className="diary-comment-desktop-actions">
              {confirmingDelete ? (
                <>
                  <button
                    type="button"
                    className="memory-paper-control"
                    disabled={deleting || disabled}
                    onClick={onCancelDelete}
                  >
                    取消
                  </button>
                  <span>·</span>
                  <button
                    type="button"
                    className="memory-paper-control"
                    disabled={deleting || disabled}
                    onClick={onConfirmDelete}
                  >
                    {deleting ? "删除中…" : "确认删除"}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="memory-paper-control"
                    disabled={disabled}
                    onClick={onBeginEdit}
                  >
                    编辑
                  </button>
                  <span>·</span>
                  <button
                    type="button"
                    className="memory-paper-control"
                    disabled={disabled}
                    onClick={onBeginDelete}
                  >
                    删除
                  </button>
                </>
              )}
            </span>
            <span className="diary-comment-mobile-menu">
              <button
                type="button"
                className="diary-comment-menu-trigger memory-paper-control"
                aria-label="评论操作"
                aria-expanded={menuOpen}
                disabled={disabled}
                onClick={onToggleMenu
                }
              >
                ···
              </button>
              {menuOpen ? (
                <span className="diary-comment-menu-popover">
                  {confirmingDelete ? (
                    <>
                      <button
                        type="button"
                        disabled={deleting || disabled}
                        onClick={onCancelMenuDelete}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        disabled={deleting || disabled}
                        onClick={onConfirmDelete}
                      >
                        {deleting ? "删除中…" : "确认删除"}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={onBeginEdit}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={onBeginDelete}
                      >
                        删除
                      </button>
                    </>
                  )}
                </span>
              ) : null}
            </span>
          </>
        ) : null}
      </div>

      {editing ? (
        <div className="diary-comment-editor">
          <textarea
            ref={editingTextareaRef}
            aria-label="编辑评论"
            value={editingContent}
            disabled={savingEdit || disabled}
            rows={1}
            onChange={onEditingContentChange}
          />
          {conflict ? (
            <div className="diary-comment-conflict" role="alert">
              <span>这条评论已经发生变化。</span>
              <button
                type="button"
                className="memory-paper-control"
                onClick={onLoadConflictLatest}
              >
                载入最新
              </button>
            </div>
          ) : null}
          <div className="diary-comment-edit-actions">
            <button
              type="button"
              className="memory-paper-control"
              disabled={savingEdit}
              onClick={onCancelEdit}
            >
              取消
            </button>
            <span>·</span>
            <button
              type="button"
              className="memory-paper-control"
              disabled={
                savingEdit ||
                disabled ||
                !editingContent.trim() ||
                conflict
              }
              onClick={onSaveEdit}
            >
              {savingEdit ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      ) : (
        <p className="diary-comment-content">{comment.content}</p>
      )}
    </article>
  );
}
