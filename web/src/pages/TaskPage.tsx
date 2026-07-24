import {
    useEffect,
    useRef,
    useState,
    type ReactNode,
  } from "react";
  import { useWebApiClient } from "../api/useWebApiClient";
  import { TaskIcon } from "../components/icons";
  import { PageHeader } from "./PageHeader";
  
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
  
  export function TaskPage() {
    const api = useWebApiClient();
    const listScrollPosition = useRef(0);
  
    const [reloadKey, setReloadKey] = useState(0);
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
    const [nextStatus, setNextStatus] =
      useState<TaskStatus>("pending");
  
    const [actionError, setActionError] = useState("");
  
    useEffect(() => {
      let active = true;
  
      setState({
        status: "loading",
      });
  
      api.request<TaskListResponse>("/task")
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
  
      return () => {
        active = false;
      };
    }, [api, reloadKey]);
  
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
        setNextStatus(response.data.status);
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
        setNextStatus(response.data.status);
  
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
      setActionError("");
  
      requestAnimationFrame(() => {
        window.scrollTo({
          top: listScrollPosition.current,
          behavior: "smooth",
        });
      });
    }
  
    async function handleUpdateStatus(
      statusOverride?: TaskStatus,
    ) {
      if (!selectedTask || updatingStatus) {
        return;
      }
  
      const status = statusOverride ?? nextStatus;
  
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
        setNextStatus(response.data.status);
        setReloadKey((value) => value + 1);
      } catch {
        setActionError("修改任务状态失败，请稍后重试。");
      } finally {
        setUpdatingStatus(false);
      }
    }
  
    return (
      <div className="page memory-page">
        <PageHeader
          eyebrow="Focus & execution"
          title="Task"
          description="管理待办事项、截止时间、优先级与完成状态。"
          action={
            selectedTask ? (
              <button
                className="secondary-button"
                disabled={updatingStatus}
                onClick={handleCloseTask}
              >
                返回任务列表
              </button>
            ) : (
              <button
                className="secondary-button"
                disabled={creating}
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
  
        {actionError && (
          <section className="memory-message">
            <h2>操作没有完成</h2>
            <p>{actionError}</p>
          </section>
        )}
  
        {selectedTask ? (
          <section className="memory-message">
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
  
            <select
              value={nextStatus}
              disabled={updatingStatus}
              onChange={(event) =>
                setNextStatus(
                  event.target.value as TaskStatus,
                )
              }
            >
              <option value="pending">待处理</option>
              <option value="in_progress">进行中</option>
              <option value="completed">已完成</option>
              <option value="cancelled">已取消</option>
            </select>
  
            <button
              className="secondary-button"
              disabled={
                updatingStatus ||
                nextStatus === selectedTask.status
              }
              onClick={() => handleUpdateStatus()}
            >
              {updatingStatus ? "保存中…" : "保存状态"}
            </button>
  
            {selectedTask.status !== "completed" && (
              <button
                className="secondary-button"
                disabled={updatingStatus}
                onClick={() =>
                  handleUpdateStatus("completed")
                }
              >
                {updatingStatus ? "完成中…" : "完成任务"}
              </button>
            )}
  
            <button
              className="secondary-button"
              disabled={updatingStatus}
              onClick={handleCloseTask}
            >
              返回任务列表
            </button>
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
  
                <input
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
                  title="还没有任务"
                  description="创建第一个任务后，它会显示在这里。"
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