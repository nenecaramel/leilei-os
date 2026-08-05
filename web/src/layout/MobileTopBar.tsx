import React, { type RefObject } from "react";
import { Link } from "react-router-dom";
import { SearchIcon } from "../components/icons";

export function MobileTopBar({
  menuOpen,
  menuButtonRef,
  onMenuClick,
}: {
  menuOpen: boolean;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  onMenuClick: () => void;
}) {
  return (
    <header className="mobile-top-bar">
      <button
        ref={menuButtonRef}
        className="mobile-menu-button"
        type="button"
        aria-label={menuOpen ? "关闭菜单" : "打开菜单"}
        aria-expanded={menuOpen}
        aria-controls="mobile-navigation-drawer"
        onClick={onMenuClick}
      >
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </button>
      <span className="mobile-top-bar-title">Leilei OS</span>
      <Link className="mobile-search-link" to="/search" aria-label="打开 Global Search">
        <SearchIcon />
      </Link>
    </header>
  );
}
