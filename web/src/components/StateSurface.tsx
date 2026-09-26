import type { ReactNode } from "react";

type StateSurfaceState = "loading" | "empty" | "error";
type StateSurfacePlacement = "page" | "module" | "paper" | "inline";

type StateSurfaceProps = {
  state: StateSurfaceState;
  message: string;
  description?: string;
  retryLabel?: string;
  onRetry?: () => void;
  action?: ReactNode;
  placement?: StateSurfacePlacement;
  className?: string;
};

export function StateSurface({
  state,
  message,
  description,
  retryLabel = "Retry",
  onRetry,
  action,
  placement = "module",
  className = "",
}: StateSurfaceProps) {
  const role = state === "error" ? "alert" : "status";
  return (
    <section
      className={`state-surface state-surface--${placement} state-surface--${state}${className ? ` ${className}` : ""}`}
      role={role}
      aria-live={state === "error" ? undefined : "polite"}
    >
      <p className="state-surface__message">{message}</p>
      {description ? <p className="state-surface__description">{description}</p> : null}
      {placement === "page" && (state === "loading" || state === "error") ? (
        <div className="state-surface__action-row">
          {onRetry ? (
            <button className="state-surface__action" type="button" onClick={onRetry}>
              {retryLabel}
            </button>
          ) : null}
          {action}
        </div>
      ) : (
        <>
          {onRetry ? (
            <button className="state-surface__action" type="button" onClick={onRetry}>
              {retryLabel}
            </button>
          ) : null}
          {action}
        </>
      )}
    </section>
  );
}

type NamedStateProps = Omit<StateSurfaceProps, "placement">;

export function PageState(props: NamedStateProps) {
  return <StateSurface {...props} placement="page" />;
}

export function ModuleState(props: NamedStateProps) {
  return <StateSurface {...props} placement="module" />;
}


