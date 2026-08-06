import React, { useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { WebApiClient } from "../api/useWebApiClient";
import type { SettingsData } from "../settings/types";
import { CalendarPreview } from "./CalendarPreview";
import { G_HOME_NOTES, HOME_CALENDAR_DAYS, L_HOME_NOTES, type HomeAuthor } from "./home-prototype-data";
import { TodayPanel } from "./TodayPanel";
import { TodayPanelDialog } from "./TodayPanelDialog";

export function formatHomeDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(date);
}

export function DashboardPageContent({
  api,
  settings,
}: {
  api?: WebApiClient;
  settings?: SettingsData;
}) {
  void api;
  void settings;
  const [dialogAuthor, setDialogAuthor] = useState<HomeAuthor | null>(null);
  const lTriggerRef = useRef<HTMLButtonElement>(null);
  const gTriggerRef = useRef<HTMLButtonElement>(null);
  const today = new Date();

  return (
    <div className="page home-prototype">
      <h1 className="home-page-title">Todo</h1>
      <main className="home-prototype-content">
        <TodayPanel author="L" notes={L_HOME_NOTES} triggerRef={lTriggerRef} onOpen={() => setDialogAuthor("L")} />
        <TodayPanel author="G" notes={G_HOME_NOTES} triggerRef={gTriggerRef} onOpen={() => setDialogAuthor("G")} />
        <CalendarPreview days={HOME_CALENDAR_DAYS} date={today} />

        <section
          className="home-section home-preview-section records-section"
          aria-labelledby="records-title"
        >
          <div className="home-section-heading records-section-heading">
            <h2 id="records-title">Records</h2>
          </div>

          <nav className="home-bottom-nav" aria-label="模块入口">
            <Link to="/memory">Memory</Link>
            <Link to="/diary">Diary</Link>
            <Link to="/task">Task</Link>
            <Link to="/universe">Universe</Link>
          </nav>
        </section>
      </main>

      <TodayPanelDialog author="L" notes={L_HOME_NOTES} open={dialogAuthor === "L"} triggerRef={lTriggerRef} onClose={() => setDialogAuthor(null)} />
      <TodayPanelDialog author="G" notes={G_HOME_NOTES} open={dialogAuthor === "G"} triggerRef={gTriggerRef} onClose={() => setDialogAuthor(null)} />
    </div>
  );
}
