import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { formatDiaryPaperDate } from "./diary-presentation";

export type DiaryPaperEditorHandle = {
  focusTitle(): void;
};

type DiaryPaperEditorProps = {
  title: string;
  content: string;
  disabled: boolean;
  onTitleChange(value: string): void;
  onContentChange(value: string): void;
};

function resizeContent(node: HTMLTextAreaElement) {
  node.style.height = "auto";
  node.style.height = `${Math.max(240, node.scrollHeight)}px`;
}

export const DiaryPaperEditor = forwardRef<
  DiaryPaperEditorHandle,
  DiaryPaperEditorProps
>(function DiaryPaperEditor(
  {
    title,
    content,
    disabled,
    onTitleChange,
    onContentChange,
  },
  ref,
) {
  const titleRef = useRef<HTMLInputElement | null>(null);
  const contentRef = useRef<HTMLTextAreaElement | null>(null);

  useImperativeHandle(ref, () => ({
    focusTitle() {
      titleRef.current?.focus();
    },
  }), []);

  useEffect(() => {
    if (contentRef.current) resizeContent(contentRef.current);
  }, [content]);

  return (
    <div className="memory-paper-editor diary-paper-editor">
      <input
        ref={titleRef}
        className="memory-paper-key diary-paper-title-input"
        type="text"
        aria-label="日记标题"
        placeholder="标题"
        value={title}
        disabled={disabled}
        maxLength={200}
        autoComplete="off"
        onChange={(event) => onTitleChange(event.target.value)}
      />
      <textarea
        ref={contentRef}
        className="memory-paper-content-editor diary-paper-content-editor"
        aria-label="日记正文"
        placeholder="写下今天发生的事"
        value={content}
        disabled={disabled}
        rows={8}
        onChange={(event) => {
          resizeContent(event.currentTarget);
          onContentChange(event.target.value);
        }}
      />
    </div>
  );
});

export function DiaryPaperDateEditor({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange(value: string): void;
}) {
  return (
    <label className="diary-paper-date-editor">
      <span>{formatDiaryPaperDate(value)}</span>
      <input
        type="date"
        aria-label="日记日期"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function DiaryPaperMetadataEditor({
  moodValue,
  tagsValue,
  disabled,
  onMoodChange,
  onTagsChange,
}: {
  moodValue: string;
  tagsValue: string;
  disabled: boolean;
  onMoodChange(value: string): void;
  onTagsChange(value: string): void;
}) {
  return (
    <div className="diary-paper-metadata">
      <input
        type="text"
        className="diary-paper-mood"
        aria-label="日记心情"
        placeholder="心情"
        value={moodValue}
        disabled={disabled}
        maxLength={50}
        autoComplete="off"
        onChange={(event) => onMoodChange(event.target.value)}
      />
      <span className="diary-paper-metadata-separator" aria-hidden="true">·</span>
      <input
        type="text"
        className="diary-paper-tags"
        aria-label="日记标签"
        placeholder="标签"
        value={tagsValue}
        disabled={disabled}
        autoComplete="off"
        onChange={(event) => onTagsChange(event.target.value)}
      />
    </div>
  );
}
