import type {
  InputHTMLAttributes,
  ReactNode,
} from "react";

type PopoverShellProps = {
  children: ReactNode;
  ariaLabel?: string;
  role?: "menu";
  variant?: "filter" | "search" | "time";
  className?: string;
};

export function PopoverShell({
  children,
  ariaLabel,
  role,
  variant = "filter",
  className = "",
}: PopoverShellProps) {
  return (
    <div
      className={["filter-popover-shell", `filter-popover-shell--${variant}`, className]
        .filter(Boolean)
        .join(" ")}
      role={role}
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}

type PopoverOptionProps = {
  children: ReactNode;
  checked: boolean;
  role?: "menuitemradio" | "menuitemcheckbox";
  className?: string;
  showCheck?: boolean;
  onClick(): void;
};

export function PopoverOption({
  children,
  checked,
  role = "menuitemradio",
  className = "",
  showCheck = false,
  onClick,
}: PopoverOptionProps) {
  return (
    <button
      className={["filter-popover-option", className].filter(Boolean).join(" ")}
      type="button"
      role={role}
      aria-checked={checked}
      onClick={onClick}
    >
      <span>{children}</span>
      {showCheck ? (
        <span className="filter-popover-check" aria-hidden="true">
          {checked ? "✓" : ""}
        </span>
      ) : null}
    </button>
  );
}

type PopoverSearchInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "type"
>;

export function PopoverSearchInput(props: PopoverSearchInputProps) {
  return (
    <input
      {...props}
      className="filter-popover-search-input"
      type="text"
    />
  );
}
