import React, { type ComponentType } from "react";
import { NavLink } from "react-router-dom";
import {
  ArchiveIcon,
  DashboardIcon,
  DiaryIcon,
  MemoryIcon,
  SearchIcon,
  SettingsIcon,
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
      { label: "Day Space", icon: DashboardIcon, disabled: true },
      { label: "Universe", to: "/universe", icon: UniverseIcon },
      { label: "Chat Archive", to: "/chat-archive", icon: ArchiveIcon },
    ],
  },
  {
    label: "Utilities",
    entries: [{ label: "Global Search", to: "/search", icon: SearchIcon }],
  },
  {
    label: "System",
    entries: [{ label: "System", to: "/settings", icon: SettingsIcon }],
  },
];

export const NAV_ITEMS = NAV_GROUPS.flatMap(({ entries }) => entries);

export function NavigationGroups({
  onNavigate,
  includeSecondarySystemItems = false,
}: {
  onNavigate?: () => void;
  includeSecondarySystemItems?: boolean;
}) {
  const groups: NavigationGroup[] = includeSecondarySystemItems
    ? NAV_GROUPS.map((group) => group.label === "System"
      ? {
          ...group,
          entries: [
            ...group.entries.map((entry, index) => group.label === "System" && index === 0
              ? { ...entry, label: "General" }
              : entry),
            { label: "Appearance", icon: SettingsIcon, disabled: true },
            { label: "Data & Backup", icon: SettingsIcon, disabled: true },
            { label: "About", icon: SettingsIcon, disabled: true },
          ],
        }
      : group)
    : NAV_GROUPS;

  return (
    <div className="navigation-groups">
      {groups.map((group) => (
        <section className="navigation-group" key={group.label} aria-labelledby={`navigation-${group.label.toLowerCase()}`}>
          <h2 id={`navigation-${group.label.toLowerCase()}`}>{group.label}</h2>
          <div className="navigation-group-items">
            {group.entries.map(({ disabled, end, icon: Icon, label, to }) => {
              if (disabled || !to) {
                return (
                  <button className="nav-item nav-item-disabled" type="button" disabled aria-disabled="true" key={label}>
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
                  className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
                  onClick={onNavigate}
                >
                  <Icon />
                  <span>{label}</span>
                  {(label === "Chat Archive" || label === "Universe") && <small>soon</small>}
                </NavLink>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
