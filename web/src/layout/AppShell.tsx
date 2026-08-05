import React, { useRef, useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { Outlet } from "react-router-dom";
import { useSettings } from "../settings/SettingsProvider";
import { MobileNavigationDrawer } from "./MobileNavigationDrawer";
import { MobileTopBar } from "./MobileTopBar";
import { NavigationGroups } from "./NavigationGroups";
import { RouteScrollManager } from "./RouteScrollManager";

export { NAV_ITEMS } from "./NavigationGroups";

export function AppShell() {
  const { logout, user } = useAuth0();
  const { settings } = useSettings();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const displayName =
    settings.preferred_name ||
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
      <RouteScrollManager />
      <MobileTopBar
        menuOpen={mobileMenuOpen}
        menuButtonRef={menuButtonRef}
        onMenuClick={() => setMobileMenuOpen((open) => !open)}
      />
      <MobileNavigationDrawer
        open={mobileMenuOpen}
        menuButtonRef={menuButtonRef}
        onClose={() => setMobileMenuOpen(false)}
      />
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">L</div>

          <div>
            <strong>Leilei OS</strong>
            <span>Personal space</span>
          </div>
        </div>

        <nav className="primary-nav" aria-label="Primary navigation">
          <NavigationGroups />
        </nav>

        <div className="sidebar-footer">
          <div className="user-avatar">
            {initials}
          </div>

          <div className="user-copy">
            <strong>{displayName}</strong>
            <span>{user?.email || "Auth0 account"}</span>
          </div>

          <button
            className="text-button"
            onClick={() =>
              logout({
                logoutParams: {
                  returnTo: window.location.origin,
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
