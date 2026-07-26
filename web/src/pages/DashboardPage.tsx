import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useWebApiClient } from "../api/useWebApiClient";
import {
  ArchiveIcon,
  DiaryIcon,
  MemoryIcon,
  TaskIcon,
} from "../components/icons";
import { useSettings } from "../settings/SettingsProvider";
import { PageHeader } from "./PageHeader";

type DiaryEntry = {
  id: string;
  title: string;
  content: string;
  date: string;
};

type TaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled";

type TaskEntry = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  due_time: string;
  timezone: string;
};

type MemoryResponse = {
  success: true;
  data: {
    metadata: {
      count: number;
    };
  };
};

type DiaryResponse = {
  success: true;
  data: {
    diaries: DiaryEntry[];
    metadata: {
      count: number;
    };
  };
};

type TaskResponse = {
  success: true;
  data: {
    tasks: TaskEntry[];
    metadata: {
      count: number;
    };
  };
};

type DashboardState =
  | { status: "loading" }
  | {
      status: "ready";
      memoryCount: number;
      diaryCount: number;
      taskCount: number;
      openTaskCount: number;
      completedTaskCount: number;
      latestDiary: DiaryEntry | null;
      nextTask: TaskEntry | null;
    }
  | { status: "error" };

function getGreeting(): string {
  const hour = new Date().getHours();

  if (hour < 6) {
    return "夜深了";
  }

  if (hour < 12) {
    return "早上好";
  }

  if (hour < 18) {
    return "下午好";
  }

  return "晚上好";
}

function formatDiaryDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function formatTaskDueTime(
  value: string,
  timezone: string,
): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    }).format(date);
  } catch {
    return date.toLocaleString("zh-CN");
  }
}

function truncate(value: string, length: number): string {
  return value.length > length
    ? `${value.slice(0, length)}…`
    : value;
}

const CORE_MODULES = [
  {
    name: "Memory",
    capabilities: "创建、编辑、搜索与归档",
  },
  {
    name: "Diary",
    capabilities: "创建、查看与编辑",
  },
  {
    name: "Task",
    capabilities: "创建、状态管理与完成",
  },
] as const;

const AUTOMATIC_HERO_DESCRIPTION =
  `${CORE_MODULES.length} 个核心模块已连接：` +
  CORE_MODULES.map(
    (module) =>
      `${module.name} 支持${module.capabilities}`,
  ).join("；") +
  "。";

export const AUTOMATIC_HERO_TITLE =
  "你的个人系统正在持续运转。";

