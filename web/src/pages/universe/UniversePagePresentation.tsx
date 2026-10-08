import type { ReactNode } from "react";
import { PageState } from "../../components/StateSurface";

export function UniverseHeader({ actions, notice }: { actions?: ReactNode; notice?: string | null }) {
  return (
    <header className="memory-page-header universe-page-header">
      <div className="memory-page-heading universe-page-heading">
        <div className="memory-page-title">Universe</div>
        {notice ? <span className="universe-header-notice" role="status">{formatUniverseNotice(notice)}</span> : null}
      </div>
      {actions ? <div className="universe-page-tools">{actions}</div> : null}
    </header>
  );
}

export function UniverseFrame({ children }: { children: ReactNode }) {
  return <div className="page memory-page universe-page"><UniverseHeader />{children}</div>;
}

export function UniverseLoadingState() {
  return (
    <PageState
      state="loading"
      message="Reading..."
      className="universe-cosmos universe-cosmos-loading"
    />
  );
}

export function UniverseStatus({ onRetry }: { onRetry?: () => void }) {
  return (
    <PageState
      state="error"
      message="Unable to read Universe."
      retryLabel="Retry"
      onRetry={onRetry}
      className="universe-cosmos universe-cosmos-state"
    />
  );
}

function formatUniverseNotice(message: string): string {
  return message.trim().replace(/[。．.!！？?]+$/u, "");
}
