import {
    useEffect,
    useRef,
    useState,
    Fragment,
    type ReactNode,
    type RefObject,
  } from "react";
  import type { WebApiClient } from "../api/useWebApiClient";
  import { TaskIcon } from "../components/icons";
  import { ModuleSearchStateMessage } from "../components/ModuleSearch";
  import { NativeDateInput } from "../components/NativeDateInput";
  import { PageHeader as LegacyPageHeader } from "./PageHeader";
  import {
    PaperAuthorSignature,
    type PaperAuthorValue,
  } from "./PaperAuthorSignature";
  import { PaperDetailDialog } from "./PaperDetailDialog";
  import { TaskPageHeader } from "./TaskPageHeader";
  import { TaskDeadlineEditor, TaskPaperEditor, TaskPaperMetadataEditor, TaskPaperMetadataRead, type TaskPaperAction, type TaskPaperEditorHandle } from "./TaskPaperEditor";
  import { formatTaskPaperDeadline, formatTaskPaperTimestamp, formatTaskRowDeadline, formatTaskRowMeta, groupTasksForMobile } from "./task-mobile-presentation";
  import { isSearchLocation, navigateWithinApp } from "./app-navigation";
  import { consumeQuickCreateTarget } from "./quick-create";
  import { getTaskActionControls } from "./task-actions";
  import {
    confirmUnsavedChanges,
    createMutationOwnership,
    createSubmissionGate,
  } from "./submission-gate";
  import { useUnsavedChanges } from "./use-unsaved-changes";
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

  type TaskAction = "start" | "complete" | "cancel" | "reopen";

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
    author: PaperAuthorValue;
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
  const TASK_TIMEZONE = "Asia/Shanghai";

  function initialFilters() {
    return readTaskFilterHistorySnapshot(window.location.search);
  }

  function initialTaskLocation() {
    return getTaskDetailLocation(window.location.search);
  }

  export function TaskPageContent({
    api,
  }: {
    api: WebApiClient;
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
    const [detailReloadKey, setDetailReloadKey] = useState(0);
    const [state, setState] = useState<LoadState>({
      status: "loading",
    });

    const [showCreate, setShowCreate] = useState(false);
    const [creating, setCreating] = useState(false);
    const createTitleInput = useRef<HTMLInputElement | null>(null);
    const createPaperEditorRef = useRef<TaskPaperEditorHandle | null>(null);
    const paperTriggerRef = useRef<HTMLElement | null>(null);
    const focusCreateRef = useRef(false);
    const mutationGate = useRef(createSubmissionGate());
    const mutationOwnership = useRef(createMutationOwnership());

    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [priority, setPriority] =
      useState<TaskPriority>("normal");
    const [dueTime, setDueTime] = useState(
      getDefaultDueTime(),
    );
    const [withoutDueTime, setWithoutDueTime] = useState(true);
    const [tags, setTags] = useState("");
    const [author, setAuthor] = useState<PaperAuthorValue>(null);

    const [selectedTask, setSelectedTask] =
      useState<TaskEntry | null>(null);
    const [loadingTaskId, setLoadingTaskId] =
      useState("");
    const [updatingStatus, setUpdatingStatus] =
      useState(false);
    const [archiving, setArchiving] = useState(false);
    const [restoring, setRestoring] = useState(false);
    const [permanentDeleteConfirmId, setPermanentDeleteConfirmId] = useState("");
    const [permanentDeletingId, setPermanentDeletingId] = useState("");
    const [editing, setEditing] = useState(false);
    const [updating, setUpdating] = useState(false);
    const [editingTitle, setEditingTitle] = useState("");
    const [editingDescription, setEditingDescription] = useState("");
    const [editingPriority, setEditingPriority] =
      useState<TaskPriority>("normal");
    const [editingDueTime, setEditingDueTime] = useState("");
    const [editingWithoutDueTime, setEditingWithoutDueTime] = useState(false);
    const [editingTags, setEditingTags] = useState("");
    const [editingAuthor, setEditingAuthor] = useState<PaperAuthorValue>(null);

    const initialDueTime = useRef(dueTime);
    const createDirty = showCreate && (
      title !== "" || description !== "" || priority !== "normal" ||
      !withoutDueTime || tags !== "" || author !== null
    );
    const editDirty = Boolean(selectedTask && editing && (
      editingTitle !== selectedTask.title ||
      editingDescription !== selectedTask.description ||
      editingPriority !== selectedTask.priority ||
      editingDueTime !== toDateTimeLocal(selectedTask.due_time, selectedTask.timezone) ||
      editingWithoutDueTime !== (selectedTask.due_time === null) ||
      editingTags !== selectedTask.tags.join(", ") ||
      editingAuthor !== selectedTask.author
    ));
    const createDirtyRef = useRef(false);
    const editDirtyRef = useRef(false);
    createDirtyRef.current = createDirty;
    editDirtyRef.current = editDirty;
    const dirtyRef = useRef(false);
    dirtyRef.current = createDirty || editDirty;
    const currentUrlRef = useRef(
      `${window.location.pathname}${window.location.search}`,
    );
    currentUrlRef.current = `${window.location.pathname}${window.location.search}`;
    useUnsavedChanges(createDirty || editDirty);

    useEffect(() => {
      const hasIntent = consumeQuickCreateTarget("task");
      if (!hasIntent || isDetailMode || isArchivedMode || showCreate || dirtyRef.current) return;
      if (hasIntent) {
        focusCreateRef.current = true;
        setShowCreate(true);
        setActionError("");
      }
    }, [isDetailMode, isArchivedMode, showCreate]);

    useEffect(() => {
      if (!showCreate || !focusCreateRef.current) return;
      focusCreateRef.current = false;
      (window.requestAnimationFrame ?? ((callback: FrameRequestCallback) => window.setTimeout(callback, 0)))(() => {
        createPaperEditorRef.current?.focusTitle();
        if (!createPaperEditorRef.current) createTitleInput.current?.focus();
      });
    }, [showCreate]);

    function discardDraft(): void {
      if (createDirtyRef.current) {
        const nextDueTime = getDefaultDueTime();
        initialDueTime.current = nextDueTime;
        setTitle("");
        setDescription("");
        setPriority("normal");
        setDueTime(nextDueTime);
        setWithoutDueTime(true);
        setTags("");
        setAuthor(null);
        setShowCreate(false);
      }
      if (editDirtyRef.current) {
        setEditing(false);
        setEditingTitle("");
        setEditingDescription("");
        setEditingPriority("normal");
        setEditingDueTime("");
        setEditingWithoutDueTime(false);
        setEditingTags("");
        setEditingAuthor(null);
      }
    }

    function confirmAndDiscardDraft(): boolean {
      if (!confirmUnsavedChanges(
        dirtyRef.current,
        window.confirm.bind(window),
      )) return false;
      if (dirtyRef.current) discardDraft();
      return true;
    }

    function invalidateMutationContext(clearUi = true): void {
      mutationOwnership.current.invalidate();
      if (clearUi) {
        setCreating(false);
        setUpdating(false);
        setUpdatingStatus(false);
        setArchiving(false);
        setRestoring(false);
      }
    }

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
        if (!confirmAndDiscardDraft()) {
          window.history.pushState(null, "", currentUrlRef.current);
          return;
        }
        invalidateMutationContext();
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
        setEditingAuthor(null);
        setActionError("");
        setTaskLocation(restoredLocation);
        setDetailLoadState(
          restoredLocation.taskId ? "loading" : "idle",
        );
      });
    }, []);

    useEffect(
      () => () => {
        invalidateMutationContext(false);
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
        setEditingAuthor(null);
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
          setEditingAuthor(null);
          setDetailLoadState("ready");
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
    }, [api, taskLocation, detailReloadKey]);

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
      if (createInvalid) {
        return;
      }
      if (author === null) {
        setActionError("请选择作者");
        return;
      }
      if (!mutationGate.current.enter()) return;

      const ticket = mutationOwnership.current.begin();

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
              timezone: TASK_TIMEZONE,
              tags: parseTags(tags),
              author,
            }),
          },
        );

        if (!mutationOwnership.current.owns(ticket)) return;
        setTitle("");
        setDescription("");
        setPriority("normal");
        const nextDueTime = getDefaultDueTime();
        initialDueTime.current = nextDueTime;
        setDueTime(nextDueTime);
        setWithoutDueTime(true);
        setTags("");
        setAuthor(null);
        setShowCreate(false);

        setReloadKey((value) => value + 1);
        openTaskDetail(response.data.id, true);

        requestAnimationFrame(() => {
          window.scrollTo({
            top: 0,
            behavior: "smooth",
          });
        });
      } catch {
        if (mutationOwnership.current.owns(ticket)) {
          setActionError("创建任务失败，请稍后重试。");
        }
      } finally {
        mutationGate.current.leave();
        if (mutationOwnership.current.owns(ticket)) setCreating(false);
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

    function openTaskDetail(id: string, skipSafety = false) {
      if (!skipSafety && !confirmAndDiscardDraft()) return;
      if (!skipSafety) invalidateMutationContext();
      const returnTo = `${window.location.pathname}${window.location.search}`;
      const detailLocation = createTaskDetailLocation(id, returnTo);
      window.history.pushState(null, "", detailLocation);
      setSelectedTask(null);
      setTaskLocation(initialTaskLocation());
      setDetailLoadState("loading");
    }

    function openArchivedTaskDetail(id: string) {
      setPermanentDeleteConfirmId("");
      setPermanentDeletingId("");
      const returnTo = `${window.location.pathname}${window.location.search}`;
      window.history.pushState(null, "", createArchivedTaskDetailLocation(id, returnTo));
      setSelectedTask(null);
      setTaskLocation(initialTaskLocation());
      setDetailLoadState("loading");
    }

    async function handleArchiveTask() {
      if (!selectedTask || !mutationGate.current.enter()) return;
      if (!window.confirm(`确定归档“${selectedTask.title}”吗？`)) {
        mutationGate.current.leave();
        return;
      }
      const ticket = mutationOwnership.current.begin();
      setArchiving(true); setActionError("");
      try {
        await api.request(`/task/${selectedTask.id}`, { method: "DELETE" });
        if (mutationOwnership.current.owns(ticket)) handleCloseTask(true);
      } catch {
        if (mutationOwnership.current.owns(ticket)) setActionError("归档任务失败，请稍后重试。");
      }
      finally {
        mutationGate.current.leave();
        if (mutationOwnership.current.owns(ticket)) setArchiving(false);
      }
    }

    async function handleRestoreTask() {
      if (!selectedTask || !mutationGate.current.enter()) return;
      const ticket = mutationOwnership.current.begin();
      setRestoring(true); setActionError("");
      try {
        await api.request(`/task/archived/${selectedTask.id}/restore`, { method: "POST" });
        if (mutationOwnership.current.owns(ticket)) returnToActiveTaskList(taskLocation.activeReturnTo);
      } catch {
        if (mutationOwnership.current.owns(ticket)) setActionError("恢复任务失败，请稍后重试。");
      }
      finally {
        mutationGate.current.leave();
        if (mutationOwnership.current.owns(ticket)) setRestoring(false);
      }
    }

    async function handlePermanentDeleteTask() {
      if (!selectedTask || !permanentDeleteConfirmId || !mutationGate.current.enter()) return;
      const ticket = mutationOwnership.current.begin();
      setPermanentDeletingId(selectedTask.id);
      setActionError("");
      try {
        await api.request(`/task/archived/${encodeURIComponent(selectedTask.id)}/permanent`, { method: "DELETE" });
        if (mutationOwnership.current.owns(ticket)) {
          setPermanentDeleteConfirmId("");
          setPermanentDeletingId("");
          setReloadKey((value) => value + 1);
          handleCloseTask(true);
        }
      } catch {
        if (mutationOwnership.current.owns(ticket)) setActionError("永久删除任务失败，请稍后重试。");
      } finally {
        mutationGate.current.leave();
        if (mutationOwnership.current.owns(ticket)) setPermanentDeletingId("");
      }
    }

    function returnToActiveTaskList(
      returnTo: string,
      restoreScroll = false,
    ) {
      if (isSearchLocation(returnTo)) {
        navigateWithinApp(returnTo, window.history.state, { resetScroll: false });
        return;
      }
      window.history.pushState(null, "", returnTo);
      const restoredFilters = readTaskFilterHistorySnapshot(
        new URL(returnTo, window.location.origin).search,
      );
      setFilters(restoredFilters);
      setSearchDraft(restoredFilters.q);
      setTagDraft(restoredFilters.tag);
      setSelectedTask(null);
      setEditing(false);
      setEditingAuthor(null);
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
      if (isSearchLocation(returnTo)) {
        navigateWithinApp(returnTo, window.history.state, { resetScroll: false });
        return;
      }
      window.history.pushState(null, "", returnTo);
      setSelectedTask(null);
      setPermanentDeleteConfirmId("");
      setPermanentDeletingId("");
      setEditing(false);
      setEditingAuthor(null);
      setActionError("");
      setTaskLocation(initialTaskLocation());
      setDetailLoadState("idle");
      setState({ status: "loading" });
    }

    function handleCloseTask(skipSafety = false) {
      if (!skipSafety && !confirmAndDiscardDraft()) return;
      if (!skipSafety) invalidateMutationContext();
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
      setEditingAuthor(task.author ?? null);
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
      if (!selectedTask || !mutationGate.current.enter()) {
        return;
      }

      const ticket = mutationOwnership.current.begin();

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

        if (!mutationOwnership.current.owns(ticket)) return;
        setSelectedTask(response.data);
        setReloadKey((value) => value + 1);
      } catch {
        if (mutationOwnership.current.owns(ticket)) {
          setActionError("任务状态无法这样变更，请刷新后重试。");
        }
      } finally {
        mutationGate.current.leave();
        if (mutationOwnership.current.owns(ticket)) setUpdatingStatus(false);
      }
    }

    async function handleReopenTask(taskOverride?: Pick<TaskEntry, "id">) {
      const target = taskOverride ?? selectedTask;
      if (!target || !mutationGate.current.enter()) return;
      const listSnapshot = {
        location: `${window.location.pathname}${window.location.search}`,
        historyState: window.history.state,
        scrollY: window.scrollY,
      };
      const statusFilter = filters.status;
      const ticket = mutationOwnership.current.begin();
      setUpdatingStatus(true);
      setActionError("");
      try {
        const response = await api.request<TaskEntryResponse>(
          `/task/${target.id}/reopen`,
          { method: "POST" },
        );
        if (!mutationOwnership.current.owns(ticket)) return;
        if (!taskOverride) {
          setSelectedTask(response.data);
          return;
        }

        if (
          `${window.location.pathname}${window.location.search}` !== listSnapshot.location ||
          window.history.state !== listSnapshot.historyState
        ) {
          return;
        }

        setState((current) => {
          if (current.status !== "ready") return current;
          const stillMatchesStatus =
            statusFilter.length === 0 || response.data.status === statusFilter;
          const taskWasVisible = current.tasks.some(
            (task) => task.id === response.data.id,
          );
          return {
            status: "ready",
            tasks: stillMatchesStatus
              ? current.tasks.map((task) =>
                  task.id === response.data.id ? response.data : task,
                )
              : current.tasks.filter((task) => task.id !== response.data.id),
            count: stillMatchesStatus
              ? current.count
              : Math.max(0, current.count - (taskWasVisible ? 1 : 0)),
          };
        });
        requestAnimationFrame(() => {
          if (
            `${window.location.pathname}${window.location.search}` === listSnapshot.location &&
            window.history.state === listSnapshot.historyState
          ) {
            window.scrollTo({
              top: listSnapshot.scrollY,
              left: 0,
              behavior: "auto",
            });
          }
        });
      } catch {
        if (mutationOwnership.current.owns(ticket)) {
          setActionError("恢复任务失败，请稍后重试。");
        }
      } finally {
        mutationGate.current.leave();
        if (mutationOwnership.current.owns(ticket)) setUpdatingStatus(false);
      }
    }

    async function handleUpdate() {
      if (!selectedTask || updateInvalid) {
        return;
      }
      if (editingAuthor === null) {
        setActionError("请选择作者");
        return;
      }
      if (!mutationGate.current.enter()) return;

      const ticket = mutationOwnership.current.begin();

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
              timezone: TASK_TIMEZONE,
              tags: parseTags(editingTags),
              author: editingAuthor,
            }),
          },
        );

        if (!mutationOwnership.current.owns(ticket)) return;
        setSelectedTask(response.data);
        setEditing(false);
        setEditingAuthor(response.data.author ?? null);
        setReloadKey((value) => value + 1);
      } catch {
        if (mutationOwnership.current.owns(ticket)) {
          setActionError("保存任务修改失败，请检查输入后重试。");
        }
      } finally {
        mutationGate.current.leave();
        if (mutationOwnership.current.owns(ticket)) setUpdating(false);
      }
    }


    const usePaperPresentation = typeof window !== "undefined";
    if (usePaperPresentation) {
      const desktopPage = !window.matchMedia || !window.matchMedia("(max-width: 760px)").matches;
      const busy = creating || updating || updatingStatus || archiving || restoring;
      const hasFilters = Boolean(filters.q || filters.status || filters.priority || filters.tag || filters.due);
      const backgroundAvailable = !isDetailMode || state.status === "ready";
      const runStatusAction = (action: TaskPaperAction) => {
        if (editing || updatingStatus) return;
        if (action === "reopen") { void handleReopenTask(); return; }
        const next: Record<Exclude<TaskPaperAction, "reopen">, TaskStatus> = { start: "in_progress", complete: "completed", cancel: "cancelled" };
        void handleUpdateStatus(next[action]);
      };
      const openArchive = (trigger: HTMLElement) => {
        if (!confirmAndDiscardDraft()) return;
        paperTriggerRef.current = trigger;
        invalidateMutationContext();
        window.history.pushState(null, "", createTaskArchiveLocation(`${window.location.pathname}${window.location.search}`));
        setSelectedTask(null); setEditing(false); setEditingAuthor(null); setActionError(""); setTaskLocation(initialTaskLocation()); setDetailLoadState("idle");
      };
      return <div className="page memory-page task-page">
        {!isArchivedMode ? <>
          {backgroundAvailable ? <>
            <TaskPageHeader count={state.status === "ready" ? state.count : 0} due={filters.due} dueFrom={filters.dueFrom} dueTo={filters.dueTo} status={filters.status} tagDraft={tagDraft} searchDraft={searchDraft} busy={busy}
              onDueChange={(due) => commitFilters({ ...filters, q: searchDraft, tag: tagDraft, due, dueFrom: "", dueTo: "" })}
              onDueRangeChange={(dueFrom, dueTo) => commitFilters({ ...filters, q: searchDraft, tag: tagDraft, due: dueFrom || dueTo ? "custom" : "", dueFrom, dueTo })}
              onStatusChange={(status) => commitFilters({ ...filters, q: searchDraft, tag: tagDraft, status })}
              onTagChange={updateTagDraft} onSearchChange={updateSearchDraft} onOpenArchive={openArchive}
              onCreate={(trigger) => { paperTriggerRef.current = trigger; if (showCreate) { if (!confirmAndDiscardDraft()) return; invalidateMutationContext(); setShowCreate(false); } else { focusCreateRef.current = true; setShowCreate(true); } setActionError(""); }} />
            {desktopPage ? <p className="desktop-page-description">管理待办事项、截止时间与完成状态。</p> : null}
            {actionError && !isDetailMode && !showCreate ? <section className="memory-action-notice" role="status">{actionError}</section> : null}
            {state.status === "ready" ? state.tasks.length ? <MobileTaskRows tasks={state.tasks} busy={busy} label="Task 列表" onOpen={(id, trigger) => { paperTriggerRef.current = trigger; void handleReadTask(id); }} onReopen={(task) => void handleReopenTask(task)} /> : filters.q ? <ModuleSearchStateMessage state="empty" placement="module" emptyText="没有符合条件的任务" errorText="" action={<button className="secondary-button memory-empty-clear" onClick={clearFilters}>清除条件</button>} /> : <section className="memory-empty-state"><p>{hasFilters ? "没有符合条件的任务" : "还没有任务"}</p>{hasFilters ? <button className="secondary-button memory-empty-clear" onClick={clearFilters}>清除条件</button> : null}</section> : null}
            {state.status === "loading" ? filters.q ? <ModuleSearchStateMessage state="loading" placement="module" emptyText="" errorText="" loadingText="正在搜索…" /> : <MobileTaskLoading label="Task 加载中" /> : null}
            {state.status === "error" ? filters.q ? <ModuleSearchStateMessage state="error" placement="module" emptyText="" errorText="暂时无法读取任务" retryLabel="重新加载" onRetry={() => setReloadKey((v) => v + 1)} /> : <TaskMessage title="暂时无法读取任务" description="请稍后重试。" role="alert" action={<button className="secondary-button" onClick={() => setReloadKey((v) => v + 1)}>重新加载</button>} /> : null}
          </> : null}
          {showCreate ? <PaperDetailDialog id="task-create-paper" open label="创建 Task" dateLabel={<TaskDeadlineEditor value={dueTime} withoutDueTime={withoutDueTime} disabled={creating} onValueChange={(v) => { setDueTime(v); setActionError(""); }} onWithoutDueTimeChange={(v) => { setWithoutDueTime(v); setActionError(""); }} />} signature="" triggerRef={paperTriggerRef}
            onRequestClose={() => { if (!confirmAndDiscardDraft()) return false; setShowCreate(false); setActionError(""); return true; }}
            topRight={<><button className="memory-paper-control" disabled={creating} onClick={() => { if (!confirmAndDiscardDraft()) return; setShowCreate(false); setActionError(""); }}>取消</button><span>·</span><button className="memory-paper-control" disabled={creating || createInvalid} onClick={() => void handleCreate()}>{creating ? "保存中…" : "保存"}</button></>}
            bottomLeft={<><TaskPaperMetadataEditor status="pending" tagsValue={tags} disabled={creating} onTagsChange={(v) => { setTags(v); setActionError(""); }} /><PaperAuthorSignature value={author} editable disabled={creating} onChange={(value) => { setAuthor(value); setActionError(""); }} error={author === null ? actionError : null} /></>} errorMessage={actionError || null}>
            <TaskPaperEditor ref={createPaperEditorRef} title={title} description={description} disabled={creating} onTitleChange={(v) => { setTitle(v); setActionError(""); }} onDescriptionChange={(v) => { setDescription(v); setActionError(""); }} />
          </PaperDetailDialog> : null}
          {isDetailMode ? <MobileTaskDetail state={detailLoadState} task={selectedTask} triggerRef={paperTriggerRef} errorMessage={actionError || null} editing={editing} updating={updating} updatingStatus={updatingStatus} archiving={archiving} author={editingAuthor} onAuthorChange={(value) => { setEditingAuthor(value); setActionError(""); }} onRetry={() => setDetailReloadKey((value) => value + 1)}
            values={{ title: editingTitle, description: editingDescription, dueTime: editingDueTime, withoutDueTime: editingWithoutDueTime, tags: editingTags }}
            setValues={{ title: (v) => { setEditingTitle(v); setActionError(""); }, description: (v) => { setEditingDescription(v); setActionError(""); }, dueTime: (v) => { setEditingDueTime(v); setActionError(""); }, withoutDueTime: (v) => { setEditingWithoutDueTime(v); setActionError(""); }, tags: (v) => { setEditingTags(v); setActionError(""); } }}
            invalid={updateInvalid} onEdit={beginEditing} onCancel={() => { if (!confirmAndDiscardDraft()) return; invalidateMutationContext(); setEditing(false); setEditingAuthor(null); setActionError(""); }} onSave={() => void handleUpdate()} onArchive={() => void handleArchiveTask()} onStatusAction={runStatusAction}
            onRequestClose={() => { if (!confirmAndDiscardDraft()) return false; handleCloseTask(true); return true; }} /> : null}
        </> : <>
          {!isDetailMode || state.status === "ready" ? <MobileArchivedTaskList state={state} busy={busy} onBack={() => returnToActiveTaskList(taskLocation.returnTo)} onOpen={(id, trigger) => { paperTriggerRef.current = trigger; openArchivedTaskDetail(id); }} onRetry={() => setReloadKey((v) => v + 1)} /> : null}
          {isDetailMode ? <MobileArchivedTaskDetail state={detailLoadState} task={selectedTask} triggerRef={paperTriggerRef} errorMessage={actionError || null} restoring={restoring} confirmingDelete={permanentDeleteConfirmId === selectedTask?.id} deleting={permanentDeletingId === selectedTask?.id} onRestore={() => void handleRestoreTask()} onRequestDelete={() => setPermanentDeleteConfirmId(selectedTask?.id ?? "")} onConfirmDelete={() => void handlePermanentDeleteTask()} onCancelDelete={() => setPermanentDeleteConfirmId("")} onRetry={() => setDetailReloadKey((value) => value + 1)} onRequestClose={() => { if (permanentDeletingId === selectedTask?.id) return false; handleCloseTask(true); return true; }} /> : null}
        </>}
      </div>;
    }

    return (
      <div className="page memory-page">
        <LegacyPageHeader
          eyebrow="Focus & execution"
          title="Task"
          description="管理待办事项、截止时间与完成状态。"
          action={
            isDetailMode && isArchivedMode ? (
              <button className="secondary-button" disabled={restoring || permanentDeletingId === selectedTask?.id} onClick={() => {
                returnToArchivedTaskList(taskLocation.returnTo);
              }}>返回归档列表</button>
            ) : isDetailMode ? (
              <button
                className="secondary-button"
                disabled={updatingStatus || updating}
                onClick={() => handleCloseTask()}
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
                  if (!confirmAndDiscardDraft()) return;
                  invalidateMutationContext();
                  window.history.pushState(null, "", createTaskArchiveLocation(`${window.location.pathname}${window.location.search}`));
                  setTaskLocation(initialTaskLocation());
                }}>查看归档</button>
                <button className="secondary-button" disabled={creating || updating} onClick={() => {
                  if (showCreate) {
                    if (!confirmAndDiscardDraft()) return;
                    invalidateMutationContext();
                    setShowCreate(false);
                  } else {
                    focusCreateRef.current = true;
                    setShowCreate(true);
                  }
                  setActionError("");
                }}>{showCreate ? "取消新建" : "新建任务"}</button>
              </div>
            )
          }
        />
        {!isDetailMode && !isArchivedMode && showCreate && (
          <section className="memory-message">
            <h2>创建任务</h2>
            <input
              ref={createTitleInput}
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
            <p>当前账户时区：{TASK_TIMEZONE}</p>
            <input
              placeholder="标签，用逗号分隔（可选）"
              value={tags}
              disabled={creating}
              onChange={(event) => {
                setTags(event.target.value);
                setActionError("");
              }}
            />
            <PaperAuthorSignature
              value={author}
              editable
              disabled={creating}
              onChange={(value) => {
                setAuthor(value);
                setActionError("");
              }}
              error={author === null ? actionError : null}
            />
            <button className="secondary-button" disabled={creating || createInvalid} onClick={handleCreate}>
              {creating ? "保存中…" : "保存任务"}
            </button>
          </section>
        )}
        {!isDetailMode && !isArchivedMode && (
          <section className="memory-message task-filters">
            <h2>搜索与筛选</h2>
            <input aria-label="搜索任务" placeholder="搜索任务标题或内容" value={searchDraft} onChange={(event) => updateSearchDraft(event.target.value)} />
            <select aria-label="状态筛选" value={filters.status} onChange={(event) => commitFilters({ ...filters, q: searchDraft, tag: tagDraft, status: event.target.value })}>
              <option value="">全部状态</option><option value="pending">待处理</option><option value="in_progress">进行中</option><option value="completed">已完成</option><option value="cancelled">已取消</option>
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
          <section className="memory-action-notice" role="status">{actionError}</section>
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
                  当前账户时区：{TASK_TIMEZONE}
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
                <PaperAuthorSignature
                  value={editingAuthor}
                  editable
                  disabled={updating}
                  onChange={(value) => {
                    setEditingAuthor(value);
                    setActionError("");
                  }}
                  error={editingAuthor === null ? "请选择作者" : null}
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
                    if (!confirmAndDiscardDraft()) return;
                    invalidateMutationContext();
                    setEditing(false);
                    setEditingAuthor(null);
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

                <PaperAuthorSignature
                  value={selectedTask.author}
                  editable={false}
                />

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

                {!isArchivedMode && taskActions.includes("reopen") && (
                  <button
                    className="secondary-button"
                    disabled={updatingStatus}
                    onClick={() => void handleReopenTask()}
                  >
                    {updatingStatus ? "恢复中…" : "恢复任务"}
                  </button>
                )}

              {!isArchivedMode && (
                <button className="secondary-button" disabled={updatingStatus || archiving} onClick={() => void handleArchiveTask()}>
                  {archiving ? "归档中…" : "归档"}
                </button>
              )}

              {isArchivedMode && (
                permanentDeleteConfirmId === selectedTask?.id ? (
                  <>
                    <button className="secondary-button" disabled={permanentDeletingId === selectedTask?.id} onClick={() => setPermanentDeleteConfirmId("")}>取消</button>
                    <button className="secondary-button" disabled={permanentDeletingId === selectedTask?.id} onClick={() => void handlePermanentDeleteTask()}>{permanentDeletingId === selectedTask?.id ? "删除中…" : "确认永久删除"}</button>
                  </>
                ) : (
                  <>
                    <button className="secondary-button" disabled={restoring || permanentDeletingId === selectedTask?.id} onClick={() => void handleRestoreTask()}>
                      {restoring ? "恢复中…" : "恢复"}
                    </button>
                    <button className="secondary-button" disabled={restoring || permanentDeletingId === selectedTask?.id} onClick={() => setPermanentDeleteConfirmId(selectedTask?.id ?? "")}>删除</button>
                  </>
                )
              )}

              <button
                className="secondary-button"
                disabled={updatingStatus || (isArchivedMode && permanentDeletingId === selectedTask?.id)}
                onClick={() => handleCloseTask()}
              >
                {isArchivedMode ? "返回归档列表" : "返回任务列表"}
              </button>
              </>
            )}
          </section>
          ) : detailLoadState === "loading" ? (
            <TaskDetailLoading />
          ) : detailLoadState === "error" ? (
            <section className="memory-message records-state" role="alert">
              <h2>无法读取任务</h2>
              <p>该任务不存在、无权访问或暂时不可用。</p>
              <button className="secondary-button" onClick={() => setDetailReloadKey((value) => value + 1)}>重试</button>
            </section>
          ) : null
        ) : (
          <>
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
                        {!isArchivedMode && task.allowed_actions.includes("reopen") && (
                          <button
                            className="secondary-button"
                            disabled={updatingStatus}
                            onClick={() => void handleReopenTask(task)}
                          >
                            {updatingStatus ? "恢复中…" : "恢复任务"}
                          </button>
                        )}
                      </article>
                    ))}
                  </section>
                </>
              )}

            {state.status === "ready" &&
              state.tasks.length === 0 && (
                filters.q ? <ModuleSearchStateMessage state="empty" placement="module" emptyText="没有符合条件的任务" errorText="" action={<button className="secondary-button memory-empty-clear" onClick={clearFilters}>清除条件</button>} /> : <TaskMessage
                  title={isArchivedMode ? "还没有归档任务" : filters.status || filters.priority || filters.tag || filters.due ? "没有符合条件的任务" : "还没有任务"}
                  description={undefined}
                  action={filters.status || filters.priority || filters.tag || filters.due ? <button className="secondary-button" onClick={clearFilters}>清除条件</button> : undefined}
                />
              )}

            {state.status === "loading" && (filters.q ? <ModuleSearchStateMessage state="loading" placement="module" emptyText="" errorText="" loadingText="正在搜索…" /> : <TaskLoading />)}

            {state.status === "error" && (
              filters.q ? <ModuleSearchStateMessage state="error" placement="module" emptyText="" errorText="暂时无法读取任务" retryLabel="重新加载" onRetry={() => setReloadKey((value) => value + 1)} /> : <TaskMessage
                title="暂时无法读取任务"
                description="请稍后重试。"
                role="alert"
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


function MobileTaskLoading({ label }: { label: string }) {
  return <section className="memory-months" aria-label={label} aria-busy="true"><span className="visually-hidden" role="status" aria-live="polite">正在读取任务…</span>{[0,1].map((i) => <div className="memory-month-skeleton" aria-hidden="true" key={i}><span className="memory-month-skeleton-label" /><div className="memory-month-skeleton-card"><span /><span /></div></div>)}</section>;
}
function MobileTaskRows({ tasks, busy, label, onOpen, onReopen }: { tasks: TaskEntry[]; busy: boolean; label: string; onOpen(id: string, trigger: HTMLElement): void; onReopen?: (task: Pick<TaskEntry, "id">) => void }) {
  const desktopListActions = typeof window !== "undefined" && (!window.matchMedia || !window.matchMedia("(max-width: 760px)").matches);
  return <section className="memory-months task-groups" aria-label={label}>{groupTasksForMobile(tasks).map((group) => <section className={`memory-month-section task-group task-group-${group.key}`} key={group.key}><h2 className="memory-month-label">{group.label}</h2><div className="memory-month-card">{group.tasks.map((task) => <Fragment key={task.id}><button type="button" className="memory-row task-row" data-task-id={task.id} disabled={busy} onClick={(e) => onOpen(task.id, e.currentTarget)}><span className="memory-row-title">{task.title}</span><span className="memory-row-meta"><span>{formatTaskRowDeadline(task)}</span><span>{formatTaskRowMeta(task)}</span></span></button>{desktopListActions && onReopen && task.allowed_actions.includes("reopen") ? <button type="button" className="secondary-button task-row-reopen" disabled={busy} onClick={() => onReopen(task)}>恢复任务</button> : null}</Fragment>)}</div></section>)}</section>;
}
function MobileTaskDetail(props: { state: DetailLoadState; task: TaskEntry | null; triggerRef: RefObject<HTMLElement | null>; errorMessage: string | null; editing: boolean; updating: boolean; updatingStatus: boolean; archiving: boolean; author: PaperAuthorValue; onAuthorChange(value: Exclude<PaperAuthorValue, null>): void; onRetry(): void; values: { title: string; description: string; dueTime: string; withoutDueTime: boolean; tags: string }; setValues: { title(v: string): void; description(v: string): void; dueTime(v: string): void; withoutDueTime(v: boolean): void; tags(v: string): void }; invalid: boolean; onEdit(task: TaskEntry): void; onCancel(): void; onSave(): void; onArchive(): void; onStatusAction(a: TaskPaperAction): void; onRequestClose(): boolean }) {
  if (props.state === "loading") return <PaperDetailDialog id="task-detail-paper" open label="正在读取 Task" dateLabel="" signature="—" triggerRef={props.triggerRef} onRequestClose={props.onRequestClose}><div className="paper-detail-state" role="status" aria-live="polite"><p>正在读取任务…</p></div></PaperDetailDialog>;
  if (props.state === "error" || !props.task) return <PaperDetailDialog id="task-detail-paper" open label="无法读取 Task" dateLabel="" signature="—" triggerRef={props.triggerRef} onRequestClose={props.onRequestClose}><div className="paper-detail-state" role="alert"><p>无法读取任务</p><span>该任务不存在、无权访问或暂时不可用。</span><button type="button" className="memory-paper-control" onClick={props.onRetry}>重试</button></div></PaperDetailDialog>;
  const task = props.task;
  return <PaperDetailDialog id="task-detail-paper" open label={`Task ${task.title}`} signature="" triggerRef={props.triggerRef} errorMessage={props.errorMessage} onRequestClose={props.onRequestClose}
    dateLabel={props.editing ? <TaskDeadlineEditor value={props.values.dueTime} withoutDueTime={props.values.withoutDueTime} disabled={props.updating} onValueChange={props.setValues.dueTime} onWithoutDueTimeChange={props.setValues.withoutDueTime} /> : <button type="button" className="task-paper-deadline-read" aria-label="编辑任务截止时间" disabled={props.updatingStatus || props.archiving} onClick={() => props.onEdit(task)}>{formatTaskPaperDeadline(task.due_time, task.timezone)}</button>}
    topRight={props.editing ? <><button className="memory-paper-control" disabled={props.updating} onClick={props.onCancel}>取消</button><span>·</span><button className="memory-paper-control" disabled={props.updating || props.invalid} onClick={props.onSave}>{props.updating ? "保存中…" : "保存"}</button></> : <><button className="memory-paper-control" disabled={props.archiving || props.updatingStatus} onClick={() => { if (window.confirm(`确定归档“${task.title}”吗？`)) props.onArchive(); }}>{props.archiving ? "归档中…" : "归档"}</button><span>·</span><button className="memory-paper-control" disabled={props.archiving || props.updatingStatus} onClick={() => props.onEdit(task)}>编辑</button></>}
    bottomLeft={props.editing ? <><TaskPaperMetadataEditor status={task.status} tagsValue={props.values.tags} disabled={props.updating} onTagsChange={props.setValues.tags} /><PaperAuthorSignature value={props.author} editable disabled={props.updating} onChange={props.onAuthorChange} error={props.author === null ? "请选择作者" : null} /></> : <><TaskPaperMetadataRead status={task.status} tags={task.tags} completionLabel={task.completed_at ? `完成于 ${formatTaskPaperTimestamp(task.completed_at, task.timezone)}` : null} actions={task.allowed_actions} disabled={props.updatingStatus || props.archiving} onAction={props.onStatusAction} /><PaperAuthorSignature value={task.author} editable={false} /></>}>
    {props.editing ? <TaskPaperEditor title={props.values.title} description={props.values.description} disabled={props.updating} onTitleChange={props.setValues.title} onDescriptionChange={props.setValues.description} /> : <><h2 className="memory-paper-title">{task.title}</h2><p className="memory-paper-content">{task.description}</p></>}
  </PaperDetailDialog>;
}
function MobileArchivedTaskList({ state, busy, onBack, onOpen, onRetry }: { state: LoadState; busy: boolean; onBack(): void; onOpen(id: string, trigger: HTMLElement): void; onRetry(): void }) {
  const count = state.status === "ready" ? state.count : 0;
  return <><header className="memory-page-header memory-archive-header task-archive-header"><div className="memory-page-heading"><div className="memory-page-title">Archive</div><div className="memory-page-count">{count}项任务</div></div><button type="button" className="memory-archive-back" onClick={onBack}>Return</button></header>
    {state.status === "ready" ? state.tasks.length ? <MobileTaskRows tasks={state.tasks} busy={busy} label="Task Archive 列表" onOpen={onOpen} /> : <section className="memory-empty-state"><p>还没有归档任务</p></section> : null}
    {state.status === "loading" ? <MobileTaskLoading label="Task Archive 加载中" /> : null}
    {state.status === "error" ? <TaskMessage title="暂时无法读取归档任务" description="请稍后重试。" role="alert" action={<button className="secondary-button" onClick={onRetry}>重新加载</button>} /> : null}</>;
}
function MobileArchivedTaskDetail(props: { state: DetailLoadState; task: TaskEntry | null; triggerRef: RefObject<HTMLElement | null>; errorMessage: string | null; restoring: boolean; confirmingDelete: boolean; deleting: boolean; onRestore(): void; onRequestDelete(): void; onConfirmDelete(): void; onCancelDelete(): void; onRetry(): void; onRequestClose(): boolean }) {
  if (props.state === "loading") return <PaperDetailDialog id="task-archive-detail-paper" open label="正在读取归档 Task" dateLabel="" signature="—" triggerRef={props.triggerRef} onRequestClose={props.onRequestClose}><div className="paper-detail-state" role="status" aria-live="polite"><p>正在读取归档任务…</p></div></PaperDetailDialog>;
  if (props.state === "error" || !props.task) return <PaperDetailDialog id="task-archive-detail-paper" open label="无法读取归档 Task" dateLabel="" signature="—" triggerRef={props.triggerRef} onRequestClose={props.onRequestClose}><div className="paper-detail-state" role="alert"><p>无法读取归档任务</p><span>该归档任务不存在、无权访问或暂时不可用。</span><button type="button" className="memory-paper-control" onClick={props.onRetry}>重试</button></div></PaperDetailDialog>;
  const task = props.task;
  return <PaperDetailDialog id="task-archive-detail-paper" open label={`已归档 Task ${task.title}`} dateLabel={formatTaskPaperDeadline(task.due_time, task.timezone)} signature="" triggerRef={props.triggerRef} errorMessage={props.errorMessage} onRequestClose={props.onRequestClose} topRight={props.confirmingDelete ? <><button className="memory-paper-control" disabled={props.deleting} onClick={props.onCancelDelete}>取消</button><span>·</span><button className="memory-paper-control" disabled={props.deleting} onClick={props.onConfirmDelete}>{props.deleting ? "删除中…" : "确认永久删除"}</button></> : <><button className="memory-paper-control" disabled={props.restoring || props.deleting} onClick={props.onRestore}>{props.restoring ? "恢复中…" : "恢复"}</button><span>·</span><button className="memory-paper-control" disabled={props.restoring || props.deleting} onClick={props.onRequestDelete}>删除</button></>} bottomLeft={<><TaskPaperMetadataRead status={task.status} tags={task.tags} completionLabel={task.completed_at ? `完成于 ${formatTaskPaperTimestamp(task.completed_at, task.timezone)}` : null} actions={[]} disabled /><PaperAuthorSignature value={task.author} editable={false} /></>}><h2 className="memory-paper-title">{task.title}</h2><p className="memory-paper-content">{task.description}</p></PaperDetailDialog>;
}

  function TaskLoading() {
    return (
      <section className="memory-grid" aria-busy="true">
        <span className="visually-hidden" role="status" aria-live="polite">正在读取任务…</span>
        {[0, 1, 2].map((item) => (
          <div
            className="memory-card memory-card-loading"
            aria-hidden="true"
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
        aria-busy="true"
        className="memory-message records-state"
        role="status"
        aria-live="polite"
      >
        <h2>正在读取任务…</h2>
      </section>
    );
  }

  function TaskMessage({
    action,
    description,
    role = "status",
    title,
  }: {
    action?: ReactNode;
    description?: string;
    role?: "status" | "alert";
    title: string;
  }) {
    return (
      <section className="memory-message memory-module-state records-state" role={role}>
        <div className="placeholder-icon">
          <TaskIcon />
        </div>

        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}

        {action}
      </section>
    );
  }
