import type { RefObject } from "react";
import { DiaryPaperDateEditor, DiaryPaperEditor, DiaryPaperMetadataEditor, type DiaryPaperEditorHandle } from "../DiaryPaperEditor";
import { PaperDetailDialog } from "../PaperDetailDialog";
import { PaperAuthorSignature, type PaperAuthorValue } from "../PaperAuthorSignature";

type Props = {
  title: string; content: string; date: string; mood: string; tags: string;
  author: PaperAuthorValue; creating: boolean; createInvalid: boolean; actionError: string;
  createEditorRef: RefObject<DiaryPaperEditorHandle | null>;
  paperTriggerRef: RefObject<HTMLElement | null>;
  onClose(): boolean;
  onSave(): void;
  onDateChange(value: string): void;
  onMoodChange(value: string): void;
  onTagsChange(value: string): void;
  onAuthorChange(value: PaperAuthorValue): void;
  onTitleChange(value: string): void;
  onContentChange(value: string): void;
};

// Presentation only. Draft validation, discard decisions and saves belong to DiaryPage.
export function DiaryCreatePaper({ title, content, date, mood, tags, author, creating,
  createInvalid, actionError, createEditorRef, paperTriggerRef, onClose, onSave,
  onDateChange, onMoodChange, onTagsChange, onAuthorChange, onTitleChange, onContentChange,
}: Props) {
  return (
    <PaperDetailDialog
      id="diary-create-paper"
      open
      label="创建 Diary"
      dateLabel={
        <DiaryPaperDateEditor
          value={date}
          disabled={creating}
          onChange={onDateChange}
        />
      }
      signature=""
      triggerRef={paperTriggerRef}
      onRequestClose={onClose}
      topRight={
        <>
          <button
            className="memory-paper-control"
            disabled={creating}
            onClick={onClose}
          >
            取消
          </button>
          <span>·</span>
          <button
            className="memory-paper-control"
            disabled={creating || createInvalid}
            onClick={onSave}
          >
            {creating ? "保存中…" : "保存"}
          </button>
        </>
      }
      bottomLeft={
        <>
          <DiaryPaperMetadataEditor
            moodValue={mood}
            tagsValue={tags}
            disabled={creating}
            onMoodChange={onMoodChange}
            onTagsChange={onTagsChange}
          />
          <PaperAuthorSignature
            value={author}
            editable
            disabled={creating}
            onChange={onAuthorChange}
            error={author === null ? actionError : null}
          />
        </>
      }
      errorMessage={actionError || null}
    >
      <DiaryPaperEditor
        ref={createEditorRef}
        title={title}
        content={content}
        disabled={creating}
        onTitleChange={onTitleChange}
        onContentChange={onContentChange}
      />
    </PaperDetailDialog>
  );
}
