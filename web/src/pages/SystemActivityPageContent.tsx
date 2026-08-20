import { useEffect, useMemo, useState } from "react";
import type {
  WebApiClient,
} from "../api/useWebApiClient";
import type {
  SystemActivityItem,
  SystemActivityResponse,
} from "../system/types";
import { PageHeader } from "./PageHeader";

type LoadState =
  | { status: "loading" }
  | {
      status: "ready";
      events: SystemActivityItem[];
    }
  | { status: "error" };

type ActivityGroup = {
  key: string;
  label: string;
  events: SystemActivityItem[];
};

function activityDayKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(
      2,
      "0",
    ),
    String(date.getDate()).padStart(
      2,
      "0",
    ),
  ].join("-");
}

function formatActivityDay(
  value: string,
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function formatActivityTime(
  value: string,
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function groupActivity(
  events: SystemActivityItem[],
): ActivityGroup[] {
  const groups = new Map<
    string,
    ActivityGroup
  >();

  for (const event of events) {
    const key = activityDayKey(
      event.occurred_at,
    );
    const existing = groups.get(key);

    if (existing) {
      existing.events.push(event);
      continue;
    }

    groups.set(key, {
      key,
      label: formatActivityDay(
        event.occurred_at,
      ),
      events: [event],
    });
  }

  return [...groups.values()];
}

function ActivityRow({
  event,
}: {
  event: SystemActivityItem;
}) {
  return (
    <li className="system-activity-row">
      <time dateTime={event.occurred_at}>
        {formatActivityTime(
          event.occurred_at,
        )}
      </time>

      <div className="system-activity-main">
        <strong className="system-activity-label">
          {event.label}
        </strong>
        <span>
          {event.source} ·{" "}
          {event.outcome === "success"
            ? "Success"
            : "Failed"}
        </span>
      </div>
    </li>
  );
}

export function SystemActivityPageContent({
  api,
}: {
  api: WebApiClient;
}) {
  const [reloadKey, setReloadKey] =
    useState(0);
  const [state, setState] =
    useState<LoadState>({
      status: "loading",
    });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    api
      .request<SystemActivityResponse>(
        "/system/activity",
      )
      .then((response) => {
        if (!active) return;
        setState({
          status: "ready",
          events: response.data.events,
        });
      })
      .catch(() => {
        if (!active) return;
        setState({ status: "error" });
      });

    return () => {
      active = false;
    };
  }, [api, reloadKey]);

  const groups = useMemo(
    () =>
      state.status === "ready"
        ? groupActivity(state.events)
        : [],
    [state],
  );

  return (
    <div
      className={
        "page system-page " +
        "system-activity-page"
      }
    >
      <PageHeader
        eyebrow="System"
        title="Activity"
        description="Recent persisted changes across Leilei OS."
      />

      <section
        className={
          state.status === "ready" &&
          state.events.length > 0
            ? "system-section system-activity-list-section"
            : "system-section"
        }
        aria-label="System activity"
      >
        {state.status === "loading" ? (
          <p className="system-state-copy" role="status" aria-live="polite">
            Reading activity…
          </p>
        ) : null}

        {state.status === "error" ? (
          <div className="system-state-message">
            <p>Unable to read activity.</p>
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                setReloadKey(
                  (value) => value + 1,
                )
              }
            >
              Retry
            </button>
          </div>
        ) : null}

        {state.status === "ready" &&
        state.events.length === 0 ? (
          <p className="system-empty-state">
            No activity yet.
          </p>
        ) : null}

        {groups.map((group) => (
          <section
            className="system-activity-day"
            key={group.key}
          >
            <h2>{group.label}</h2>
            <ol>
              {group.events.map((event) => (
                <ActivityRow
                  key={event.id}
                  event={event}
                />
              ))}
            </ol>
          </section>
        ))}
      </section>
    </div>
  );
}
