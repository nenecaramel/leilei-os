import React, { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { WebApiClient } from "../api/useWebApiClient";
import { DiaryIcon, MemoryIcon, TaskIcon } from "../components/icons";
import type { SettingsData } from "../settings/types";
import { PageHeader } from "./PageHeader";
import { navigateWithinApp } from "./app-navigation";
import { summarizeDashboardTasks } from "./dashboard-tasks";
import { createQuickCreateState, type QuickCreateTarget } from "./quick-create";

type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";
type TaskEntry = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  due_time: string | null;
  timezone: string;
  time_bucket: "no_due_date" | "overdue" | "today" | "next_7_days" | "later";
};
type MemoryResponse = { success: true; data: { metadata: { count: number } } };
type DiaryResponse = { success: true; data: { metadata: { count: number } } };
type TaskResponse = { success: true; data: { tasks: TaskEntry[]; metadata: { count: number } } };
type DashboardState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      memoryCount: number;
      diaryCount: number;
      taskCount: number;
      openTaskCount: number;
      completedTaskCount: number;
      overdueTaskCount: number;
    };

export const AUTOMATIC_HERO_TITLE = "你的个人系统正在持续运转。";

export const DASHBOARD_MODULES = ["Memory", "Diary", "Task"] as const;

export function formatDashboardTaskSummary(
  openTaskCount: number,
  overdueTaskCount: number,
  completedTaskCount: number,
): string {
  return `${openTaskCount} 项待处理 · ${overdueTaskCount} 项逾期 · ${completedTaskCount} 项已完成`;
}

export function getDashboardHeroDescription(
  status: "loading" | "ready" | "error",
  counts?: { memory: number; diary: number; openTasks: number; overdue: number },
  custom?: string | null,
): string {
  if (custom && custom.trim()) return custom;
  if (status === "ready" && counts) {
    return `Memory 有 ${counts.memory} 条记忆，Diary 有 ${counts.diary} 篇日记，Task 有 ${counts.openTasks} 项待处理，其中 ${counts.overdue} 项已逾期。`;
  }
  return status === "loading" ? "正在读取 Memory、Diary 和 Task。" : "暂时无法读取 Dashboard，请重试。";
}

export function getDashboardHeroTitle(
  status: "loading" | "ready" | "error",
  custom?: string | null,
): string {
  if (custom && custom.trim()) return custom;
  if (status === "loading") return "正在读取你的个人系统。";
  if (status === "error") return "Dashboard 暂时无法读取。";
  return AUTOMATIC_HERO_TITLE;
}

export function getDashboardBadge(status: "loading" | "ready" | "error"): string {
  return status === "ready" ? "3 modules connected" : status === "loading" ? "正在读取" : "读取失败";
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了";
  if (hour < 12) return "早上好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

export function DashboardPageContent({
  api,
  settings,
}: {
  api: WebApiClient;
  settings: SettingsData;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<DashboardState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    Promise.all([
      api.request<MemoryResponse>("/memory"),
      api.request<DiaryResponse>("/diary"),
      api.request<TaskResponse>("/task"),
    ])
      .then(([memory, diary, task]) => {
        if (!active) return;
        const summary = summarizeDashboardTasks(task.data.tasks);
        setState({
          status: "ready",
          memoryCount: memory.data.metadata.count,
          diaryCount: diary.data.metadata.count,
          taskCount: task.data.metadata.count,
          openTaskCount: summary.openTasks.length,
          completedTaskCount: summary.completedTasks.length,
          overdueTaskCount: summary.overdueTaskCount,
        });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [api, reloadKey]);

  const preferredName = settings.preferred_name ?? "蕾蕾";
  const pageTitle = settings.home_title ?? `${getGreeting()}，${preferredName}`;
  const pageDescription = settings.home_subtitle ?? "记忆、日记和任务都汇集在这里。";
  const isCustomHero = settings.page_copy.home_hero_description_mode === "custom";
  const heroDescription = getDashboardHeroDescription(
    state.status,
    state.status === "ready"
      ? { memory: state.memoryCount, diary: state.diaryCount, openTasks: state.openTaskCount, overdue: state.overdueTaskCount }
      : undefined,
    isCustomHero ? settings.page_copy.home_hero_description : null,
  );
  const heroTitle = settings.page_copy.home_hero_title_mode === "custom"
    ? getDashboardHeroTitle(state.status, settings.page_copy.home_hero_title)
    : getDashboardHeroTitle(state.status);

  return (
    <div className="page dashboard-page">
      <PageHeader
        eyebrow="Personal command center"
        title={pageTitle}
        description={pageDescription}
        action={
          <span className="live-badge">
            {getDashboardBadge(state.status)}
          </span>
        }
      />
      <section className="hero-panel">
        <div>
          {settings.page_copy.home_hero_eyebrow && <span className="status-pill">{settings.page_copy.home_hero_eyebrow}</span>}
          <h2>{heroTitle}</h2>
          <p>{heroDescription}</p>
        </div>
        <div className="orbit" aria-hidden="true"><span /><span /><span /></div>
      </section>
      {state.status === "loading" && (
        <section className="space-grid dashboard-module-grid" aria-label="模块加载中">
          {[0, 1, 2].map((item) => (
            <article className="space-card memory-card-loading" key={item}><span /><strong /><p /></article>
          ))}
        </section>
      )}
      {state.status === "error" && (
        <section className="quiet-panel" role="alert">
          <p className="eyebrow">System status</p>
          <h2>Dashboard 暂时无法读取。</h2>
          <p>请检查连接后重试。</p>
          <button className="secondary-button" onClick={() => setReloadKey((value) => value + 1)}>重新加载</button>
        </section>
      )}
      {state.status === "ready" && (
        <section className="space-grid dashboard-module-grid" aria-label="核心模块">
          <DashboardModuleCard icon={<MemoryIcon />} iconClass="memory" name="Memory" description="稳定偏好、目标和项目" count={`${state.memoryCount} 条`} href="/memory" quickLabel="新增记忆" quickTarget="memory" />
          <DashboardModuleCard icon={<DiaryIcon />} iconClass="diary" name="Diary" description="个人记录与生活切片" count={`${state.diaryCount} 篇`} href="/diary" quickLabel="写日记" quickTarget="diary" />
          <DashboardModuleCard icon={<TaskIcon />} iconClass="task" name="Task" description={formatDashboardTaskSummary(state.openTaskCount, state.overdueTaskCount, state.completedTaskCount)} count={`${state.taskCount} 项`} href="/task" quickLabel="新建任务" quickTarget="task" />
        </section>
      )}
    </div>
  );
}

export function DashboardModuleCard({
  icon,
  iconClass,
  name,
  description,
  count,
  href,
  quickLabel,
  quickTarget,
}: {
  icon: ReactNode;
  iconClass: string;
  name: string;
  description: string;
  count: string;
  href: string;
  quickLabel: string;
  quickTarget: QuickCreateTarget;
}) {
  return (
    <article className="space-card">
      <Link className="space-card-main" to={href} aria-label={`打开 ${name} 列表`}>
        <div className={`space-icon ${iconClass}`}>{icon}</div>
        <div><h3>{name}</h3><p>{description}</p></div>
        <span className="card-state">{count}</span>
      </Link>
      <button className="secondary-button" type="button" onClick={() => navigateWithinApp(href, createQuickCreateState(window.history.state, quickTarget))}>
        {quickLabel}
      </button>
    </article>
  );
}
