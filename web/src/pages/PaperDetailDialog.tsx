import React, {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

export type PaperDetailDialogProps = {
  id: string;
  open: boolean;
  label: string;
  dateLabel: string;
  signature: string;
  triggerRef: RefObject<HTMLElement | null>;
  onRequestClose: () => boolean | Promise<boolean>;
  children: ReactNode;
  errorMessage?: string | null;
};

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function PaperDetailDialog({
  id,
  open,
  label,
  dateLabel,
  signature,
  triggerRef,
  onRequestClose,
  children,
  errorMessage = null,
}: PaperDetailDialogProps) {
  const paperRef = useRef<HTMLElement | null>(null);
  const closingRef = useRef(false);

  const requestClose = useCallback(async () => {
    if (closingRef.current) return;

    closingRef.current = true;

    try {
      const mayClose = await onRequestClose();
      if (!mayClose) closingRef.current = false;
    } catch {
      closingRef.current = false;
    }
  }, [onRequestClose]);

  useEffect(() => {
    if (!open) return;

    closingRef.current = false;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTarget =
      paperRef.current?.querySelector<HTMLElement>("[data-paper-autofocus]") ??
      paperRef.current;
    focusTarget?.focus();

    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      void requestClose();
    };

    document.addEventListener("keydown", handleDocumentKeyDown);

    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown);
      document.body.style.overflow = previousOverflow;
      triggerRef.current?.focus();
    };
  }, [open, requestClose, triggerRef]);

  const handlePaperKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;

    const paper = paperRef.current;
    if (!paper) return;

    const focusable = [...paper.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
    if (focusable.length === 0) {
      event.preventDefault();
      paper.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || active === paper)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  return (
    <div className="paper-detail-layer" role="presentation">
      <button
        className="paper-detail-veil"
        type="button"
        aria-label="关闭纸张"
        onClick={() => {
          void requestClose();
        }}
      />
      <section
        id={id}
        className="paper-detail-paper"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        ref={paperRef}
        onKeyDown={handlePaperKeyDown}
      >
        <span className="paper-detail-date">{dateLabel}</span>
        <div className="paper-detail-scroll">
          <div className="paper-detail-rules" aria-hidden="true">
            {Array.from({ length: 24 }, (_, index) => (
              <span key={index} />
            ))}
          </div>
          <div className="paper-detail-body">{children}</div>
        </div>
        {errorMessage ? (
          <p className="paper-detail-error" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <span className="paper-detail-signature">{signature}</span>
      </section>
    </div>
  );
}
