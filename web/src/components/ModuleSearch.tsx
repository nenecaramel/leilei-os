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

export function ModuleSearchStateMessage({ state, emptyText, errorText, loadingText = "正在搜索…", retryLabel = "重试", onRetry, action, className = "" }: { state: ModuleSearchState; emptyText: string; errorText: string; loadingText?: string; retryLabel?: string; onRetry?: () => void; action?: ReactNode; className?: string }) {
  const classNames = `module-search-state${className ? ` ${className}` : ""}`;
  if (state === "loading") return <div className={classNames} role="status">{loadingText}</div>;
  if (state === "empty") return <div className={classNames}>{emptyText}{action}</div>;
  if (state === "error") return <div className={classNames} role="alert">{errorText}{onRetry ? <button className="module-search-state-retry" type="button" onClick={onRetry}>{retryLabel}</button> : null}</div>;
  return null;
}
