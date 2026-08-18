import React, { type ComponentType } from "react";
import { NavLink } from "react-router-dom";
import {
  AboutIcon,
  AccountIcon,
  ActivityIcon,
  ConnectionsIcon,
  DashboardIcon,
  DataIcon,
  DiaryIcon,
  MemoryIcon,
  SearchIcon,
  TaskIcon,
  UniverseIcon,
} from "../components/icons";

type NavigationIcon = ComponentType<{ className?: string }>;

export type NavigationEntry = {
  label: string;
  to?: string;
  icon: NavigationIcon;
  end?: boolean;
  disabled?: boolean;
};

export type NavigationGroup = {
  label: "Core" | "Utilities" | "System";
  entries: NavigationEntry[];
};

export const NAV_GROUPS: NavigationGroup[] = [
  {
    label: "Core",
    entries: [
      { label: "Home", to: "/", icon: DashboardIcon, end: true },
      { label: "Memory", to: "/memory", icon: MemoryIcon },
      { label: "Diary", to: "/diary", icon: DiaryIcon },
      { label: "Task", to: "/task", icon: TaskIcon },
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
    label: "System",
    entries: [
      {
        label: "Account",
        to: "/system/account",
        icon: AccountIcon,
      },
      {
        label: "Connections",
        to: "/system/connections",
        icon: ConnectionsIcon,
      },
      {
        label: "Data",
        to: "/system/data",
        icon: DataIcon,
      },
      {
        label: "Activity",
        to: "/system/activity",
        icon: ActivityIcon,
      },
      {
        label: "About",
        to: "/system/about",
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
                icon: Icon,
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
                      <Icon />
                      <span>{label}</span>
                      <small>soon</small>
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
                    <Icon />
                    <span>{label}</span>
                    {label === "Universe" && (
                      <small>soon</small>
                    )}
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
