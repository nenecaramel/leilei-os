import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { HomeAuthor, HomeNote } from "./home-prototype-data.js";
import {
  listPersistedTodoPaperDates,
  readTodoPaperEntries,
} from "./todo-paper-storage.js";
import {
  DAY_SPACE_DIARY_PROTOTYPES,
  DAY_SPACE_TODO_SEEDS,
  getDaySpacePrototypeDates,
  type DaySpaceDiaryPrototype,
} from "./day-space-prototype-data.js";
import { layoutDaySpacePapers } from "./day-space-layout.js";
import {
  buildDaySpaceLocation,
  businessDateToLocalDate,
  formatDaySpaceNavigationDate,
  formatLocalBusinessDate,
  parseExplicitDaySpaceDate,
  resolveLatestBusinessDate,
  shiftBusinessDate,
} from "./day-space-location.js";
import { DaySpaceDatePicker } from "./DaySpaceDatePicker.js";
import { DaySpaceDiaryDialog } from "./DaySpaceDiaryDialog.js";
import { TodoPaperDialog } from "./TodoPaperDialog.js";

type TodoPaper = {
  type: "todo";
  id: string;
  date: string;
  author: HomeAuthor;
  entries: HomeNote[];
};

type DiaryPaper = DaySpaceDiaryPrototype & {
  type: "diary";
};

type DaySpacePaper = TodoPaper | DiaryPaper;

function readTodoForDate(
  date: string,
  author: HomeAuthor,
): HomeNote[] {
  const seed = DAY_SPACE_TODO_SEEDS[date]?.[author] ?? [];
  if (typeof window === "undefined") {
    return seed.map((entry) => ({ ...entry }));
  }

  return readTodoPaperEntries(
    window.localStorage,
    author,
    date,
    seed,
  );
}

function densityForPaper(paper: DaySpacePaper): number {
  if (paper.type === "todo") {
    return Math.max(1, paper.entries.length);
  }

  return Math.max(
    2,
    Math.min(
      6,
      Math.ceil(
        (paper.title.length + paper.content.length) / 44,
      ),
    ),
  );
}

