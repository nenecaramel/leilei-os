import React from "react";
import { NavigationGroups } from "./NavigationGroups";

export function NavigationPanel({
  navigationLabel = "Primary navigation",
  onNavigate,
  titleId,
  headerClassName,
  navClassName,
}: {
  navigationLabel?: string;
  onNavigate?: () => void;
  titleId?: string;
  headerClassName?: string;
  navClassName?: string;
}) {
  const headerClasses = [
    "navigation-panel-header",
    headerClassName,
  ]
    .filter(Boolean)
    .join(" ");
  const navClasses = [
    "navigation-panel-nav",
    navClassName,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="navigation-panel">
      <div className={headerClasses}>
        <strong id={titleId}>Leilei OS</strong>
      </div>
      <nav className={navClasses} aria-label={navigationLabel}>
        <NavigationGroups onNavigate={onNavigate} />
      </nav>
    </div>
  );
}

