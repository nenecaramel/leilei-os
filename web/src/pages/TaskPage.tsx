import {
    useEffect,
    useRef,
    useState,
    type ReactNode,
  } from "react";
  import { useWebApiClient } from "../api/useWebApiClient";
  import { TaskIcon } from "../components/icons";
  import { NativeDateInput } from "../components/NativeDateInput";
  import { useSettings } from "../settings/SettingsProvider";
  import { PageHeader } from "./PageHeader";
  import { getTaskActionControls } from "./task-actions";
  
  type TaskStatus =
    | "pending"
    | "in_progress"
    | "completed"
    | "cancelled";
  
  type TaskPriority =
    | "low"
    | "normal"
    | "high"
    | "urgent";

  type TaskAction = "start" | "complete" | "cancel";
  type TaskDueFilter = "" | "overdue" | "today" | "next_7_days" | "custom";
  
  type TaskEntry = {
    id: string;
    title: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority;
    due_time: string;
    timezone: string;
    tags: string[];
    created_at: string;
    updated_at: string;
    completed_at: string | null;
    allowed_actions: TaskAction[];
  };
  
  type TaskListResponse = {
    success: true;
    data: {
      tasks: TaskEntry[];
      metadata: {
        count: number;
      };
    };
  };
  
  type TaskEntryResponse = {
    success: true;
    data: TaskEntry;
  };
  
  type LoadState =
    | { status: "loading" }
    | {
        status: "ready";
        tasks: TaskEntry[];
        count: number;
      }
    | { status: "error" };
  
  const statusLabels: Record<TaskStatus, string> = {
    pending: "待处理",
    in_progress: "进行中",
    completed: "已完成",
    cancelled: "已取消",
  };
  
  const priorityLabels: Record<TaskPriority, string> = {
    low: "低",
    normal: "普通",
    high: "高",
    urgent: "紧急",
  };
  
  function getDefaultDueTime(): string {
    const date = new Date();
    date.setHours(date.getHours() + 1);
    date.setMinutes(0, 0, 0);
  
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
  
    return `${year}-${month}-${day}T${hour}:${minute}`;
  }
  
  function getLocalTimezone(): string {
    return (
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      "UTC"
    );
  }
  
  function toIsoInstant(value: string): string {
    const parsed = new Date(value);
  
    if (Number.isNaN(parsed.getTime())) {
      return "";
    }
  
    return parsed.toISOString();
  }

  function toDateTimeLocal(
    value: string,
    timezone: string,
  ): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZone: timezone,
      }).formatToParts(date);
      const values = Object.fromEntries(
        parts
          .filter((part) => part.type !== "literal")
          .map((part) => [part.type, part.value]),
      );

      return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
    } catch {
      return "";
    }
  }
  
  function formatDueTime(
    value: string,
    timezone: string,
  ): string {
    const date = new Date(value);
  
    if (Number.isNaN(date.getTime())) {
      return value;
    }
  
    try {
      return new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
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
  
  function parseTags(value: string): string[] {
    return [
      ...new Set(
        value
          .split(/[,，]/)
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0),
      ),
    ];
  }
  function initialFilters() {
    const p = new URLSearchParams(window.location.search);
    return { q: p.get("q") ?? "", status: p.get("status") ?? "", priority: p.get("priority") ?? "", tag: p.get("tag") ?? "", due: (p.get("due") ?? "") as TaskDueFilter, dueFrom: p.get("due_from") ?? "", dueTo: p.get("due_to") ?? "" };
  }
  function presetRange(due: TaskDueFilter) {
    const start = new Date(); const end = new Date();
    if (due === "today") { start.setHours(0,0,0,0); end.setHours(0,0,0,0); end.setDate(end.getDate()+1); }
    if (due === "next_7_days") end.setDate(end.getDate()+7);
    return due === "today" || due === "next_7_days" ? { from: start.toISOString(), to: end.toISOString() } : null;
  }
  
  export function TaskPage() {
    const api = useWebApiClient();
    const { settings } = useSettings();
    const listScrollPosition = useRef(0);
  
    const [reloadKey, setReloadKey] = useState(0);
    const [filters, setFilters] = useState(initialFilters);
    const [state, setState] = useState<LoadState>({
      status: "loading",
    });
  
    const [showCreate, setShowCreate] = useState(false);
    const [creating, setCreating] = useState(false);
  
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [priority, setPriority] =
      useState<TaskPriority>("normal");
    const [dueTime, setDueTime] = useState(
      getDefaultDueTime(),
    );
    const [timezone, setTimezone] = useState(
      getLocalTimezone(),
    );
    const [tags, setTags] = useState("");
  
    const [selectedTask, setSelectedTask] =
      useState<TaskEntry | null>(null);
    const [loadingTaskId, setLoadingTaskId] =
      useState("");
    const [updatingStatus, setUpdatingStatus] =
      useState(false);
    const [editing, setEditing] = useState(false);
    const [updating, setUpdating] = useState(false);
    const [editingTitle, setEditingTitle] = useState("");
    const [editingDescription, setEditingDescription] = useState("");
    const [editingPriority, setEditingPriority] =
      useState<TaskPriority>("normal");
    const [editingDueTime, setEditingDueTime] = useState("");
    const [editingTimezone, setEditingTimezone] = useState("");
    const [editingTags, setEditingTags] = useState("");
  
    const [actionError, setActionError] = useState("");

    useEffect(() => {
      const onPopState = () => setFilters(initialFilters());
      window.addEventListener("popstate", onPopState);
      return () => window.removeEventListener("popstate", onPopState);
    }, []);
  
    useEffect(() => {
      let active = true;
      const timeout = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (filters.q.trim()) params.set("q", filters.q.trim());
      if (filters.status) params.set("status", filters.status);
      if (filters.priority) params.set("priority", filters.priority);
      if (filters.tag.trim()) params.set("tag", filters.tag.trim());
      if (filters.due) params.set("due", filters.due);
      if (filters.due === "custom") { if (filters.dueFrom) params.set("due_from", toIsoInstant(filters.dueFrom)); if (filters.dueTo) params.set("due_to", toIsoInstant(filters.dueTo)); }
      else { const range = presetRange(filters.due); if (range) { params.set("due_from", range.from); params.set("due_to", range.to); } }
      window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
      setState({
        status: "loading",
      });
      api.request<TaskListResponse>(`/task${params.size ? `?${params}` : ""}`)
        .then((response) => {
          if (!active) {
            return;
          }
  
          setState({
            status: "ready",
            tasks: response.data.tasks,
            count: response.data.metadata.count,
          });
        })
        .catch(() => {
          if (active) {
            setState({
              status: "error",
            });
          }
        });
  
      }, filters.q ? 300 : 0);
      return () => {
        active = false;
        window.clearTimeout(timeout);
      };
    }, [api, reloadKey, filters]);

    function clearFilters() { setFilters({ q: "", status: "", priority: "", tag: "", due: "", dueFrom: "", dueTo: "" }); }
  
    const createInvalid =
      title.trim().length === 0 ||
      description.trim().length === 0 ||
      dueTime.trim().length === 0 ||
      timezone.trim().length === 0;
  
    async function handleCreate() {
      if (createInvalid || creating) {
        return;
      }
  
      const dueTimeIso = toIsoInstant(dueTime);
  
      if (!dueTimeIso) {
        setActionError("截止时间无效。");
        return;
      }
  
      setCreating(true);
      setActionError("");
  
      try {
        const response = await api.request<TaskEntryResponse>(
          "/task",
          {
            method: "POST",
            body: JSON.stringify({
              title: title.trim(),
              description: description.trim(),
              priority,
              dueTime: dueTimeIso,
              timezone: timezone.trim(),
              tags: parseTags(tags),
            }),
          },
        );
  
        setTitle("");
        setDescription("");
        setPriority("normal");
        setDueTime(getDefaultDueTime());
        setTimezone(getLocalTimezone());
        setTags("");
        setShowCreate(false);
  
        setSelectedTask(response.data);
        setReloadKey((value) => value + 1);
  
        requestAnimationFrame(() => {
          window.scrollTo({
            top: 0,
            behavior: "smooth",
          });
        });
      } catch {
        setActionError("创建任务失败，请稍后重试。");
      } finally {
        setCreating(false);
      }
    }
  
    async function handleReadTask(id: string) {
      if (loadingTaskId) {
        return;
      }
  
      listScrollPosition.current = window.scrollY;
      setLoadingTaskId(id);
      setActionError("");
  
      try {
        const response = await api.request<TaskEntryResponse>(
          `/task/${id}`,
        );
  
        setSelectedTask(response.data);
        setEditing(false);
  
        requestAnimationFrame(() => {
          window.scrollTo({
            top: 0,
            behavior: "smooth",
          });
        });
      } catch {
        setActionError("读取任务详情失败，请稍后重试。");
      } finally {
        setLoadingTaskId("");
      }
    }
  
    function handleCloseTask() {
      setSelectedTask(null);
      setEditing(false);
      setActionError("");
  
      requestAnimationFrame(() => {
        window.scrollTo({
          top: listScrollPosition.current,
          behavior: "smooth",
        });
      });
    }
  
    function beginEditing(task: TaskEntry) {
      setEditing(true);
      setEditingTitle(task.title);
      setEditingDescription(task.description);
      setEditingPriority(task.priority);
      setEditingDueTime(toDateTimeLocal(task.due_time, task.timezone));
      setEditingTimezone(task.timezone);
      setEditingTags(task.tags.join(", "));
      setActionError("");
    }

    const updateInvalid =
      editingTitle.trim().length === 0 ||
      editingDescription.trim().length === 0 ||
      editingDueTime.trim().length === 0 ||
      editingTimezone.trim().length === 0;

    const taskActions = selectedTask
      ? getTaskActionControls(selectedTask.allowed_actions)
      : [];

    async function handleUpdateStatus(status: TaskStatus) {
      if (!selectedTask || updatingStatus) {
        return;
      }
  
      setUpdatingStatus(true);
      setActionError("");
  
      try {
        const response = await api.request<TaskEntryResponse>(
          `/task/${selectedTask.id}/status`,
          {
            method: "PATCH",
            body: JSON.stringify({
              status,
            }),
          },
        );

        setSelectedTask(response.data);
        setReloadKey((value) => value + 1);
      } catch {
        setActionError("任务状态无法这样变更，请刷新后重试。");
      } finally {
        setUpdatingStatus(false);
      }
    }

    async function handleUpdate() {
      if (!selectedTask || updateInvalid || updating) {
        return;
      }

      const dueTimeIso = toIsoInstant(editingDueTime);
      if (!dueTimeIso) {
        setActionError("截止时间无效。");
        return;
      }

      setUpdating(true);
      setActionError("");

      try {
        const response = await api.request<TaskEntryResponse>(
          `/task/${selectedTask.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              title: editingTitle.trim(),
              description: editingDescription.trim(),
              priority: editingPriority,
              dueTime: dueTimeIso,
              timezone: editingTimezone.trim(),
              tags: parseTags(editingTags),
            }),
          },
        );

        setSelectedTask(response.data);
        setEditing(false);
        setReloadKey((value) => value + 1);
      } catch {
        setActionError("保存任务修改失败，请检查输入后重试。");
      } finally {
        setUpdating(false);
      }
    }
  
    return (
      <div className="page memory-page">
        <PageHeader
          eyebrow="Focus & execution"
          title="Task"
          description={settings.page_copy.task_subtitle ?? "管理待办事项、截止时间、优先级与完成状态。"}
          action={
            selectedTask ? (
              <button
                className="secondary-button"
                disabled={updatingStatus || updating}
                onClick={handleCloseTask}
              >
                返回任务列表
              </button>
            ) : (
              <button
                className="secondary-button"
                disabled={creating || updating}
                onClick={() => {
                  setShowCreate((value) => !value);
                  setActionError("");
                }}
              >
                {showCreate ? "取消新增" : "新增任务"}
              </button>
            )
          }
        />
        {!selectedTask && (
          <section className="memory-message task-filters">
            <input aria-label="搜索任务" placeholder="搜索任务标题或内容" value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} />
            <select aria-label="状态筛选" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
              <option value="">全部状态</option><option value="pending">待处理</option><option value="in_progress">进行中</option><option value="completed">已完成</option><option value="cancelled">已取消</option>
            </select>
            <select aria-label="优先级筛选" value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })}>
              <option value="">全部优先级</option><option value="low">低</option><option value="normal">普通</option><option value="high">高</option><option value="urgent">紧急</option>
            </select>
            <input aria-label="标签筛选" placeholder="筛选标签" value={filters.tag} onChange={(event) => setFilters({ ...filters, tag: event.target.value })} />
            <select aria-label="截止时间筛选" value={filters.due} onChange={(event) => setFilters({ ...filters, due: event.target.value as TaskDueFilter })}>
              <option value="">全部时间</option><option value="overdue">已逾期</option><option value="today">今天</option><option value="next_7_days">未来七天</option><option value="custom">自定义范围</option>
            </select>
            {filters.due === "custom" && <><NativeDateInput aria-label="开始日期" type="datetime-local" value={filters.dueFrom} onChange={(event) => setFilters({ ...filters, dueFrom: event.target.value })} /><NativeDateInput aria-label="结束日期" type="datetime-local" value={filters.dueTo} onChange={(event) => setFilters({ ...filters, dueTo: event.target.value })} /></>}
            <button className="secondary-button" onClick={clearFilters}>清除全部</button>
          </section>
        )}
  
        {actionError && (
          <section className="memory-message">
            <h2>操作没有完成</h2>
            <p>{actionError}</p>
          </section>
        )}
  
        {selectedTask ? (
          <section className="memory-message">
            {editing ? (
              <>
                <h2>编辑任务</h2>

                <input
                  value={editingTitle}
                  disabled={updating}
                  onChange={(event) => {
                    setEditingTitle(event.target.value);
                    setActionError("");
                  }}
                />

                <textarea
                  value={editingDescription}
                  disabled={updating}
                  onChange={(event) => {
                    setEditingDescription(event.target.value);
                    setActionError("");
                  }}
                />

                <select
                  value={editingPriority}
                  disabled={updating}
                  onChange={(event) =>
                    setEditingPriority(event.target.value as TaskPriority)
                  }
                >
                  <option value="low">低优先级</option>
                  <option value="normal">普通优先级</option>
                  <option value="high">高优先级</option>
                  <option value="urgent">紧急</option>
                </select>

                <NativeDateInput
                  type="datetime-local"
                  value={editingDueTime}
                  disabled={updating}
                  onChange={(event) => {
                    setEditingDueTime(event.target.value);
                    setActionError("");
                  }}
                />

                <input
                  placeholder="时区"
                  value={editingTimezone}
                  disabled={updating}
                  onChange={(event) => {
                    setEditingTimezone(event.target.value);
                    setActionError("");
                  }}
                />

                <input
                  placeholder="标签，用逗号分隔（可选）"
                  value={editingTags}
                  disabled={updating}
                  onChange={(event) => {
                    setEditingTags(event.target.value);
                    setActionError("");
                  }}
                />

                <button
                  className="secondary-button"
                  disabled={updating || updateInvalid}
                  onClick={handleUpdate}
                >
                  {updating ? "保存中…" : "保存修改"}
                </button>

                <button
                  className="secondary-button"
                  disabled={updating}
                  onClick={() => {
                    setEditing(false);
                    setActionError("");
                  }}
                >
                  取消
                </button>
              </>
            ) : (
              <>
                <div className="memory-card-topline">
              <span>
                {statusLabels[selectedTask.status]}
              </span>
  
              <span>
                优先级：{priorityLabels[selectedTask.priority]}
              </span>
                </div>
  
                <h2>{selectedTask.title}</h2>
                <p>{selectedTask.description}</p>
  
                <p>
              截止时间：
              {formatDueTime(
                selectedTask.due_time,
                selectedTask.timezone,
              )}
                </p>
  
                <p>时区：{selectedTask.timezone}</p>
  
                {selectedTask.tags.length > 0 && (
              <p>
                {selectedTask.tags
                  .map((tag) => `#${tag}`)
                  .join(" ")}
              </p>
                )}
  
                {selectedTask.completed_at && (
              <p>
                完成时间：
                {formatDueTime(
                  selectedTask.completed_at,
                  selectedTask.timezone,
                )}
              </p>
                )}

                <button
                  className="secondary-button"
                  disabled={updatingStatus}
                  onClick={() => beginEditing(selectedTask)}
                >
                  编辑任务
                </button>

                {taskActions.includes("start") && (
                  <button
                    className="secondary-button"
                    disabled={updatingStatus}
                    onClick={() => handleUpdateStatus("in_progress")}
                  >
                    {updatingStatus ? "处理中…" : "开始任务"}
                  </button>
                )}

                {taskActions.includes("complete") && (
                  <button
                    className="secondary-button"
                    disabled={updatingStatus}
                    onClick={() => handleUpdateStatus("completed")}
                  >
                    {updatingStatus ? "处理中…" : "完成任务"}
                  </button>
                )}

                {taskActions.includes("cancel") && (
                  <button
                    className="secondary-button"
                    disabled={updatingStatus}
                    onClick={() => handleUpdateStatus("cancelled")}
                  >
                    {updatingStatus ? "处理中…" : "取消任务"}
                  </button>
                )}

              <button
                className="secondary-button"
                disabled={updatingStatus}
                onClick={handleCloseTask}
              >
                返回任务列表
              </button>
              </>
            )}
          </section>
        ) : (
          <>
            {showCreate && (
              <section className="memory-message">
                <h2>创建任务</h2>
  
                <input
                  placeholder="任务标题"
                  value={title}
                  disabled={creating}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setActionError("");
                  }}
                />
  
                <textarea
                  placeholder="任务说明"
                  value={description}
                  disabled={creating}
                  onChange={(event) => {
                    setDescription(event.target.value);
                    setActionError("");
                  }}
                />
  
                <select
                  value={priority}
                  disabled={creating}
                  onChange={(event) =>
                    setPriority(
                      event.target.value as TaskPriority,
                    )
                  }
                >
                  <option value="low">低优先级</option>
                  <option value="normal">普通优先级</option>
                  <option value="high">高优先级</option>
                  <option value="urgent">紧急</option>
                </select>
  
                <NativeDateInput
                  type="datetime-local"
                  value={dueTime}
                  disabled={creating}
                  onChange={(event) => {
                    setDueTime(event.target.value);
                    setActionError("");
                  }}
                />
  
                <input
                  placeholder="时区"
                  value={timezone}
                  disabled={creating}
                  onChange={(event) => {
                    setTimezone(event.target.value);
                    setActionError("");
                  }}
                />
  
                <input
                  placeholder="标签，用逗号分隔（可选）"
                  value={tags}
                  disabled={creating}
                  onChange={(event) => {
                    setTags(event.target.value);
                    setActionError("");
                  }}
                />
  
                <button
                  className="secondary-button"
                  disabled={creating || createInvalid}
                  onClick={handleCreate}
                >
                  {creating ? "保存中…" : "保存任务"}
                </button>
              </section>
            )}
  
            {state.status === "ready" &&
              state.tasks.length > 0 && (
                <>
                  <section className="memory-message">
                    <h2>任务列表</h2>
                    <p>
                      共 {state.count} 项，按截止时间排列。
                    </p>
                  </section>
  
                  <section className="memory-grid">
                    {state.tasks.map((task) => (
                      <article
                        className="memory-card"
                        key={task.id}
                      >
                        <div className="memory-card-topline">
                          <span>
                            {statusLabels[task.status]}
                          </span>
  
                          <span>
                            {priorityLabels[task.priority]}
                          </span>
                        </div>
  
                        <h2>{task.title}</h2>
  
                        <p>
                          {task.description.length > 160
                            ? `${task.description.slice(0, 160)}…`
                            : task.description}
                        </p>
  
                        <p>
                          截止：
                          {formatDueTime(
                            task.due_time,
                            task.timezone,
                          )}
                        </p>
  
                        {task.tags.length > 0 && (
                          <p>
                            {task.tags
                              .map((tag) => `#${tag}`)
                              .join(" ")}
                          </p>
                        )}
  
                        <button
                          className="secondary-button"
                          disabled={
                            loadingTaskId.length > 0
                          }
                          onClick={() =>
                            handleReadTask(task.id)
                          }
                        >
                          {loadingTaskId === task.id
                            ? "读取中…"
                            : "查看任务"}
                        </button>
                      </article>
                    ))}
                  </section>
                </>
              )}
  
            {state.status === "ready" &&
              state.tasks.length === 0 && (
                <TaskMessage
                  title={filters.q || filters.status || filters.priority || filters.tag || filters.due ? "没有符合条件的任务" : "还没有任务"}
                  description={filters.q || filters.status || filters.priority || filters.tag || filters.due ? "试试清除搜索或筛选条件。" : "创建第一个任务后，它会显示在这里。"}
                  action={filters.q || filters.status || filters.priority || filters.tag || filters.due ? <button className="secondary-button" onClick={clearFilters}>清除筛选</button> : undefined}
                />
              )}
  
            {state.status === "loading" && <TaskLoading />}
  
            {state.status === "error" && (
              <TaskMessage
                title="暂时无法读取任务"
                description="连接没有完成，请稍后重试。"
                action={
                  <button
                    className="secondary-button"
                    onClick={() =>
                      setReloadKey((value) => value + 1)
                    }
                  >
                    重新加载
                  </button>
                }
              />
            )}
          </>
        )}
      </div>
    );
  }
  
  function TaskLoading() {
    return (
      <section className="memory-grid">
        {[0, 1, 2].map((item) => (
          <div
            className="memory-card memory-card-loading"
            key={item}
          >
            <span />
            <strong />
            <p />
          </div>
        ))}
      </section>
    );
  }
  
  function TaskMessage({
    action,
    description,
    title,
  }: {
    action?: ReactNode;
    description: string;
    title: string;
  }) {
    return (
      <section className="memory-message">
        <div className="placeholder-icon">
          <TaskIcon />
        </div>
  
        <h2>{title}</h2>
        <p>{description}</p>
  
        {action}
      </section>
    );
  }
