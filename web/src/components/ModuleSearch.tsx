import type { ChangeEvent, MouseEventHandler, ReactNode } from "react";
import { SearchIcon } from "./icons";

type ModuleSearchButtonProps = {
  label: string;
  expanded: boolean;
  disabled?: boolean;
  onClick: MouseEventHandler<HTMLButtonElement>;
};

export function ModuleSearchButton({ label, expanded, disabled, onClick }: ModuleSearchButtonProps) {
  return (
    <button type="button" aria-label={label} aria-expanded={expanded} disabled={disabled} onClick={onClick}>
      <SearchIcon className="memory-page-search-icon" />
    </button>
  );
}

type ModuleSearchFieldProps = {
  ariaLabel: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
};

export function ModuleSearchField({ ariaLabel, placeholder, value, onChange, className = "" }: ModuleSearchFieldProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value);
  return (
    <div className={`memory-page-search${className ? ` ${className}` : ""}`}>
      <SearchIcon />
      <input type="text" aria-label={ariaLabel} maxLength={200} placeholder={placeholder} value={value} onChange={handleChange} />
    </div>
  );
}

export type ModuleSearchState = "idle" | "loading" | "ready" | "empty" | "error";
export type ModuleStatePlacement = "inline" | "module" | "paper";

type ModuleStateMessageProps = {
  state: ModuleSearchState;
  emptyText: string;
  errorText: string;
  loadingText?: string;
  retryLabel?: string;
  onRetry?: () => void;
  action?: ReactNode;
  className?: string;
  placement?: ModuleStatePlacement;
};

export function ModuleStateMessage({
  state,
  emptyText,
  errorText,
  loadingText = "正在搜索…",
  retryLabel = "重试",
  onRetry,
  action,
  className = "",
  placement = "inline",
}: ModuleStateMessageProps) {
  const placementClass =
    placement === "module"
      ? " module-state-slot"
      : placement === "paper"
        ? " paper-detail-state"
        : "";
  const classNames =
    `module-search-state${placementClass}${className ? ` ${className}` : ""}`;

  if (state === "loading") {
    return (
      <div className={classNames} role="status" aria-live="polite">
        <span className="module-search-state-copy">{loadingText}</span>
      </div>
    );
  }

  if (state === "empty") {
    return (
      <div
        className={classNames}
        role={placement === "inline" ? undefined : "status"}
      >
        <span className="module-search-state-copy">{emptyText}</span>
        {action}
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className={classNames} role="alert">
        <span className="module-search-state-copy">{errorText}</span>
        {onRetry ? (
          <button
            className="module-search-state-retry"
            type="button"
            onClick={onRetry}
          >
            {retryLabel}
          </button>
        ) : null}
      </div>
    );
  }

  return null;
}

// Compatibility alias for search-only callers while module pages migrate to the
// presentation-level name.
export const ModuleSearchStateMessage = ModuleStateMessage;