export function DashboardPage() {
  const api = useWebApiClient();
  const { settings } = useSettings();

  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<DashboardState>({
    status: "loading",
  });

  useEffect(() => {
    let active = true;

    setState({
      status: "loading",
    });

    Promise.all([
      api.request<MemoryResponse>("/memory"),
      api.request<DiaryResponse>("/diary"),
      api.request<TaskResponse>("/task"),
    ])
      .then(([memoryResponse, diaryResponse, taskResponse]) => {
        if (!active) {
          return;
        }

        const tasks = taskResponse.data.tasks;

        const openTasks = tasks.filter(
          (task) =>
            task.status === "pending" ||
            task.status === "in_progress",
        );

        const completedTasks = tasks.filter(
          (task) => task.status === "completed",
        );

        setState({
          status: "ready",
          memoryCount: memoryResponse.data.metadata.count,
          diaryCount: diaryResponse.data.metadata.count,
          taskCount: taskResponse.data.metadata.count,
          openTaskCount: openTasks.length,
          completedTaskCount: completedTasks.length,
          latestDiary:
            diaryResponse.data.diaries[0] ?? null,
          nextTask: openTasks[0] ?? null,
        });
      })
      .catch(() => {
        if (active) {
          setState({
            status: "error",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [api, reloadKey]);

  const preferredName =
    settings.preferred_name ?? "蕾蕾";

  const pageTitle =
    settings.home_title ??
    `${getGreeting()}，${preferredName}`;

  const pageDescription =
    settings.home_subtitle ??
    "记忆、日记和任务都汇集在这里。";

  const heroEyebrow =
    settings.page_copy.home_hero_eyebrow;

  const heroDescription =
    settings.page_copy.home_hero_description_mode === "custom"
      ? settings.page_copy.home_hero_description ??
        AUTOMATIC_HERO_DESCRIPTION
      : AUTOMATIC_HERO_DESCRIPTION;

  const heroTitle =
    settings.page_copy.home_hero_title_mode === "custom"
      ? settings.page_copy.home_hero_title ??
        AUTOMATIC_HERO_TITLE
      : AUTOMATIC_HERO_TITLE;

  return (
    <div className="page dashboard-page">
      <PageHeader
        eyebrow="Personal command center"
        title={pageTitle}
        description={pageDescription}
        action={
          <span className="live-badge">
            {state.status === "ready"
              ? ` modules connected`
              : "Loading"}
          </span>
        }
      />

      <section className="hero-panel">
        <div>
          {heroEyebrow && (
            <span className="status-pill">
              {heroEyebrow}
            </span>
          )}

          <h2>{heroTitle}</h2>

          <p>{heroDescription}</p>
        </div>

        <div className="orbit" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>

      {state.status === "loading" && (
        <section className="space-grid">
          {[0, 1, 2].map((item) => (
            <article
              className="space-card memory-card-loading"
              key={item}
            >
              <span />
              <strong />
              <p />
            </article>
          ))}
        </section>
      )}

      {state.status === "error" && (
        <section className="quiet-panel">
          <p className="eyebrow">System status</p>
          <h2>暂时无法读取 Dashboard</h2>
          <p>Memory、Diary 或 Task 的连接没有完成。</p>

          <button
            className="secondary-button"
            onClick={() =>
              setReloadKey((value) => value + 1)
            }
          >
            重新加载
          </button>
        </section>
      )}

      {state.status === "ready" && (
        <>
          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Spaces</p>
                <h2>你的个人系统</h2>
              </div>

              <span>3 live modules</span>
            </div>

            <div className="space-grid">
              <article className="space-card">
                <div className="space-icon sage">
                  <MemoryIcon />
                </div>

                <div>
                  <h3>Memory</h3>
                  <p>稳定偏好、目标和项目</p>
                </div>

                <span className="card-state">
                  {state.memoryCount} 条
                </span>

                <Link
                  className="secondary-button"
                  to="/memory"
                >
                  打开
                </Link>
              </article>

              <article className="space-card">
                <div className="space-icon peach">
                  <DiaryIcon />
                </div>

                <div>
                  <h3>Diary</h3>
                  <p>个人记录与生活切片</p>
                </div>

                <span className="card-state">
                  {state.diaryCount} 篇
                </span>

                <Link
                  className="secondary-button"
                  to="/diary"
                >
                  打开
                </Link>
              </article>

              <article className="space-card">
                <div className="space-icon blue">
                  <TaskIcon />
                </div>

                <div>
                  <h3>Task</h3>
                  <p>
                    {state.openTaskCount} 项进行中，
                    {state.completedTaskCount} 项已完成
                  </p>
                </div>

                <span className="card-state">
                  {state.taskCount} 项
                </span>

                <Link
                  className="secondary-button"
                  to="/task"
                >
                  打开
                </Link>
              </article>

              <article className="space-card">
                <div className="space-icon lilac">
                  <ArchiveIcon />
                </div>

                <div>
                  <h3>Archive</h3>
                  <p>未来的对话归档空间</p>
                </div>

                <span className="card-state">
                  Later
                </span>
              </article>
            </div>
          </section>

          <section className="quiet-panel">
            <p className="eyebrow">Today at a glance</p>

            <div className="status-row">
              <div>
                <span className="status-dot" />
                <strong>最近一篇日记</strong>

                {state.latestDiary ? (
                  <>
                    <p>
                      {formatDiaryDate(
                        state.latestDiary.date,
                      )}
                      {" · "}
                      {state.latestDiary.title}
                    </p>

                    <p>
                      {truncate(
                        state.latestDiary.content,
                        100,
                      )}
                    </p>
                  </>
                ) : (
                  <p>还没有日记。</p>
                )}
              </div>

              <div>
                <span className="status-dot" />
                <strong>下一项任务</strong>

                {state.nextTask ? (
                  <>
                    <p>{state.nextTask.title}</p>

                    <p>
                      截止于{" "}
                      {formatTaskDueTime(
                        state.nextTask.due_time,
                        state.nextTask.timezone,
                      )}
                    </p>
                  </>
                ) : (
                  <p>目前没有待处理任务。</p>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
