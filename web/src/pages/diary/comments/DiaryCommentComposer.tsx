import type { ChangeEventHandler, Ref } from "react";
import { PaperAuthorSignature, type PaperAuthor } from "../../PaperAuthorSignature";

type DiaryCommentComposerProps = {
  content: string;
  author: PaperAuthor;
  saving: boolean;
  disabled: boolean;
  composerRef: Ref<HTMLDivElement>;
  textareaRef: Ref<HTMLTextAreaElement>;
  onContentChange: ChangeEventHandler<HTMLTextAreaElement>;
  onAuthorChange(author: PaperAuthor): void;
  onCancel(): void;
  onSave(): void;
};

export function DiaryCommentComposer({
  content, author, saving, disabled, composerRef, textareaRef,
  onContentChange, onAuthorChange, onCancel, onSave,
}: DiaryCommentComposerProps) {
  return (
    <div className="diary-comment-composer" ref={composerRef}>
      <textarea
        ref={textareaRef}
        aria-label="写一条评论"
        placeholder="写一条评论…"
        value={content}
        disabled={saving || disabled}
        rows={1}
        onChange={onContentChange}
      />
      <div className="diary-comment-composer-actions">
        <PaperAuthorSignature
          value={author}
          editable
          placement="inline"
          disabled={saving || disabled}
          onChange={onAuthorChange}
        />
        <span className="diary-comment-composer-buttons">
          <button
            type="button"
            className="memory-paper-control"
            disabled={saving}
            onClick={onCancel}
          >
            取消
          </button>
          <span>·</span>
          <button
            type="button"
            className="memory-paper-control"
            disabled={
              saving ||
              disabled ||
              !content.trim()
            }
            onClick={onSave}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </span>
      </div>
    </div>
  );
}