export function DaySpacePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const today = formatLocalBusinessDate(new Date());

  const [pickerOpen, setPickerOpen] = useState(false);
  const [todoRevision, setTodoRevision] = useState(0);
  const [diaries, setDiaries] = useState(() =>
    DAY_SPACE_DIARY_PROTOTYPES.map((entry) => ({
      ...entry,
    })),
  );
  const [openPaperId, setOpenPaperId] =
    useState<string | null>(null);
  const [stageWidth, setStageWidth] = useState(345);

  const stageMeasureRef =
    useRef<HTMLDivElement | null>(null);
  const paperTriggerRef =
    useRef<HTMLButtonElement | null>(null);

  const persistedDates =
    typeof window === "undefined"
      ? []
      : listPersistedTodoPaperDates(
          window.localStorage,
        );

  const selectedDate =
    parseExplicitDaySpaceDate(location.search) ??
    resolveLatestBusinessDate(
      [
        ...getDaySpacePrototypeDates(),
        ...persistedDates,
      ],
      today,
    );

  useEffect(() => {
    const element = stageMeasureRef.current;
    if (!element) return;

    const update = () =>
      setStageWidth(
        Math.max(280, element.clientWidth),
      );

    update();

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(update)
        : null;

    observer?.observe(element);
    window.addEventListener("resize", update);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const papers = useMemo<DaySpacePaper[]>(() => {
    void todoRevision;

    const todo: TodoPaper[] = (
      ["L", "G"] as const
    )
      .map((author) => ({
        type: "todo" as const,
        id: `todo:${author}:${selectedDate}`,
        date: selectedDate,
        author,
        entries: readTodoForDate(
          selectedDate,
          author,
        ),
      }))
      .filter(
        (paper) => paper.entries.length > 0,
      );

    const diary: DiaryPaper[] = diaries
      .filter(
        (entry) => entry.date === selectedDate,
      )
      .map((entry) => ({
        ...entry,
        type: "diary" as const,
      }));

    return [...todo, ...diary];
  }, [
    selectedDate,
    diaries,
    todoRevision,
  ]);

  const layout = useMemo(
    () =>
      layoutDaySpacePapers(
        selectedDate,
        papers.map((paper) => ({
          id: paper.id,
          density: densityForPaper(paper),
        })),
        stageWidth,
      ),
    [papers, selectedDate, stageWidth],
  );

  const layoutById = useMemo(
    () =>
      new Map(
        layout.items.map((item) => [
          item.id,
          item,
        ]),
      ),
    [layout],
  );

  const openPaper =
    papers.find(
      (paper) => paper.id === openPaperId,
    ) ?? null;

  const go = (date: string) => {
    setPickerOpen(false);
    setOpenPaperId(null);
    navigate(buildDaySpaceLocation(date));
  };

  return (
    <main className="day-space-page">
      <header className="day-space-header">
        <div className="memory-page-heading">
          <div className="memory-page-title">Day Space</div>
        </div>
      </header>

      <div className="day-space-date-area">
        <div
          className="day-space-date-nav"
          aria-label="Day Space 日期导航"
        >
          <button
            type="button"
            aria-label="前一天"
            onClick={() =>
              go(
                shiftBusinessDate(
                  selectedDate,
                  -1,
                ),
              )
            }
          >
            ‹
          </button>

          <button
            type="button"
            className="day-space-date-button"
            aria-expanded={pickerOpen}
            onClick={() =>
              setPickerOpen(
                (value) => !value,
              )
            }
          >
            {formatDaySpaceNavigationDate(
              selectedDate,
            )}
          </button>

          <button
            type="button"
            aria-label="后一天"
            onClick={() =>
              go(
                shiftBusinessDate(
                  selectedDate,
                  1,
                ),
              )
            }
          >
            ›
          </button>
        </div>

        {pickerOpen ? (
          <DaySpaceDatePicker
            selectedDate={selectedDate}
            todayDate={today}
            onClose={() =>
              setPickerOpen(false)
            }
            onSelect={go}
          />
        ) : null}
      </div>

      <div
        ref={stageMeasureRef}
        className="day-space-stage-measure"
      >
        {papers.length === 0 ? (
          <div className="day-space-empty">
            这一天还没有内容
          </div>
        ) : (
          <section
            className="day-space-stage"
            aria-label={`${selectedDate} 的内容`}
            style={{
              height: `${layout.stageHeight}px`,
            }}
          >
            {papers.map((paper) => {
              const item =
                layoutById.get(paper.id);

              if (!item) return null;

              const style = {
                left: item.left,
                top: item.top,
                width: item.width,
                height: item.height,
                zIndex: item.zIndex,
                transform:
                  `rotate(${item.rotation.toFixed(2)}deg)`,
              } satisfies CSSProperties;

              const todoPreviewLimit =
                item.size === "small"
                  ? 2
                  : item.size === "medium"
                    ? 3
                    : 4;

              return (
                <button
                  type="button"
                  key={paper.id}
                  className={
                    `day-space-paper ` +
                    `day-space-paper-${paper.type} ` +
                    `day-space-paper-${item.size}`
                  }
                  style={style}
                  onClick={(event) => {
                    paperTriggerRef.current =
                      event.currentTarget;
                    setOpenPaperId(paper.id);
                  }}
                >
                  {paper.type === "todo" ? (
                    <div className="day-space-todo-preview">
                      {paper.entries
                        .slice(0, todoPreviewLimit)
                        .map((entry) => (
                          <div
                            key={entry.id}
                            className={
                              `day-space-todo-line ` +
                              `day-space-todo-${entry.kind}`
                            }
                          >
                            <span
                              className="day-space-todo-dot"
                              aria-hidden="true"
                            />
                            <span>
                              {entry.text}
                            </span>
                          </div>
                        ))}
                      {paper.entries.length >
                      todoPreviewLimit ? (
                        <div
                          className="day-space-preview-ellipsis"
                          aria-hidden="true"
                        >
                          ...
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="day-space-diary-preview">
                      <strong>
                        {paper.title}
                      </strong>
                      <p>
                        {paper.content}
                      </p>
                    </div>
                  )}

                  <span className="day-space-paper-signature">
                    {paper.author}
                  </span>
                </button>
              );
            })}
          </section>
        )}
      </div>

      {openPaper?.type === "todo" ? (
        <TodoPaperDialog
          author={openPaper.author}
          date={
            businessDateToLocalDate(
              openPaper.date,
            ) ?? new Date()
          }
          open
          entries={openPaper.entries}
          triggerRef={paperTriggerRef}
          onSaved={() =>
            setTodoRevision(
              (value) => value + 1,
            )
          }
          onClosed={() =>
            setOpenPaperId(null)
          }
        />
      ) : null}

      {openPaper?.type === "diary" ? (
        <DaySpaceDiaryDialog
          diary={openPaper}
          open
          triggerRef={paperTriggerRef}
          onSaved={(next) =>
            setDiaries((entries) =>
              entries.map((entry) =>
                entry.id === next.id
                  ? next
                  : entry,
              ),
            )
          }
          onClosed={() =>
            setOpenPaperId(null)
          }
        />
      ) : null}
    </main>
  );
}
