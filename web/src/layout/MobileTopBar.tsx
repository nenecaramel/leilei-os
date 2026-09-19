import {
  type RefObject,
} from "react";
import { SearchIcon } from "../components/icons";

type MobileTopBarProps = {
  menuOpen: boolean;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  onMenuClick(): void;
  searchOpen: boolean;
  searchButtonRef: RefObject<HTMLButtonElement | null>;
  onSearchClick(): void;
};

export function MobileTopBar({
  menuOpen,
  menuButtonRef,
  onMenuClick,
  searchOpen,
  searchButtonRef,
  onSearchClick,
}: MobileTopBarProps) {
  return (
    <header className="mobile-top-bar">
      <button
        ref={menuButtonRef}
        className="mobile-menu-button"
        type="button"
        aria-label={
          menuOpen ? "关闭菜单" : "打开菜单"
        }
        aria-expanded={menuOpen}
        aria-controls="mobile-navigation-drawer"
        onClick={onMenuClick}
      >
        <span
          className="mobile-menu-icon"
          aria-hidden="true"
        >
          <span className="mobile-menu-line" />
          <span className="mobile-menu-line" />
          <span className="mobile-menu-line" />
        </span>
      </button>

      <span className="mobile-top-bar-title">
        Leilei OS
      </span>

      <button
        ref={searchButtonRef}
        className="mobile-search-link"
        type="button"
        aria-label={
          searchOpen
            ? "关闭快速搜索"
            : "打开快速搜索"
        }
        aria-expanded={searchOpen}
        aria-controls="quick-search-panel"
        onClick={onSearchClick}
      >
        <SearchIcon />
      </button>
    </header>
  );
}
