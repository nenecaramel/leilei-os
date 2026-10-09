import { type ComponentType } from "react";
import { NavLink } from "react-router-dom";
import {
  AboutIcon,
  AccountIcon,
  ConnectionsIcon,
  DashboardIcon,
  DataIcon,
  DiaryIcon,
  SearchIcon,
  UniverseIcon,
} from "../components/icons";

type NavigationIcon = ComponentType<{ className?: string }>;

type NavigationEntry = {
  label: string;
  to?: string;
  icon: NavigationIcon;
  end?: boolean;
  disabled?: boolean;
};

type NavigationGroup = {
  label: "Core" | "Utilities" | "Settings";
  entries: NavigationEntry[];
};

export const NAV_GROUPS: NavigationGroup[] = [
  {
    label: "Core",
    entries: [
      { label: "Home", to: "/", icon: DashboardIcon, end: true },
      { label: "Diary", to: "/diary", icon: DiaryIcon },
      { label: "Mind", to: "/mind", icon: DiaryIcon },
      { label: "Day Space", to: "/day-space", icon: DashboardIcon },
      { label: "Universe", to: "/universe", icon: UniverseIcon },
    ],
  },
  {
    label: "Utilities",
    entries: [
      {
        label: "Global Search",
        to: "/search",
        icon: SearchIcon,
      },
    ],
  },
  {
    label: "Settings",
    entries: [
      {
        label: "Account",
        to: "/settings/account",
        icon: AccountIcon,
      },
      {
        label: "Status",
        to: "/settings/status",
        icon: ConnectionsIcon,
      },
      {
        label: "Data",
        to: "/settings/data",
        icon: DataIcon,
      },
      {
        label: "About",
        to: "/settings/about",
        icon: AboutIcon,
      },
    ],
  },
];

export const NAV_ITEMS = NAV_GROUPS.flatMap(
  ({ entries }) => entries,
);

export function NavigationGroups({
  onNavigate,
}: {
  onNavigate?: () => void;
}) {
  return (
    <div className="navigation-groups">
      {NAV_GROUPS.map((group) => (
        <section
          className="navigation-group"
          key={group.label}
          aria-labelledby={`navigation-${group.label.toLowerCase()}`}
        >
          <h2 id={`navigation-${group.label.toLowerCase()}`}>
            {group.label}
          </h2>

          <div className="navigation-group-items">
            {group.entries.map(
              ({
                disabled,
                end,
                label,
                to,
              }) => {
                if (disabled || !to) {
                  return (
                    <button
                      className="nav-item nav-item-disabled"
                      type="button"
                      disabled
                      aria-disabled="true"
                      key={label}
                    >
                      <span>{label}</span>
                    </button>
                  );
                }

                return (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      `nav-item${isActive ? " active" : ""}`
                    }
                    onClick={onNavigate}
                  >
                    <span>{label}</span>
                  </NavLink>
                );
              },
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
