import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WebApiClient } from "../api/useWebApiClient";
import { WebApiError } from "../api/web-api-error";
import { PageHeader } from "./PageHeader";

type SentinelStatus =
  | "paused"
  | "recovery_required"
  | "processing"
  | "waiting_for_chatgpt"
  | "sleeping"
  | "waking";

type SentinelRecord = {
  enabled: boolean;
  timezone: string;
  policyPrompt: string;
  nextWakeAt: string | null;
  lastValidWakeAt: string | null;
};

type SentinelWake = {
  cause: "scheduled" | "wake_now" | "recovery";
  state: "bridge_enqueued" | "claimed" | "finalized" | "superseded" | "recovery_required";
  decision: "contact" | "quiet" | null;
  scheduledFor: string;
  nextWakeAt: string | null;
  finalizedAt: string | null;
  createdAt: string;
  recoveryRequired: boolean;
};

type SentinelResponse = {
  success: true;
  data: {
    sentinel: SentinelRecord;
    status: SentinelStatus;
  };
};

type WakeResponse = {
  success: true;
  data: {
    wakes: SentinelWake[];
  };
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; sentinel: SentinelRecord; projectedStatus: SentinelStatus }
  | { status: "uninitialized" }
  | { status: "error" };

const STATUS_LABELS: Record<SentinelStatus, string> = {
  paused: "Paused",
  recovery_required: "Recovery required",
  processing: "Processing",
  waiting_for_chatgpt: "Waiting for ChatGPT",
  sleeping: "Sleeping",
  waking: "Waking",
};

