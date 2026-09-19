import {
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
  dateLabel: ReactNode;
  signature: string;
  triggerRef: RefObject<HTMLElement | null>;
  onRequestClose: () => boolean | Promise<boolean>;
  children: ReactNode;
  errorMessage?: string | null;
  topRight?: ReactNode;
  bottomLeft?: ReactNode;
  showRules?: boolean;
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
  topRight = null,
  bottomLeft = null,
  showRules = true,
}: PaperDetailDialogProps) {
  const paperRef = useRef<HTMLElement | null>(null);
  const closingRef = useRef(false);
  const onRequestCloseRef = useRef(onRequestClose);
  const visibleErrorMessage = errorMessage === "请选择作者" ? null : errorMessage;

  useEffect(() => {
    onRequestCloseRef.current = onRequestClose;
  }, [onRequestClose]);

  const requestClose = useCallback(async () => {
    if (closingRef.current) return;

    closingRef.current = true;

    try {
      const mayClose = await onRequestCloseRef.current();
      if (!mayClose) closingRef.current = false;
    } catch {
      closingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!open) return;

    closingRef.current = false;

    const body = document.body;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const previousBodyStyle = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    };

    // iOS Safari can move the document/visual viewport when a low paper input
    // receives focus even while overflow is hidden. Freeze the background at
    // its exact scroll position for the lifetime of the paper dialog.
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = `-${scrollX}px`;
    body.style.right = "0";
    body.style.width = "100%";

    paperRef.current?.focus({ preventScroll: true });

    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      void requestClose();
    };

    document.addEventListener("keydown", handleDocumentKeyDown);

    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown);
      body.style.overflow = previousBodyStyle.overflow;
      body.style.position = previousBodyStyle.position;
      body.style.top = previousBodyStyle.top;
      body.style.left = previousBodyStyle.left;
      body.style.right = previousBodyStyle.right;
      body.style.width = previousBodyStyle.width;
      if (window.scrollX !== scrollX || window.scrollY !== scrollY) {
        window.scrollTo(scrollX, scrollY);
      }
      triggerRef.current?.focus({ preventScroll: true });
    };
  }, [open, requestClose, triggerRef]);

  const handlePaperKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;

    const paper = paperRef.current;
    if (!paper) return;

    const focusable = [...paper.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
    if (focusable.length === 0) {
      event.preventDefault();
      paper.focus({ preventScroll: true });
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || active === paper)) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
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
        {topRight ? (
          <div className="paper-detail-top-right">{topRight}</div>
        ) : null}
        <div className="paper-detail-scroll">
          <div
            className={
              showRules
                ? "paper-detail-body paper-detail-body--ruled"
                : "paper-detail-body"
            }
          >
            {children}
          </div>
        </div>
        {bottomLeft ? (
          <div className="paper-detail-bottom-left">{bottomLeft}</div>
        ) : null}
        {visibleErrorMessage ? (
          <p className="paper-detail-error" role="alert">
            {visibleErrorMessage}
          </p>
        ) : null}
        <span className="paper-detail-signature">
          {signature ? (
            <span className="paper-detail-signature-fallback">{signature}</span>
          ) : null}
          <span className="paper-detail-signature-portal" />
        </span>
      </section>
    </div>
  );
}
