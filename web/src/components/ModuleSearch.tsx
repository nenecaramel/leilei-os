import type { ChangeEvent, MouseEventHandler, ReactNode } from "react";
import { SearchIcon } from "./icons";
import { StateSurface } from "./StateSurface";

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
  description?: string;
  className?: string;
  placement?: ModuleStatePlacement;
};

export function ModuleStateMessage({
  state,
  emptyText,
  errorText,
  loadingText = "正在搜索…",
  retryLabel = "Retry",
  onRetry,
  action,
  description,
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

  if (state === "idle" || state === "ready") return null;

  const message =
    state === "loading"
      ? loadingText
      : state === "empty"
        ? emptyText
        : errorText;

  return (
    <StateSurface
      state={state}
      message={message}
      description={description}
      retryLabel={retryLabel}
      onRetry={state === "error" ? onRetry : undefined}
      action={state === "empty" ? action : undefined}
      placement={placement}
      className={classNames}
    />
  );
}

// Compatibility alias for search-only callers while module pages migrate to the
// presentation-level name.
export const ModuleSearchStateMessage = ModuleStateMessage;
