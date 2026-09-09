import type { ChangeEvent, MouseEventHandler } from "react";
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

export function ModuleSearchStateMessage({ state, emptyText, errorText, onRetry }: { state: ModuleSearchState; emptyText: string; errorText: string; onRetry?: () => void }) {
  if (state === "loading") return <div className="module-search-state" role="status">正在搜索…</div>;
  if (state === "empty") return <div className="module-search-state">{emptyText}</div>;
  if (state === "error") return <div className="module-search-state" role="alert">{errorText}{onRetry ? <button type="button" onClick={onRetry}>重试</button> : null}</div>;
  return null;
}
