import { useLayoutEffect, useRef } from "react";
import { resizePaperTextarea } from "./paper-editor-autosize";

/** One transparent, auto-growing body editor for every prose paper. */
export function PaperBodyEditor({
  value,
  disabled,
  onChange,
  label,
  placeholder,
  onFocus,
  minimumHeight = 240,
}: {
  value: string;
  disabled: boolean;
  onChange(value: string): void;
  label: string;
  placeholder?: string;
  onFocus?: () => void;
  minimumHeight?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (ref.current) resizePaperTextarea(ref.current, minimumHeight);
  }, [value, minimumHeight]);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const resize = () => resizePaperTextarea(node, minimumHeight);
    let width = node.clientWidth;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (node.clientWidth === width) return;
            width = node.clientWidth;
            resize();
          });
    observer?.observe(node);
    window.addEventListener("resize", resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [minimumHeight]);
  return (
    <div className="paper-textarea-layout">
      <textarea
        ref={ref}
        className="memory-paper-content-editor diary-paper-content-editor paper-body-editor"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        rows={1}
        onFocus={onFocus}
        style={{ minHeight: minimumHeight }}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
