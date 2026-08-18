export type TaskMobileStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type TaskMobileEntry = {
  id: string;
  title: string;
  description: string;
  status: TaskMobileStatus;
  priority: "low" | "normal" | "high" | "urgent";
  due_time: string | null;
  timezone: string;
  time_bucket: "no_due_date" | "overdue" | "today" | "next_7_days" | "later";
  tags: string[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  allowed_actions: readonly string[];
};
export type TaskMobileGroup = { key: "overdue" | "today" | "next_7_days" | "later" | "no_due_date" | "completed" | "cancelled"; label: string; tasks: TaskMobileEntry[] };
export const TASK_STATUS_LABELS: Record<TaskMobileStatus, string> = {
  pending: "待处理", in_progress: "进行中", completed: "已完成", cancelled: "已取消",
};
const GROUPS: ReadonlyArray<{ key: TaskMobileGroup["key"]; label: string }> = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "next_7_days", label: "Next 7 Days" },
  { key: "later", label: "Later" },
  { key: "no_due_date", label: "No Deadline" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];
const ts = (v: string | null | undefined) => v ? (Date.parse(v) || 0) : 0;
export function groupTasksForMobile(tasks: readonly TaskMobileEntry[]): TaskMobileGroup[] {
  const buckets = new Map<TaskMobileGroup["key"], TaskMobileEntry[]>();
  for (const task of tasks) {
    const key: TaskMobileGroup["key"] = task.status === "completed" ? "completed" : task.status === "cancelled" ? "cancelled" : task.time_bucket;
    const group = buckets.get(key) ?? [];
    group.push(task);
    buckets.set(key, group);
  }
  return GROUPS.flatMap(({ key, label }) => {
    const group = buckets.get(key);
    if (!group?.length) return [];
    const sorted = [...group];
    if (key === "completed") sorted.sort((a, b) => ts(b.completed_at ?? b.updated_at) - ts(a.completed_at ?? a.updated_at) || a.id.localeCompare(b.id));
    else if (key === "cancelled") sorted.sort((a, b) => ts(b.updated_at) - ts(a.updated_at) || a.id.localeCompare(b.id));
    else if (key === "no_due_date") sorted.sort((a, b) => (a.status === "in_progress" ? 0 : 1) - (b.status === "in_progress" ? 0 : 1) || ts(b.created_at) - ts(a.created_at) || a.id.localeCompare(b.id));
    else sorted.sort((a, b) => ts(a.due_time) - ts(b.due_time) || ts(b.created_at) - ts(a.created_at) || a.id.localeCompare(b.id));
    return [{ key, label, tasks: sorted }];
  });
}
function parts(value: string, timezone: string, time: boolean) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      year: "numeric", month: "2-digit", day: "2-digit",
      ...(time ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const } : {}),
      timeZone: timezone,
    }).formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  } catch { return null; }
}
export function formatTaskRowDeadline(task: TaskMobileEntry) {
  if (!task.due_time) return "无截止时间";
  const p = parts(task.due_time, task.timezone, false);
  return p ? `${p.year}/${p.month}/${p.day}截止` : "截止时间";
}
export function formatTaskPaperDeadline(value: string | null, timezone: string) {
  if (!value) return "无截止时间";
  const p = parts(value, timezone, true);
  return p ? `${p.year}.${p.month}.${p.day} ${p.hour}:${p.minute}截止` : "截止时间";
}
export function formatTaskRowMeta(task: TaskMobileEntry) {
  const tags = task.tags.map((tag) => `#${tag}`).join(" ");
  return tags ? `${TASK_STATUS_LABELS[task.status]} · ${tags}` : TASK_STATUS_LABELS[task.status];
}
