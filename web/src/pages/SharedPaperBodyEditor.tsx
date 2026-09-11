import { useLayoutEffect, useRef } from "react";
import { resizePaperTextarea } from "./paper-editor-autosize";

export function SharedPaperBodyEditor({
  content,
  disabled = false,
  placeholder,
  onContentChange,
}: {
  content: string;
  disabled?: boolean;
  placeholder?: string;
  onContentChange(value: string): void;
}) {
  const contentRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    if (contentRef.current) resizePaperTextarea(contentRef.current);
  }, [content]);

  return (
    <textarea
      ref={contentRef}
      className="memory-paper-content-editor shared-paper-content-editor"
      aria-label="Shared Paper 正文"
      placeholder={placeholder}
      value={content}
      disabled={disabled}
      rows={8}
      onChange={(event) => onContentChange(event.target.value)}
    />
  );
}
