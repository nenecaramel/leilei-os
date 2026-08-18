import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export type MemoryCategory = "profile" | "preference" | "goal" | "project";

const CATEGORY_OPTIONS: ReadonlyArray<{ value: MemoryCategory; label: string }> = [
  { value: "profile", label: "Profile" },
  { value: "preference", label: "Preference" },
  { value: "goal", label: "Goal" },
  { value: "project", label: "Project" },
];

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  profile: "Profile",
  preference: "Preference",
  goal: "Goal",
  project: "Project",
};

export type MemoryPaperEditorHandle = {
  focusKey(): void;
};

export type MemoryPaperEditorProps = {
  keyValue: string;
  content: string;
  disabled: boolean;
  onKeyChange(value: string): void;
  onContentChange(value: string): void;
};

function resizeContent(node: HTMLTextAreaElement) {
  node.style.height = "auto";
  node.style.height = `${Math.max(240, node.scrollHeight)}px`;
}

export const MemoryPaperEditor = forwardRef<
  MemoryPaperEditorHandle,
  MemoryPaperEditorProps
>(function MemoryPaperEditor(
  { keyValue, content, disabled, onKeyChange, onContentChange },
  ref,
) {
  const keyRef = useRef<HTMLInputElement | null>(null);
  const contentRef = useRef<HTMLTextAreaElement | null>(null);

  useImperativeHandle(ref, () => ({
    focusKey() {
      keyRef.current?.focus();
    },
  }), []);

  useEffect(() => {
    if (contentRef.current) resizeContent(contentRef.current);
  }, [content]);

  return (
    <div className="memory-paper-editor">
      <input
        ref={keyRef}
        className="memory-paper-key"
        type="text"
        aria-label="记忆 Key"
        placeholder="Key"
        value={keyValue}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onKeyChange(event.target.value)}
      />
      <textarea
        ref={contentRef}
        className="memory-paper-content-editor"
        aria-label="记忆内容"
        placeholder="Content"
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

export type MemoryPaperMetadataEditorProps = {
  category: MemoryCategory;
  tagsValue: string;
  disabled: boolean;
  onCategoryChange(value: MemoryCategory): void;
  onTagsChange(value: string): void;
};

export function MemoryPaperMetadataEditor({
  category,
  tagsValue,
  disabled,
  onCategoryChange,
  onTagsChange,
}: MemoryPaperMetadataEditorProps) {
  const [categoryOpen, setCategoryOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!categoryOpen) return;
    const closeOnOutsidePointer = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!rootRef.current?.contains(target)) setCategoryOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsidePointer);
    return () => document.removeEventListener("mousedown", closeOnOutsidePointer);
  }, [categoryOpen]);

  return (
    <div className="memory-paper-metadata" ref={rootRef}>
      <div className="memory-paper-category-wrap">
        <button
          type="button"
          className="memory-paper-category"
          aria-label="记忆分类"
          aria-haspopup="menu"
          aria-expanded={categoryOpen}
          disabled={disabled}
          onClick={() => setCategoryOpen((value) => !value)}
        >
          {CATEGORY_LABELS[category]}
        </button>
        {categoryOpen ? (
          <div className="memory-paper-category-menu" role="menu" aria-label="Memory 分类编辑">
            {CATEGORY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={category === option.value}
                onClick={() => {
                  onCategoryChange(option.value);
                  setCategoryOpen(false);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <span className="memory-paper-metadata-separator" aria-hidden="true">·</span>
      <input
        className="memory-paper-tags"
        type="text"
        aria-label="记忆标签"
        placeholder="tags"
        value={tagsValue}
        disabled={disabled}
        autoComplete="off"
        onChange={(event) => onTagsChange(event.target.value)}
      />
    </div>
  );
}
