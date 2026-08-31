import React, { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { NavigationPanel } from "./NavigationPanel";

export function MobileNavigationDrawer({
  open,
  onClose,
  menuButtonRef,
}: {
  open: boolean;
  onClose: () => void;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  const drawerPanelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const frameWindow = window;
    const focusFrame = frameWindow.requestAnimationFrame(() => drawerPanelRef.current?.focus());
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
      <aside ref={drawerPanelRef} className="mobile-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="mobile-drawer-title" tabIndex={-1}>
        <NavigationPanel
          titleId="mobile-drawer-title"
          navigationLabel="Mobile navigation"
          headerClassName="mobile-drawer-header"
          onNavigate={onClose}
        />
      </aside>
    </div>
  );
}