function formatMoment(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function localDateTimeValue(date: Date): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function activityLabel(wake: SentinelWake): string {
  if (wake.state === "finalized") {
    return wake.decision === "contact" ? "Contact" : "Quiet";
  }
  if (wake.recoveryRequired || wake.state === "recovery_required") return "Recovery required";
  if (wake.state === "claimed") return "Processing";
  if (wake.state === "bridge_enqueued") return "Waiting for ChatGPT";
  return "Superseded";
}

export function SentinelPageContent({
  api,
  now = () => new Date(),
}: {
  api: WebApiClient;
  now?: () => Date;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [wakes, setWakes] = useState<SentinelWake[]>([]);
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [policyPrompt, setPolicyPrompt] = useState("");
  const [resumeAt, setResumeAt] = useState(() => localDateTimeValue(new Date(now().getTime() + 10 * 60_000)));
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async (): Promise<boolean> => {
    setError(null);
    try {
      const response = await api.request<SentinelResponse>("/sentinel");
      const wakeResponse = await api.request<WakeResponse>("/sentinel/wakes?limit=20");
      if (!mounted.current) return false;
      setState({
        status: "ready",
        sentinel: response.data.sentinel,
        projectedStatus: response.data.status,
      });
      setTimezone(response.data.sentinel.timezone);
      setPolicyPrompt(response.data.sentinel.policyPrompt);
      setWakes(wakeResponse.data.wakes ?? []);
      return true;
    } catch (caught) {
      if (!mounted.current) return false;
      if (caught instanceof WebApiError && caught.status === 404) {
        setState({ status: "uninitialized" });
        setWakes([]);
        return true;
      }
      setState({ status: "error" });
      return false;
    }
  }, [api]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const latestFinalized = useMemo(
    () => wakes.find((wake) => wake.state === "finalized" && wake.decision !== null),
    [wakes],
  );

  const runAction = async (
    action: string,
    path: string,
    init?: RequestInit,
  ) => {
    if (busyAction) return;
    setBusyAction(action);
    setError(null);
    setNotice(null);
    try {
      await api.request(path, init);
      const refreshed = await load();
      if (!refreshed) throw new Error("Sentinel readback failed.");
      if (mounted.current) setNotice(`${action} completed.`);
    } catch {
      if (mounted.current) setError("This action could not be completed. Your current state was not changed here.");
    } finally {
      if (mounted.current) setBusyAction(null);
    }
  };

  const savePolicy = async () => {
    await runAction("Policy saved", "/sentinel", {
      method: "PUT",
      body: JSON.stringify({ timezone, policyPrompt }),
    });
  };

  const resume = async () => {
    const parsed = new Date(resumeAt);
    if (!Number.isFinite(parsed.getTime())) {
      setError("Choose a valid future wake time.");
      return;
    }
    await runAction("Resume", "/sentinel/resume", {
      method: "POST",
      body: JSON.stringify({ next_wake_at: parsed.toISOString() }),
    });
  };

  if (state.status === "loading") {
    return <div className="page sentinel-page"><PageHeader eyebrow="Control" title="Autonomous Wake" description="A private, owner-controlled wake schedule." /><p className="sentinel-state-copy" role="status">Reading Sentinel…</p></div>;
  }

  if (state.status === "error") {
    return <div className="page sentinel-page"><PageHeader eyebrow="Control" title="Autonomous Wake" description="A private, owner-controlled wake schedule." /><div className="sentinel-state-message" role="alert"><p>Sentinel is temporarily unavailable.</p><button className="secondary-button" type="button" onClick={() => void load()}>Retry</button></div></div>;
  }

  if (state.status === "uninitialized") {
    return (
      <div className="page sentinel-page">
        <PageHeader eyebrow="Control" title="Autonomous Wake" description="A private, owner-controlled wake schedule." />
        <section className="sentinel-card" aria-labelledby="sentinel-setup-title">
          <p className="sentinel-kicker">Autonomous Wake</p>
          <h2 id="sentinel-setup-title">Set up Sentinel</h2>
          <p className="sentinel-state-copy">Save a policy to set up your private wake controls.</p>
        </section>
        <section className="sentinel-card sentinel-policy-card" aria-labelledby="sentinel-policy-title">
          <div className="sentinel-card-heading"><div><p className="sentinel-kicker">Wake policy</p><h2 id="sentinel-policy-title">Your guidance</h2></div></div>
          <label className="sentinel-field"><span>Timezone</span><input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Asia/Shanghai" /></label>
          <label className="sentinel-field"><span>Policy</span><textarea value={policyPrompt} onChange={(event) => setPolicyPrompt(event.target.value)} placeholder="When should the wake be useful?" /></label>
          <button className="secondary-button" type="button" disabled={Boolean(busyAction)} onClick={() => void savePolicy()}>Save policy</button>
        </section>
      </div>
    );
  }

  const sentinel = state.sentinel;
  const projectedStatus = state.projectedStatus;
  const isRecovery = projectedStatus === "recovery_required";
  const isPaused = sentinel ? !sentinel.enabled : true;

  return (
    <div className="page sentinel-page" aria-busy={Boolean(busyAction)}>
      <PageHeader eyebrow="Control" title="Autonomous Wake" description="A private control surface for your scheduled wake." />

      {error ? <p className="sentinel-feedback sentinel-feedback-error" role="alert">{error}</p> : null}
      {notice ? <p className="sentinel-feedback" role="status">{notice}</p> : null}

      <section className="sentinel-card" aria-labelledby="sentinel-status-title">
        <div className="sentinel-card-heading">
          <div>
            <p className="sentinel-kicker">Autonomous Wake</p>
            <h2 id="sentinel-status-title">{isPaused ? "Paused" : "ON"}</h2>
          </div>
          <span className={`sentinel-status-pill sentinel-status-${projectedStatus}`}>{STATUS_LABELS[projectedStatus]}</span>
        </div>
        <dl className="sentinel-facts">
          <div><dt>Next wake</dt><dd>{formatMoment(sentinel?.nextWakeAt ?? null)}</dd></div>
          <div><dt>Last valid wake</dt><dd>{formatMoment(sentinel?.lastValidWakeAt ?? latestFinalized?.finalizedAt ?? null)}{latestFinalized ? ` · ${latestFinalized.decision === "contact" ? "Contact" : "Quiet"}` : ""}</dd></div>
          <div><dt>Current state</dt><dd>{STATUS_LABELS[projectedStatus]}</dd></div>
        </dl>
      </section>

      <section className="sentinel-card sentinel-policy-card" aria-labelledby="sentinel-policy-title">
        <div className="sentinel-card-heading"><div><p className="sentinel-kicker">Wake policy</p><h2 id="sentinel-policy-title">Your guidance</h2></div></div>
        <label className="sentinel-field"><span>Timezone</span><input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Asia/Shanghai" /></label>
        <label className="sentinel-field"><span>Policy</span><textarea value={policyPrompt} onChange={(event) => setPolicyPrompt(event.target.value)} placeholder="When should the wake be useful?" /></label>
        <button className="secondary-button" type="button" disabled={Boolean(busyAction)} onClick={() => void savePolicy()}>Save policy</button>
      </section>

      <section className="sentinel-controls" aria-label="Sentinel controls">
        {isPaused ? (
          <>
            <label className="sentinel-field sentinel-resume-field"><span>First wake after resume</span><input type="datetime-local" value={resumeAt} onChange={(event) => setResumeAt(event.target.value)} /></label>
            <div className="sentinel-control-row"><button className="primary-button" type="button" disabled={Boolean(busyAction)} onClick={() => void resume()}>Resume</button><button className="secondary-button" type="button" disabled={Boolean(busyAction)} onClick={() => void runAction("Resume now", "/sentinel/resume-now", { method: "POST", body: "{}" })}>Resume now</button></div>
          </>
        ) : (
          <div className="sentinel-control-row"><button className="primary-button" type="button" disabled={Boolean(busyAction)} onClick={() => void runAction("Wake now", "/sentinel/wake-now", { method: "POST", body: "{}" })}>Wake now</button><button className="secondary-button" type="button" disabled={Boolean(busyAction)} onClick={() => void runAction("Pause", "/sentinel/pause", { method: "POST", body: "{}" })}>Pause</button></div>
        )}
        {isRecovery ? <button className="secondary-button sentinel-recovery-button" type="button" disabled={Boolean(busyAction)} onClick={() => void runAction("Recovery", "/sentinel/recover", { method: "POST", body: "{}" })}>Recovery</button> : null}
      </section>

      <section className="sentinel-card sentinel-activity-card" aria-labelledby="sentinel-activity-title">
        <div className="sentinel-card-heading"><div><p className="sentinel-kicker">Recent</p><h2 id="sentinel-activity-title">Wake Activity</h2></div></div>
        {wakes.length === 0 ? <p className="sentinel-empty">No wake activity yet.</p> : <ol className="sentinel-activity-list">{wakes.slice(0, 20).map((wake, index) => <li key={`${wake.createdAt}-${index}`}><time dateTime={wake.createdAt}>{formatMoment(wake.createdAt)}</time><span>{activityLabel(wake)}</span>{wake.nextWakeAt ? <small>next {formatMoment(wake.nextWakeAt)}</small> : null}</li>)}</ol>}
      </section>
    </div>
  );
}
