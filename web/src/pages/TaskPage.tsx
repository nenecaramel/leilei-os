import {
    useEffect,
    useRef,
    useState,
    type ReactNode,
  } from "react";
  import type { WebApiClient } from "../api/useWebApiClient";
  import { TaskIcon } from "../components/icons";
  import { NativeDateInput } from "../components/NativeDateInput";
  import type { SettingsData } from "../settings/types";
  import { PageHeader } from "./PageHeader";
  import { getTaskActionControls } from "./task-actions";
  import { createSubmissionGate } from "./submission-gate";
  import {
    EMPTY_TASK_FILTERS,
    createTaskDetailLocation,
    createTaskArchiveLocation,
    createArchivedTaskDetailLocation,
    getTaskDetailLocation,
    type TaskDueFilter,
  } from "./task-location";
  import {
    buildTaskListRequest,
    cancelLatestTaskRequest,
    createLatestTaskRequestTracker,
    settleLatestTaskRequest,
  } from "./task-list-request";
  import {
    createTaskFilterHistorySnapshot,
    createTaskFilterDebouncer,
    pushTaskFilterHistory,
    readTaskFilterHistorySnapshot,
    subscribeToTaskFilterHistory,
  } from "./task-filter-history";

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

  type TaskEntry = {
    id: string;
    title: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority;
    due_time: string | null;
    timezone: string;
    time_bucket: "no_due_date" | "overdue" | "today" | "next_7_days" | "later";
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

  type DetailLoadState = "idle" | "loading" | "ready" | "error";

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

  function toDateTimeLocal(
    value: string | null,
    timezone: string,
  ): string {
    if (!value) return "";
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
    value: string | null,
    timezone: string,
  ): string {
    if (!value) return "无截止时间";
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
    return readTaskFilterHistorySnapshot(window.location.search);
  }

  function initialTaskLocation() {
    return getTaskDetailLocation(window.location.search);
  }

  export function TaskPageContent({
    api,
    settings,
  }: {
    api: WebApiClient;
    settings: SettingsData;
  }) {
    const listScrollPosition = useRef(0);
    const listRequestTracker = useRef(
      createLatestTaskRequestTracker(),
    );
    const listAbortController = useRef<AbortController | null>(
      null,
    );

    const [reloadKey, setReloadKey] = useState(0);
    const [filters, setFilters] = useState(initialFilters);
    const [searchDraft, setSearchDraft] = useState(
      () => initialFilters().q,
    );
    const [tagDraft, setTagDraft] = useState(
      () => initialFilters().tag,
    );
    const [taskLocation, setTaskLocation] = useState(
      initialTaskLocation,
    );
    const isDetailMode = taskLocation.taskId !== null;
    const isArchivedMode = taskLocation.archived;
    const [detailLoadState, setDetailLoadState] =
      useState<DetailLoadState>(() =>
        initialTaskLocation().taskId ? "loading" : "idle",
      );
    const [state, setState] = useState<LoadState>({
      status: "loading",
    });

    const [showCreate, setShowCreate] = useState(false);
    const [creating, setCreating] = useState(false);
    const createGate = useRef(createSubmissionGate());

    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [priority, setPriority] =
      useState<TaskPriority>("normal");
    const [dueTime, setDueTime] = useState(
      getDefaultDueTime(),
    );
    const [withoutDueTime, setWithoutDueTime] = useState(false);
    const [tags, setTags] = useState("");

    const [selectedTask, setSelectedTask] =
      useState<TaskEntry | null>(null);
    const [loadingTaskId, setLoadingTaskId] =
      useState("");
    const [updatingStatus, setUpdatingStatus] =
      useState(false);
    const [archiving, setArchiving] = useState(false);
    const [restoring, setRestoring] = useState(false);
    const archiveGate = useRef(createSubmissionGate());
    const restoreGate = useRef(createSubmissionGate());
    const statusGate = useRef(createSubmissionGate());
    const [editing, setEditing] = useState(false);
    const [updating, setUpdating] = useState(false);
    const updateGate = useRef(createSubmissionGate());
    const [editingTitle, setEditingTitle] = useState("");
    const [editingDescription, setEditingDescription] = useState("");
    const [editingPriority, setEditingPriority] =
      useState<TaskPriority>("normal");
    const [editingDueTime, setEditingDueTime] = useState("");
    const [editingWithoutDueTime, setEditingWithoutDueTime] = useState(false);
    const [editingTags, setEditingTags] = useState("");

    const [actionError, setActionError] = useState("");
    const filtersRef = useRef(filters);
    filtersRef.current = filters;
    const searchDraftRef = useRef(searchDraft);
    searchDraftRef.current = searchDraft;
    const tagDraftRef = useRef(tagDraft);
    tagDraftRef.current = tagDraft;
    const searchDebouncerRef = useRef<
      ReturnType<typeof createTaskFilterDebouncer> | null
    >(null);
    const tagDebouncerRef = useRef<
      ReturnType<typeof createTaskFilterDebouncer> | null
    >(null);

    if (!searchDebouncerRef.current) {
      searchDebouncerRef.current = createTaskFilterDebouncer({
        delayMs: 300,
        commit: (query) => {
          commitFilters(
            {
              ...filtersRef.current,
              q: query,
              tag: tagDraftRef.current,
            },
            {
              cancelSearch: false,
            },
          );
        },
        setTimeout: window.setTimeout.bind(window),
        clearTimeout: window.clearTimeout.bind(window),
      });
    }

    if (!tagDebouncerRef.current) {
      tagDebouncerRef.current = createTaskFilterDebouncer({
        delayMs: 300,
        commit: (tag) => {
          commitFilters(
            {
              ...filtersRef.current,
              q: searchDraftRef.current,
              tag,
            },
            {
              cancelTag: false,
            },
          );
        },
        setTimeout: window.setTimeout.bind(window),
        clearTimeout: window.clearTimeout.bind(window),
      });
    }

    useEffect(() => {
      return subscribeToTaskFilterHistory(window, (restoredFilters) => {
        const restoredLocation = initialTaskLocation();
        searchDebouncerRef.current?.cancel();
        tagDebouncerRef.current?.cancel();
        invalidateListRequest();
        setState({ status: "loading" });
        setFilters(restoredFilters);
        setSearchDraft(restoredFilters.q);
        setTagDraft(restoredFilters.tag);
        setSelectedTask(null);
        setEditing(false);
        setActionError("");
        setTaskLocation(restoredLocation);
        setDetailLoadState(
          restoredLocation.taskId ? "loading" : "idle",
        );
      });
    }, []);

    useEffect(
      () => () => {
        searchDebouncerRef.current?.cancel();
        tagDebouncerRef.current?.cancel();
      },
      [],
    );

    useEffect(() => {
      if (isDetailMode) {
        invalidateListRequest();
        return;
      }

      const controller = new AbortController();
      listAbortController.current = controller;
      const requestTicket = listRequestTracker.current.begin();
      const request = isArchivedMode
        ? { url: "/task/archived" }
        : buildTaskListRequest(filters);
      setState({
        status: "loading",
      });
      void settleLatestTaskRequest({
        request: api.request<TaskListResponse>(request.url, {
          signal: controller.signal,
        }),
        ticket: requestTicket,
        signal: controller.signal,
        onSuccess: (response) => {
          setState({
            status: "ready",
            tasks: response.data.tasks,
            count: response.data.metadata.count,
          });
        },
        onError: () => {
          setState({ status: "error" });
        },
      }).finally(() => {
        if (listAbortController.current === controller) {
          listAbortController.current = null;
        }
      });

      return () => {
        listRequestTracker.current.invalidate();
        controller.abort();
        if (listAbortController.current === controller) {
          listAbortController.current = null;
        }
      };
    }, [api, reloadKey, filters, isDetailMode, isArchivedMode]);

    useEffect(() => {
      const { taskId } = taskLocation;
      if (!taskId) {
        setSelectedTask(null);
        setEditing(false);
        setDetailLoadState("idle");
        return;
      }

      let active = true;
      setSelectedTask(null);
      setDetailLoadState("loading");
      setLoadingTaskId(taskId);
      setActionError("");

      api.request<TaskEntryResponse>(
        `${isArchivedMode ? "/task/archived/" : "/task/"}${encodeURIComponent(taskId)}`,
      )
        .then((response) => {
          if (!active) return;
          setSelectedTask(response.data);
          setEditing(false);
          setDetailLoadState("ready");
          requestAnimationFrame(() => {
            window.scrollTo({ top: 0, behavior: "smooth" });
          });
        })
        .catch(() => {
          if (!active) return;
          setSelectedTask(null);
          setDetailLoadState("error");
          setActionError("读取任务详情失败，请稍后重试。");
        })
        .finally(() => {
          if (active) setLoadingTaskId("");
        });

      return () => {
        active = false;
      };
    }, [api, taskLocation]);

    function commitFilters(
      nextFilters: typeof filters,
      cancellation: {
        cancelSearch?: boolean;
        cancelTag?: boolean;
      } = {},
    ) {
      if (cancellation.cancelSearch !== false) {
        searchDebouncerRef.current?.cancel();
      }
      if (cancellation.cancelTag !== false) {
        tagDebouncerRef.current?.cancel();
      }
      invalidateListRequest();
      setState({ status: "loading" });
      const snapshot = createTaskFilterHistorySnapshot(nextFilters);
      pushTaskFilterHistory(window, snapshot);
      setFilters(snapshot);
      setSearchDraft(snapshot.q);
      setTagDraft(snapshot.tag);
    }

    function updateSearchDraft(query: string) {
      invalidateListRequest();
      setState({ status: "loading" });
      setSearchDraft(query);
      searchDebouncerRef.current?.schedule(query);
    }

    function updateTagDraft(tag: string) {
      invalidateListRequest();
      setState({ status: "loading" });
      setTagDraft(tag);
      tagDebouncerRef.current?.schedule(tag);
    }

    function invalidateListRequest() {
      cancelLatestTaskRequest(
        listRequestTracker.current,
        listAbortController.current,
      );
      listAbortController.current = null;
    }

    function clearFilters() {
      commitFilters(EMPTY_TASK_FILTERS);
    }

    const createInvalid =
      title.trim().length === 0 ||
      description.trim().length === 0 ||
      (!withoutDueTime && dueTime.trim().length === 0);

    async function handleCreate() {
      if (createInvalid || !createGate.current.enter()) {
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
              dueTime: withoutDueTime ? null : dueTime,
              timezone: settings.timezone,
              tags: parseTags(tags),
            }),
          },
        );

        setTitle("");
        setDescription("");
        setPriority("normal");
        setDueTime(getDefaultDueTime());
        setWithoutDueTime(false);
        setTags("");
        setShowCreate(false);

        setReloadKey((value) => value + 1);
        openTaskDetail(response.data.id);

        requestAnimationFrame(() => {
          window.scrollTo({
            top: 0,
            behavior: "smooth",
          });
        });
      } catch {
        setActionError("创建任务失败，请稍后重试。");
      } finally {
        createGate.current.leave();
        setCreating(false);
      }
    }

    async function handleReadTask(id: string) {
      if (loadingTaskId) {
        return;
      }

      listScrollPosition.current = window.scrollY;
      setActionError("");
      openTaskDetail(id);
    }

    function openTaskDetail(id: string) {
      const returnTo = `${window.location.pathname}${window.location.search}`;
      const detailLocation = createTaskDetailLocation(id, returnTo);
      window.history.pushState(null, "", detailLocation);
      setSelectedTask(null);
      setTaskLocation(initialTaskLocation());
      setDetailLoadState("loading");
    }

    function openArchivedTaskDetail(id: string) {
      const returnTo = `${window.location.pathname}${window.location.search}`;
      window.history.pushState(null, "", createArchivedTaskDetailLocation(id, returnTo));
      setSelectedTask(null);
      setTaskLocation(initialTaskLocation());
      setDetailLoadState("loading");
    }

    async function handleArchiveTask() {
      if (!selectedTask || !archiveGate.current.enter()) return;
      if (!window.confirm(`确定归档“${selectedTask.title}”吗？`)) {
        archiveGate.current.leave();
        return;
      }
      setArchiving(true); setActionError("");
      try {
        await api.request(`/task/${selectedTask.id}`, { method: "DELETE" });
        handleCloseTask();
      } catch { setActionError("归档任务失败，请稍后重试。"); }
      finally { archiveGate.current.leave(); setArchiving(false); }
    }

    async function handleRestoreTask() {
      if (!selectedTask || !restoreGate.current.enter()) return;
      setRestoring(true); setActionError("");
      try {
        await api.request(`/task/archived/${selectedTask.id}/restore`, { method: "POST" });
        returnToActiveTaskList(taskLocation.activeReturnTo);
      } catch { setActionError("恢复任务失败，请稍后重试。"); }
      finally { restoreGate.current.leave(); setRestoring(false); }
    }

    function returnToActiveTaskList(
      returnTo: string,
      restoreScroll = false,
    ) {
      window.history.pushState(null, "", returnTo);
      const restoredFilters = readTaskFilterHistorySnapshot(
        new URL(returnTo, window.location.origin).search,
      );
      setFilters(restoredFilters);
      setSearchDraft(restoredFilters.q);
      setTagDraft(restoredFilters.tag);
      setSelectedTask(null);
      setEditing(false);
      setActionError("");
      setTaskLocation(initialTaskLocation());
      setDetailLoadState("idle");
      setState({ status: "loading" });

      if (restoreScroll) {
        requestAnimationFrame(() => {
          window.scrollTo({
            top: listScrollPosition.current,
            behavior: "smooth",
          });
        });
      }
    }

    function returnToArchivedTaskList(returnTo: string) {
      window.history.pushState(null, "", returnTo);
      setSelectedTask(null);
      setEditing(false);
      setActionError("");
      setTaskLocation(initialTaskLocation());
      setDetailLoadState("idle");
      setState({ status: "loading" });
    }

    function handleCloseTask() {
      if (isArchivedMode) {
        returnToArchivedTaskList(taskLocation.returnTo);
      } else {
        returnToActiveTaskList(taskLocation.returnTo, true);
      }
    }

    function beginEditing(task: TaskEntry) {
      setEditing(true);
      setEditingTitle(task.title);
      setEditingDescription(task.description);
      setEditingPriority(task.priority);
      setEditingDueTime(toDateTimeLocal(task.due_time, task.timezone));
      setEditingWithoutDueTime(task.due_time === null);
      setEditingTags(task.tags.join(", "));
      setActionError("");
    }

    const updateInvalid =
      editingTitle.trim().length === 0 ||
      editingDescription.trim().length === 0 ||
      (!editingWithoutDueTime && editingDueTime.trim().length === 0);

    const taskActions = selectedTask
      ? getTaskActionControls(selectedTask.allowed_actions)
      : [];

    async function handleUpdateStatus(status: TaskStatus) {
      if (!selectedTask || !statusGate.current.enter()) {
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
        statusGate.current.leave();
        setUpdatingStatus(false);
      }
    }

    async function handleUpdate() {
      if (!selectedTask || updateInvalid || !updateGate.current.enter()) {
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
              dueTime: editingWithoutDueTime ? null : editingDueTime,
              timezone: settings.timezone,
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
        updateGate.current.leave();
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
            isDetailMode && isArchivedMode ? (
              <button className="secondary-button" disabled={restoring} onClick={() => {
                returnToArchivedTaskList(taskLocation.returnTo);
              }}>返回归档列表</button>
            ) : isDetailMode ? (
              <button
                className="secondary-button"
                disabled={updatingStatus || updating}
                onClick={handleCloseTask}
              >
                返回任务列表
              </button>
            ) : isArchivedMode ? (
              <button className="secondary-button" onClick={() => {
                returnToActiveTaskList(taskLocation.returnTo);
              }}>返回任务列表</button>
            ) : (
              <div className="page-header-actions">
                <button className="secondary-button" disabled={creating || updating} onClick={() => {
                  window.history.pushState(null, "", createTaskArchiveLocation(`${window.location.pathname}${window.location.search}`));
                  setTaskLocation(initialTaskLocation());
                }}>查看归档</button>
                <button className="secondary-button" disabled={creating || updating} onClick={() => {
                  setShowCreate((value) => !value); setActionError("");
                }}>{showCreate ? "取消新增" : "新增任务"}</button>
              </div>
            )
          }
        />
        {!isDetailMode && !isArchivedMode && (
          <section className="memory-message task-filters">
            <h2>搜索与筛选</h2>
            <input aria-label="搜索任务" placeholder="搜索任务标题或内容" value={searchDraft} onChange={(event) => updateSearchDraft(event.target.value)} />
            <select aria-label="状态筛选" value={filters.status} onChange={(event) => commitFilters({ ...filters, q: searchDraft, tag: tagDraft, status: event.target.value })}>
              <option value="">全部状态</option><option value="pending">待处理</option><option value="in_progress">进行中</option><option value="completed">已完成</option><option value="cancelled">已取消</option>
            </select>
            <select aria-label="优先级筛选" value={filters.priority} onChange={(event) => commitFilters({ ...filters, q: searchDraft, tag: tagDraft, priority: event.target.value })}>
              <option value="">全部优先级</option><option value="low">低</option><option value="normal">普通</option><option value="high">高</option><option value="urgent">紧急</option>
            </select>
            <input aria-label="标签筛选" placeholder="筛选标签" value={tagDraft} onChange={(event) => updateTagDraft(event.target.value)} />
            <select aria-label="截止时间筛选" value={filters.due} onChange={(event) => commitFilters({ ...filters, q: searchDraft, tag: tagDraft, due: event.target.value as TaskDueFilter, dueFrom: "", dueTo: "" })}>
              <option value="">全部时间</option><option value="no_due_date">无截止时间</option><option value="overdue">已逾期</option><option value="today">今天</option><option value="next_7_days">未来七天</option><option value="custom">自定义范围</option>
            </select>
            {filters.due === "custom" && <><NativeDateInput aria-label="开始日期" type="datetime-local" value={filters.dueFrom} onChange={(event) => commitFilters({ ...filters, q: searchDraft, tag: tagDraft, dueFrom: event.target.value })} /><NativeDateInput aria-label="结束日期" type="datetime-local" value={filters.dueTo} onChange={(event) => commitFilters({ ...filters, q: searchDraft, tag: tagDraft, dueTo: event.target.value })} /></>}
            <button className="secondary-button" onClick={clearFilters}>清除全部</button>
          </section>
        )}

        {actionError && (
          <section className="memory-message">
            <h2>操作没有完成</h2>
            <p>{actionError}</p>
          </section>
        )}

        {isDetailMode ? (
          selectedTask ? (
          <section className="memory-message">
            {editing && !isArchivedMode ? (
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

                <div className="task-due-field">
                  <NativeDateInput
                    type="datetime-local"
                    value={editingDueTime}
                    disabled={updating || editingWithoutDueTime}
                    onChange={(event) => {
                      setEditingDueTime(event.target.value);
                      setActionError("");
                    }}
                  />

                  <label className="task-no-due-control">
                    <input
                      type="checkbox"
                      checked={editingWithoutDueTime}
                      disabled={updating}
                      onChange={(event) => {
                        setEditingWithoutDueTime(event.target.checked);
                        setActionError("");
                      }}
                    />
                    <span>无截止时间</span>
                  </label>
                </div>

                <p>
                  当前账户时区：{settings.timezone}
                </p>

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

                {!isArchivedMode && <button
                  className="secondary-button"
                  disabled={updatingStatus}
                  onClick={() => beginEditing(selectedTask)}
                >
                  编辑任务
                </button>}

                {!isArchivedMode && taskActions.includes("start") && (
                  <button
                    className="secondary-button"
                    disabled={updatingStatus}
                    onClick={() => handleUpdateStatus("in_progress")}
                  >
                    {updatingStatus ? "处理中…" : "开始任务"}
                  </button>
                )}

                {!isArchivedMode && taskActions.includes("complete") && (
                  <button
                    className="secondary-button"
                    disabled={updatingStatus}
                    onClick={() => handleUpdateStatus("completed")}
                  >
                    {updatingStatus ? "处理中…" : "完成任务"}
                  </button>
                )}

                {!isArchivedMode && taskActions.includes("cancel") && (
                  <button
                    className="secondary-button"
                    disabled={updatingStatus}
                    onClick={() => handleUpdateStatus("cancelled")}
                  >
                    {updatingStatus ? "处理中…" : "取消任务"}
                  </button>
                )}

              {!isArchivedMode && (
                <button className="secondary-button" disabled={updatingStatus || archiving} onClick={() => void handleArchiveTask()}>
                  {archiving ? "归档中…" : "归档"}
                </button>
              )}

              {isArchivedMode && (
                <button className="secondary-button" disabled={restoring} onClick={() => void handleRestoreTask()}>
                  {restoring ? "恢复中…" : "恢复"}
                </button>
              )}

              <button
                className="secondary-button"
                disabled={updatingStatus}
                onClick={handleCloseTask}
              >
                {isArchivedMode ? "返回归档列表" : "返回任务列表"}
              </button>
              </>
            )}
          </section>
          ) : detailLoadState === "loading" ? (
            <TaskDetailLoading />
          ) : null
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

                <div className="task-due-field">
                  <NativeDateInput
                    type="datetime-local"
                    value={dueTime}
                    disabled={creating || withoutDueTime}
                    onChange={(event) => {
                      setDueTime(event.target.value);
                      setActionError("");
                    }}
                  />

                  <label className="task-no-due-control">
                    <input
                      type="checkbox"
                      checked={withoutDueTime}
                      disabled={creating}
                      onChange={(event) => {
                        setWithoutDueTime(event.target.checked);
                        setActionError("");
                      }}
                    />
                    <span>无截止时间</span>
                  </label>
                </div>

                <p>
                  当前账户时区：{settings.timezone}
                </p>

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
                    <h2>{isArchivedMode ? "已归档任务" : "任务列表"}</h2>
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
                          onClick={() => isArchivedMode ? openArchivedTaskDetail(task.id) : handleReadTask(task.id)}
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
                  title={isArchivedMode ? "还没有归档任务" : filters.q || filters.status || filters.priority || filters.tag || filters.due ? "没有符合条件的任务" : "还没有任务"}
                  description={isArchivedMode ? "归档的任务会显示在这里。" : filters.q || filters.status || filters.priority || filters.tag || filters.due ? "试试清除搜索或筛选条件。" : "创建第一个任务后，它会显示在这里。"}
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

  function TaskDetailLoading() {
    return (
      <section
        aria-label="任务详情加载中"
        className="memory-message"
      >
        <h2>正在读取任务详情…</h2>
        <p>任务内容准备好后会显示在这里。</p>
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
