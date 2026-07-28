export type DashboardTask = {
  status: "pending" | "in_progress" | "completed" | "cancelled";
  due_time: string | null;
  time_bucket: "no_due_date" | "overdue" | "today" | "next_7_days" | "later";
};

export function summarizeDashboardTasks<T extends DashboardTask>(tasks: T[]) {
  const openTasks = tasks.filter(
    (task) => task.status === "pending" || task.status === "in_progress",
  );
  const completedTasks = tasks.filter((task) => task.status === "completed");

  return {
    openTasks,
    completedTasks,
    overdueTaskCount: openTasks.filter(
      (task) => task.time_bucket === "overdue",
    ).length,
    nextTask:
      openTasks.find((task) => task.due_time !== null) ??
      openTasks[0] ??
      null,
  };
}
