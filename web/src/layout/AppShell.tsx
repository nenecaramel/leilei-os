import React, {
  useRef,
  useState,
} from "react";
import { Outlet } from "react-router-dom";
import { PwaStatus } from "../pwa/PwaStatus";
import { pwaStateStore } from "../pwa/pwa-runtime-state";
import { useWebApiClient } from "../api/useWebApiClient";
import { MobileNavigationDrawer } from "./MobileNavigationDrawer";
import { MobileTopBar } from "./MobileTopBar";
import { NavigationPanel } from "./NavigationPanel";
import { QuickSearchPanel } from "./QuickSearchPanel";
import { RouteScrollManager } from "./RouteScrollManager";

export { NAV_ITEMS } from "./NavigationGroups";

export function AppShell() {
  const api = useWebApiClient();

  const [mobileMenuOpen, setMobileMenuOpen] =
    useState(false);
  const [quickSearchOpen, setQuickSearchOpen] =
    useState(false);

  const menuButtonRef =
    useRef<HTMLButtonElement>(null);
  const searchButtonRef =
    useRef<HTMLButtonElement>(null);

  return (
    <div className="app-shell">
      <PwaStatus store={pwaStateStore} />
      <RouteScrollManager />

      <MobileTopBar
        menuOpen={mobileMenuOpen}
        menuButtonRef={menuButtonRef}
        onMenuClick={() => {
          setQuickSearchOpen(false);
          setMobileMenuOpen(
            (open) => !open,
          );
        }}
        searchOpen={quickSearchOpen}
        searchButtonRef={searchButtonRef}
        onSearchClick={() => {
          setMobileMenuOpen(false);
          setQuickSearchOpen(
            (open) => !open,
          );
        }}
      />

      <QuickSearchPanel
        open={quickSearchOpen}
        api={api}
        triggerRef={searchButtonRef}
        onClose={() =>
          setQuickSearchOpen(false)
        }
      />

      <MobileNavigationDrawer
        open={mobileMenuOpen}
        menuButtonRef={menuButtonRef}
        onClose={() =>
          setMobileMenuOpen(false)
        }
      />

      <aside className="sidebar">
        <NavigationPanel navClassName="primary-nav" />
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
