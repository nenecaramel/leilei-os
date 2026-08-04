import { useAuth0 } from "@auth0/auth0-react";
import { NavLink, Outlet } from "react-router-dom";
import {
  ArchiveIcon,
  DashboardIcon,
  DiaryIcon,
  MemoryIcon,
  SettingsIcon,
  SearchIcon,
  TaskIcon,
  UniverseIcon,
} from "../components/icons";
import { useSettings } from "../settings/SettingsProvider";

const navigation = [
  { label: "Dashboard", to: "/", icon: DashboardIcon, end: true },
  { label: "Memory", to: "/memory", icon: MemoryIcon },
  { label: "Diary", to: "/diary", icon: DiaryIcon },
  { label: "Task", to: "/task", icon: TaskIcon },
  { label: "全局搜索", to: "/search", icon: SearchIcon },
  { label: "Settings", to: "/settings", icon: SettingsIcon },
  { label: "Chat Archive", to: "/chat-archive", icon: ArchiveIcon },
  { label: "Universe", to: "/universe", icon: UniverseIcon },
];

export function AppShell() {
  const { logout, user } = useAuth0();
  const { settings } = useSettings();

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
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">L</div>

          <div>
            <strong>Leilei OS</strong>
            <span>Personal space</span>
          </div>
        </div>

        <nav className="primary-nav" aria-label="主导航">
          {navigation.map(
            ({ end, icon: Icon, label, to }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `nav-item${isActive ? " active" : ""}`
                }
              >
                <Icon />
                <span>{label}</span>

                {(label === "Chat Archive" ||
                  label === "Universe") && (
                  <small>soon</small>
                )}
              </NavLink>
            ),
          )}
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
