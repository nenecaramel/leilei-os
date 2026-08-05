import React, { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { NavigationGroups } from "./NavigationGroups";

export function MobileNavigationDrawer({
  open,
  onClose,
  menuButtonRef,
}: {
  open: boolean;
  onClose: () => void;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const frameWindow = window;
    const focusFrame = frameWindow.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      frameWindow.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      menuButtonRef.current?.focus();
    };
  }, [menuButtonRef, onClose, open]);

  if (!open) return null;
  return (
    <div className="mobile-drawer" id="mobile-navigation-drawer">
      <button className="mobile-drawer-backdrop" type="button" aria-label="关闭菜单" onClick={onClose} />
      <aside className="mobile-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="mobile-drawer-title">
        <div className="mobile-drawer-header">
          <strong id="mobile-drawer-title">Leilei OS</strong>
          <button ref={closeButtonRef} className="icon-button" type="button" aria-label="关闭菜单" onClick={onClose}>×</button>
        </div>
        <nav aria-label="Mobile navigation">
          <NavigationGroups onNavigate={onClose} />
        </nav>
      </aside>
    </div>
  );
}
