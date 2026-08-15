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
    const handlePointerDown = (event: MouseEvent | PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (rootRef.current?.contains(target) || anchorRef.current?.contains(target))) return;
      onRequestClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onRequestClose();
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchorRef, onRequestClose, open]);

  if (!open) return null;
  return (
    <div ref={rootRef} className={className ?? "universe-floating-popover"} role="menu" aria-label={ariaLabel}>
      {children}
    </div>
  );
}
