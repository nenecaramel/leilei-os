import { useEffect, useRef, type ReactNode, type RefObject } from "react";

export type UniverseFloatingPopoverProps = {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  className?: string;
  ariaLabel: string;
  onRequestClose(): void;
  children: ReactNode;
};

/** Small non-modal menu used by the mobile ready-state Universe chrome. */
export function UniverseFloatingPopover({
  open,
  anchorRef,
  className,
  ariaLabel,
  onRequestClose,
  children,
}: UniverseFloatingPopoverProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let ignoreMouseUntil = 0;
    let ignorePointerUntil = 0;
    const handleOutside = (event: MouseEvent | PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (rootRef.current?.contains(target) || anchorRef.current?.contains(target))) return;
      onRequestClose();
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (Date.now() < ignorePointerUntil) return;
      ignoreMouseUntil = Date.now() + 50;
      handleOutside(event);
    };
    const handleMouseDown = (event: MouseEvent) => {
      if (Date.now() < ignoreMouseUntil) return;
      ignorePointerUntil = Date.now() + 50;
      handleOutside(event);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onRequestClose();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchorRef, onRequestClose, open]);

  if (!open) return null;
  return (
    <div ref={rootRef} className={`universe-floating-popover${className ? ` ${className}` : ""}`} role="menu" aria-label={ariaLabel}>
      {children}
    </div>
  );
}
