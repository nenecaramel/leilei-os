import React, {
  useRef,
  useState,
} from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { Outlet } from "react-router-dom";
import { PwaStatus } from "../pwa/PwaStatus";
import { pwaStateStore } from "../pwa/pwa-runtime-state";
import { useWebApiClient } from "../api/useWebApiClient";
import { MobileNavigationDrawer } from "./MobileNavigationDrawer";
import { MobileTopBar } from "./MobileTopBar";
import { NavigationGroups } from "./NavigationGroups";
import { QuickSearchPanel } from "./QuickSearchPanel";
import { RouteScrollManager } from "./RouteScrollManager";

export { NAV_ITEMS } from "./NavigationGroups";

export function AppShell() {
  const { logout, user } = useAuth0();
  const api = useWebApiClient();

  const [mobileMenuOpen, setMobileMenuOpen] =
    useState(false);
  const [quickSearchOpen, setQuickSearchOpen] =
    useState(false);

  const menuButtonRef =
    useRef<HTMLButtonElement>(null);
  const searchButtonRef =
    useRef<HTMLButtonElement>(null);

  const displayName =
    user?.name ||
    user?.email ||
    "Leilei";

  const initials = displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

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
        <div className="sidebar-brand">
          <div className="brand-mark" aria-hidden="true">
            L
          </div>

          <div className="sidebar-brand-copy">
            <strong>Leilei OS</strong>
          </div>
        </div>

        <nav
          className="primary-nav"
          aria-label="Primary navigation"
        >
          <NavigationGroups />
        </nav>

        <div className="sidebar-footer">
          <div className="user-avatar">
            {initials}
          </div>

          <div className="user-copy">
            <strong>{displayName}</strong>
            <span>
              {user?.email || "Auth0 account"}
            </span>
          </div>

          <button
            className="text-button"
            onClick={() =>
              logout({
                logoutParams: {
                  returnTo:
                    window.location.origin,
                },
              })
            }
          >
            退出
          </button>
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
