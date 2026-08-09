import React, { useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { WebApiClient } from "../api/useWebApiClient";
import { CalendarPreview } from "./CalendarPreview";
import {
  G_HOME_NOTES,
  HOME_CALENDAR_DAYS,
  L_HOME_NOTES,
  type HomeAuthor,
  type HomeNote,
} from "./home-prototype-data";
import {
  formatTodoStorageDate,
  readTodoPaperEntries,
} from "./todo-paper-storage";
import { TodayPanel } from "./TodayPanel";
import { TodoPaperDialog } from "./TodoPaperDialog";

export function formatHomeDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function DashboardPageContent({
  api,
}: {
  api?: WebApiClient;
}) {
  void api;

  const [today] = useState(() => new Date());
  const dateKey = formatTodoStorageDate(today);
  const storage =
    typeof window === "undefined" ? null : window.localStorage;

  const [lNotes, setLNotes] = useState<HomeNote[]>(() =>
    storage
      ? readTodoPaperEntries(storage, "L", dateKey, L_HOME_NOTES)
      : L_HOME_NOTES.map((entry) => ({ ...entry })),
  );
  const [gNotes, setGNotes] = useState<HomeNote[]>(() =>
    storage
      ? readTodoPaperEntries(storage, "G", dateKey, G_HOME_NOTES)
      : G_HOME_NOTES.map((entry) => ({ ...entry })),
  );
  const [dialogAuthor, setDialogAuthor] = useState<HomeAuthor | null>(null);
  const lTriggerRef = useRef<HTMLButtonElement>(null);
  const gTriggerRef = useRef<HTMLButtonElement>(null);

  const selectedEntries = dialogAuthor === "L" ? lNotes : gNotes;
  const selectedTriggerRef =
    dialogAuthor === "L" ? lTriggerRef : gTriggerRef;
  const handleSaved =
    dialogAuthor === "L" ? setLNotes : setGNotes;

  return (
    <div className="page home-prototype">
      <h1 className="home-page-title">Todo</h1>
      <main className="home-prototype-content">
        <TodayPanel
          author="L"
          notes={lNotes}
          triggerRef={lTriggerRef}
          onOpen={() => setDialogAuthor("L")}
        />
        <TodayPanel
          author="G"
          notes={gNotes}
          triggerRef={gTriggerRef}
          onOpen={() => setDialogAuthor("G")}
        />
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

      {dialogAuthor ? (
        <TodoPaperDialog
          author={dialogAuthor}
          date={today}
          open
          entries={selectedEntries}
          triggerRef={selectedTriggerRef}
          onSaved={handleSaved}
          onClosed={() => setDialogAuthor(null)}
        />
      ) : null}
    </div>
  );
}
