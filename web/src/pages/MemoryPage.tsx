import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { WebApiClient } from "../api/useWebApiClient";
import { MemoryIcon } from "../components/icons";
import type { SettingsData } from "../settings/types";
import { MemoryPageHeader } from "./MemoryPageHeader";
import {
  MemoryPaperEditor,
  MemoryPaperMetadataEditor,
  type MemoryCategory,
  type MemoryPaperEditorHandle,
} from "./MemoryPaperEditor";
import { PaperDetailDialog } from "./PaperDetailDialog";
import {
  formatMemoryPaperDate,
  formatMemoryRowDate,
  formatMemoryRowMeta,
  getMemoryRowTitle,
  groupMemoriesByMonth,
} from "./memory-presentation";
import { isSearchLocation, navigateWithinApp } from "./app-navigation";
import { consumeQuickCreateTarget } from "./quick-create";
import {
  confirmUnsavedChanges,
  createMutationOwnership,
  createSubmissionGate,
} from "./submission-gate";
import { useUnsavedChanges } from "./use-unsaved-changes";
import {
  createMemoryFilterDebouncer,
  pushMemoryFilterHistory,
  subscribeToMemoryFilterHistory,
} from "./memory-filter-history";
import {
  buildMemoryListRequest,
  createLatestMemoryRequestTracker,
  settleLatestMemoryRequest,
} from "./memory-list-request";
import {
  EMPTY_MEMORY_FILTERS,
  createArchivedMemoryDetailLocation,
  createMemoryArchiveLocation,
  createMemoryDetailLocation,
  createMemoryListLocation,
  getArchivedMemoryDetailLocation,
  getMemoryArchiveLocation,
  getMemoryDetailLocation,
  getSafeMemoryArchiveReturnTo,
  getSafeMemoryReturnTo,
  readMemoryFilters,
  type MemoryFilterCategory,
  type MemoryFilters,
} from "./memory-location";
import {
  getMemoryScrollStorage,
  readMemoryScrollPosition,
  saveMemoryScrollPosition,
} from "./memory-scroll-restoration";

type MemoryRecord = {
  id: string;
  category: MemoryCategory;
  key: string;
  content: string;
  tags: string[];
  source: string;
  updated_at: string;
};

type MemoryResponse = {
  success: true;
  data: {
    user: { display_name: string };
    memories: MemoryRecord[];
    metadata: {
      count: number;
      categories: MemoryCategory[];
      tags: string[];
    };
  };
};

type MemoryDetailResponse = {
  success: true;
  data: MemoryRecord;
};

type ArchivedMemoryResponse = {
  success: true;
  data: {
    memories: MemoryRecord[];
    metadata: {
      count: number;
    };
  };
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; result: MemoryResponse["data"] }
  | { status: "error" };

type DetailState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; memory: MemoryRecord }
  | { status: "error" };

type ArchivedState =
  | { status: "loading" }
  | {
      status: "ready";
      result: ArchivedMemoryResponse["data"];
    }
  | { status: "error" };

const categoryLabels: Record<MemoryCategory, string> = {
  profile: "Profile",
  preference: "Preference",
  goal: "Goal",
  project: "Project",
};

export function formatMemorySource(source: string): string {
  if (source === "web") return "网页创建";
  if (source === "phase_2_validation") return "初始化数据";
  return "其他来源";
}

function initialLocation() {
  return getMemoryDetailLocation(window.location.search);
}

function initialFilters(): MemoryFilters {
  return readMemoryFilters(window.location.search);
}

function initialArchiveLocation() {
  return getMemoryArchiveLocation(window.location.search);
}

function initialArchivedDetailLocation() {
  return getArchivedMemoryDetailLocation(window.location.search);
}

function parseTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,，]/)
        .map((tag) => tag.normalize("NFC").trim())
        .filter(Boolean),
    ),
  ];
}

function sameMemoryFilters(left: MemoryFilters, right: MemoryFilters): boolean {
  return left.q === right.q &&
    left.category === right.category &&
    left.tag === right.tag;
}

export function MemoryPageContent({
  api,
}: {
  api: WebApiClient;
  settings: SettingsData;
}) {
  const [location, setLocation] = useState(initialLocation);
  const isDetail = location.memoryId !== null;
  const [archiveLocation, setArchiveLocation] =
    useState(initialArchiveLocation);
  const isArchived = archiveLocation.archived;
  const [archivedDetailLocation, setArchivedDetailLocation] =
    useState(initialArchivedDetailLocation);
  const isArchivedDetail =
    archivedDetailLocation.memoryId !== null;
  const [reloadKey, setReloadKey] = useState(0);
  const [archiveReloadKey, setArchiveReloadKey] = useState(0);
  const [detailReloadKey, setDetailReloadKey] = useState(0);
  const [state, setState] = useState<LoadState>({
    status: "loading",
  });
  const [detailState, setDetailState] = useState<DetailState>(
    () => initialLocation().memoryId
      ? { status: "loading" }
      : { status: "idle" },
  );
  const [archivedState, setArchivedState] =
    useState<ArchivedState>({ status: "loading" });
  const [archivedDetailState, setArchivedDetailState] =
    useState<DetailState>(
      () => initialArchivedDetailLocation().memoryId
        ? { status: "loading" }
        : { status: "idle" },
    );
  const listController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const archiveController = useRef<AbortController | null>(null);
  const archivedDetailController =
    useRef<AbortController | null>(null);
  const mutationGate = useRef(createSubmissionGate());
  const mutationOwnership = useRef(createMutationOwnership());
  const pendingScrollRestore = useRef<number | null>(null);
  const tracker = useRef(createLatestMemoryRequestTracker());
  const listAvailableRef = useRef(false);

  const [filters, setFilters] = useState(initialFilters);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const [searchDraft, setSearchDraft] = useState(
    () => initialFilters().q,
  );
  const searchDebouncer = useRef<
    ReturnType<typeof createMemoryFilterDebouncer> | null
  >(null);
  const [availableCategories, setAvailableCategories] =
    useState<MemoryCategory[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [actionError, setActionError] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [category, setCategory] =
    useState<MemoryCategory>("profile");
  const [key, setKey] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [creating, setCreating] = useState(false);
  const createEditorRef = useRef<MemoryPaperEditorHandle | null>(null);
  const paperTriggerRef = useRef<HTMLElement | null>(null);
  const focusCreateRef = useRef(false);

  const [editingId, setEditingId] = useState("");
  const [editingKey, setEditingKey] = useState("");
  const [editingCategory, setEditingCategory] = useState<MemoryCategory>("profile");
  const [editingContent, setEditingContent] = useState("");
  const [editingTags, setEditingTags] = useState("");
  const [updatingId, setUpdatingId] = useState("");
  const [archivingId, setArchivingId] = useState("");
  const [restoringId, setRestoringId] = useState("");

  const createDirty = showCreate && (
    category !== "profile" || key !== "" || content !== "" || tags !== ""
  );
  const editDirty = Boolean(
    editingId && detailState.status === "ready" && (
      editingKey !== detailState.memory.key ||
      editingCategory !== detailState.memory.category ||
      editingContent !== detailState.memory.content ||
      editingTags !== detailState.memory.tags.join(", ")
    ),
  );
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
    const hasIntent = consumeQuickCreateTarget("memory");
    if (!hasIntent || isDetail || isArchived || isArchivedDetail || showCreate || dirtyRef.current) return;
    if (hasIntent) {
      focusCreateRef.current = true;
      setShowCreate(true);
      setActionError("");
    }
  }, [isDetail, isArchived, isArchivedDetail, showCreate]);

  useEffect(() => {
    if (!showCreate || !focusCreateRef.current) return;
    focusCreateRef.current = false;
    (window.requestAnimationFrame ?? ((callback: FrameRequestCallback) => window.setTimeout(callback, 0)))(() => createEditorRef.current?.focusKey());
  }, [showCreate]);

  function discardDraft(): void {
    if (createDirtyRef.current) {
      setCategory("profile");
      setKey("");
      setContent("");
      setTags("");
      setShowCreate(false);
    }
    if (editDirtyRef.current) {
      setEditingId("");
      setEditingKey("");
      setEditingCategory("profile");
      setEditingContent("");
      setEditingTags("");
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
      setUpdatingId("");
      setArchivingId("");
      setRestoringId("");
    }
  }

  function invalidateList(): void {
    tracker.current.invalidate();
    listController.current?.abort();
    listController.current = null;
  }

  function commitFilters(
    next: MemoryFilters,
    options: {
      keepSearchTimer?: boolean;
    } = {},
  ): void {
    if (!options.keepSearchTimer) {
      searchDebouncer.current?.cancel();
    }
    pendingScrollRestore.current = null;
    invalidateList();
    setState({ status: "loading" });
    pushMemoryFilterHistory(window, next);
    setFilters(next);
    setSearchDraft(next.q);
  }

  if (!searchDebouncer.current) {
    searchDebouncer.current = createMemoryFilterDebouncer({
      delayMs: 300,
      commit: (q) => commitFilters(
        {
          ...filtersRef.current,
          q,
        },
        { keepSearchTimer: true },
      ),
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
    });
  }

  useEffect(() => subscribeToMemoryFilterHistory(
    window,
    (restoredFilters) => {
      if (!confirmAndDiscardDraft()) {
        window.history.pushState(null, "", currentUrlRef.current);
        return;
      }
      invalidateMutationContext();
      searchDebouncer.current?.cancel();
      invalidateList();
      const nextLocation = initialLocation();
      const nextArchiveLocation = initialArchiveLocation();
      const nextArchivedDetailLocation =
        initialArchivedDetailLocation();
      detailController.current?.abort();
      archiveController.current?.abort();
      archivedDetailController.current?.abort();
      setActionError("");
      setEditingId("");
      setEditingKey("");
      setEditingCategory("profile");
      setEditingContent("");
      setEditingTags("");
      setLocation(nextLocation);
      setArchiveLocation(nextArchiveLocation);
      setArchivedDetailLocation(nextArchivedDetailLocation);
      setFilters(restoredFilters);
      setSearchDraft(restoredFilters.q);

      if (nextLocation.memoryId) {
        setDetailState({ status: "loading" });
        return;
      }

      if (nextArchivedDetailLocation.memoryId) {
        setArchivedDetailState({ status: "loading" });
        setDetailState({ status: "idle" });
        setShowCreate(false);
        return;
      }

      if (nextArchiveLocation.archived) {
        const archiveUrl = createMemoryArchiveLocation(
          nextArchiveLocation.returnTo,
        );
        pendingScrollRestore.current = readMemoryScrollPosition(
          getMemoryScrollStorage(window),
          archiveUrl,
        );
        setArchivedState({ status: "loading" });
        setArchiveReloadKey((value) => value + 1);
        setDetailState({ status: "idle" });
        setShowCreate(false);
        return;
      }

      const listUrl = getSafeMemoryReturnTo(
        `${window.location.pathname}${window.location.search}`,
      );
      pendingScrollRestore.current = readMemoryScrollPosition(
        getMemoryScrollStorage(window),
        listUrl,
      );
      setState({ status: "loading" });
      setDetailState({ status: "idle" });
    },
  ), []);

  useEffect(() => () => {
    invalidateMutationContext(false);
    searchDebouncer.current?.cancel();
    invalidateList();
    detailController.current?.abort();
    archiveController.current?.abort();
    archivedDetailController.current?.abort();
  }, []);

  useEffect(() => {
    if ((isDetail && !listAvailableRef.current) || isArchived || isArchivedDetail) {
      listController.current?.abort();
      listController.current = null;
      return;
    }

    const controller = new AbortController();
    listController.current = controller;
    const ticket = tracker.current.begin();
    setState({ status: "loading" });

    void settleLatestMemoryRequest({
      request: api.request<MemoryResponse>(
        buildMemoryListRequest(filters).url,
        { signal: controller.signal },
      ),
      ticket,
      signal: controller.signal,
      onSuccess: (response) => {
        listAvailableRef.current = true;
        setState({
          status: "ready",
          result: response.data,
        });
        setAvailableCategories(response.data.metadata.categories);
        setAvailableTags(response.data.metadata.tags);
        const position = pendingScrollRestore.current;
        pendingScrollRestore.current = null;
        if (position !== null) {
          requestAnimationFrame(() => {
            window.scrollTo({ top: position });
          });
        }
      },
      onError: () => setState({ status: "error" }),
    }).finally(() => {
        if (listController.current === controller) {
          listController.current = null;
        }
      });

    return () => {
      tracker.current.invalidate();
      controller.abort();
      if (listController.current === controller) {
        listController.current = null;
      }
    };
  }, [
    api,
    filters,
    isArchived,
    isArchivedDetail,
    reloadKey,
  ]);

  useEffect(() => {
    if (!isArchived) {
      archiveController.current?.abort();
      archiveController.current = null;
      return;
    }

    const controller = new AbortController();
    archiveController.current = controller;
    setArchivedState({ status: "loading" });

    api.request<ArchivedMemoryResponse>("/memory/archived", {
      signal: controller.signal,
    })
      .then((response) => {
        if (!controller.signal.aborted) {
          setArchivedState({
            status: "ready",
            result: response.data,
          });
          const position = pendingScrollRestore.current;
          pendingScrollRestore.current = null;
          if (position !== null) {
            requestAnimationFrame(() => {
              window.scrollTo({ top: position });
            });
          }
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setArchivedState({ status: "error" });
        }
      })
      .finally(() => {
        if (archiveController.current === controller) {
          archiveController.current = null;
        }
      });

    return () => {
      controller.abort();
      if (archiveController.current === controller) {
        archiveController.current = null;
      }
    };
  }, [api, archiveReloadKey, isArchived]);

  useEffect(() => {
    const id = archivedDetailLocation.memoryId;
    if (!id) {
      archivedDetailController.current?.abort();
      archivedDetailController.current = null;
      setArchivedDetailState({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    archivedDetailController.current = controller;
    setArchivedDetailState({ status: "loading" });

    api.request<MemoryDetailResponse>(
      `/memory/archived/${encodeURIComponent(id)}`,
      { signal: controller.signal },
    )
      .then((response) => {
        if (controller.signal.aborted) return;
        setArchivedDetailState({
          status: "ready",
          memory: response.data,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setArchivedDetailState({ status: "error" });
        }
      })
      .finally(() => {
        if (archivedDetailController.current === controller) {
          archivedDetailController.current = null;
        }
      });

    return () => {
      controller.abort();
      if (archivedDetailController.current === controller) {
        archivedDetailController.current = null;
      }
    };
  }, [api, archiveReloadKey, archivedDetailLocation]);

  useEffect(() => {
    const id = location.memoryId;
    if (!id) {
      detailController.current?.abort();
      detailController.current = null;
      setDetailState({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    detailController.current = controller;
    setDetailState({ status: "loading" });
    setActionError("");

    api.request<MemoryDetailResponse>(
      `/memory/${encodeURIComponent(id)}`,
      { signal: controller.signal },
    )
      .then((response) => {
        if (controller.signal.aborted) return;
        setDetailState({
          status: "ready",
          memory: response.data,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDetailState({ status: "error" });
        }
      })
      .finally(() => {
        if (detailController.current === controller) {
          detailController.current = null;
        }
      });

    return () => {
      controller.abort();
      if (detailController.current === controller) {
        detailController.current = null;
      }
    };
  }, [api, detailReloadKey, location]);

  const busy =
    creating ||
    updatingId.length > 0 ||
    archivingId.length > 0;

  const createInvalid =
    key.trim().length === 0 ||
    content.trim().length === 0;

  async function handleCreate() {
    if (createInvalid) {
      setActionError("Key 和 Content 都不能为空。");
      return;
    }
    if (!mutationGate.current.enter()) return;

    const ticket = mutationOwnership.current.begin();

    setCreating(true);
    setActionError("");

    try {
      await api.request("/memory", {
        method: "POST",
        body: JSON.stringify({
          category,
          key: key.trim(),
          content: content.trim(),
          tags: parseTags(tags),
        }),
      });

      if (!mutationOwnership.current.owns(ticket)) return;
      setKey("");
      setContent("");
      setTags("");
      setShowCreate(false);
      setReloadKey((value) => value + 1);
    } catch {
      if (mutationOwnership.current.owns(ticket)) {
        setActionError("创建记忆失败，请稍后重试。");
      }
    } finally {
      mutationGate.current.leave();
      if (mutationOwnership.current.owns(ticket)) setCreating(false);
    }
  }

  async function handleUpdate(id: string) {
    if (!editingKey.trim() || !editingContent.trim()) {
      setActionError("Key 和 Content 都不能为空。");
      return;
    }

    if (!mutationGate.current.enter()) return;
    const ticket = mutationOwnership.current.begin();
    setUpdatingId(id);
    setActionError("");

    try {
      await api.request("/memory", {
        method: "PATCH",
        body: JSON.stringify({
          id,
          key: editingKey.trim(),
          category: editingCategory,
          content: editingContent.trim(),
          tags: parseTags(editingTags),
        }),
      });

      if (!mutationOwnership.current.owns(ticket)) return;
      setEditingId("");
      setEditingKey("");
      setEditingCategory("profile");
      setEditingContent("");
      setEditingTags("");
      setReloadKey((value) => value + 1);
      if (isDetail) setDetailReloadKey((value) => value + 1);
    } catch {
      if (mutationOwnership.current.owns(ticket)) {
        setActionError("修改记忆失败，请稍后重试。");
      }
    } finally {
      mutationGate.current.leave();
      if (mutationOwnership.current.owns(ticket)) setUpdatingId("");
    }
  }

  async function handleArchive(
    id: string,
    memoryKey: string,
  ) {
    if (!mutationGate.current.enter()) {
      return;
    }

    const confirmed = window.confirm(
      `确定归档“${memoryKey.replaceAll("_", " ")}”吗？`,
    );

    if (!confirmed) {
      mutationGate.current.leave();
      return;
    }

    const ticket = mutationOwnership.current.begin();

    setArchivingId(id);
    setActionError("");

    try {
      await api.request("/memory", {
        method: "DELETE",
        body: JSON.stringify({
          id,
        }),
      });

      if (!mutationOwnership.current.owns(ticket)) return;
      if (editingId === id) {
        setEditingId("");
        setEditingKey("");
        setEditingCategory("profile");
        setEditingContent("");
        setEditingTags("");
      }

      setReloadKey((value) => value + 1);
      if (isDetail) {
        closeMemory(true);
      }
    } catch {
      if (mutationOwnership.current.owns(ticket)) {
        setActionError("归档记忆失败，请稍后重试。");
      }
    } finally {
      mutationGate.current.leave();
      if (mutationOwnership.current.owns(ticket)) setArchivingId("");
    }
  }

  function updateSearch(value: string): void {
    invalidateList();
    setState({ status: "loading" });
    setSearchDraft(value);
    searchDebouncer.current?.schedule(value);
  }

  function openMemory(id: string): void {
    if (!confirmAndDiscardDraft()) return;
    invalidateMutationContext();
    const returnTo = createMemoryListLocation(filters);
    saveMemoryScrollPosition(
      getMemoryScrollStorage(window),
      returnTo,
      window.scrollY,
    );
    const next = createMemoryDetailLocation(id, returnTo);
    window.history.pushState(null, "", next);
    setEditingId("");
    setEditingKey("");
    setEditingCategory("profile");
    setEditingContent("");
    setEditingTags("");
    setLocation(getMemoryDetailLocation(window.location.search));
    setDetailState({ status: "loading" });
  }

  function closeMemory(skipSafety = false): void {
    if (!skipSafety && !confirmAndDiscardDraft()) return;
    if (!skipSafety) invalidateMutationContext();
    const returnTo = getSafeMemoryReturnTo(location.returnTo);
    if (isSearchLocation(returnTo)) {
      navigateWithinApp(returnTo, window.history.state, { resetScroll: false });
      return;
    }

    const hadList = listAvailableRef.current;
    window.history.pushState(null, "", returnTo);
    pendingScrollRestore.current = hadList
      ? null
      : readMemoryScrollPosition(getMemoryScrollStorage(window), returnTo);
    const restoredFilters = readMemoryFilters(
      new URL(returnTo, window.location.origin).search,
    );
    setFilters((current) =>
      sameMemoryFilters(current, restoredFilters) ? current : restoredFilters
    );
    setSearchDraft(restoredFilters.q);
    setEditingId("");
    setEditingKey("");
    setEditingCategory("profile");
    setEditingContent("");
    setEditingTags("");
    setLocation({ memoryId: null, returnTo: "/memory" });
    setDetailState({ status: "idle" });

    if (!hadList) {
      setState({ status: "loading" });
      setReloadKey((value) => value + 1);
    }
  }

  function openArchive(): void {
    if (!confirmAndDiscardDraft()) return;
    invalidateMutationContext();
    const returnTo = createMemoryListLocation(filters);
    saveMemoryScrollPosition(
      getMemoryScrollStorage(window),
      returnTo,
      window.scrollY,
    );
    const next = createMemoryArchiveLocation(returnTo);
    searchDebouncer.current?.cancel();
    invalidateList();
    window.history.pushState(null, "", next);
    setShowCreate(false);
    setActionError("");
    setArchiveLocation(
      getMemoryArchiveLocation(window.location.search),
    );
    setArchivedState({ status: "loading" });
  }

  function closeArchive(): void {
    const returnTo = getSafeMemoryReturnTo(
      archiveLocation.returnTo,
    );
    navigateWithinApp(returnTo, window.history.state, { resetScroll: false });
    pendingScrollRestore.current = readMemoryScrollPosition(
      getMemoryScrollStorage(window),
      returnTo,
    );
    const restoredFilters = readMemoryFilters(
      new URL(returnTo, window.location.origin).search,
    );
    setFilters(restoredFilters);
    setSearchDraft(restoredFilters.q);
    setState({ status: "loading" });
  }

  function openArchivedMemory(id: string): void {
    const archiveUrl = createMemoryArchiveLocation(
      archiveLocation.returnTo,
    );
    saveMemoryScrollPosition(
      getMemoryScrollStorage(window),
      archiveUrl,
      window.scrollY,
    );
    const next = createArchivedMemoryDetailLocation(
      id,
      archiveUrl,
    );
    window.history.pushState(null, "", next);
    setArchivedDetailLocation(
      getArchivedMemoryDetailLocation(window.location.search),
    );
    setArchivedDetailState({ status: "loading" });
  }

  function closeArchivedMemory(): void {
    const returnTo = getSafeMemoryArchiveReturnTo(
      archivedDetailLocation.returnTo,
    );
    if (isSearchLocation(returnTo)) {
      navigateWithinApp(returnTo, window.history.state, { resetScroll: false });
      return;
    }

    const hadArchiveList = isArchived && archivedState.status === "ready";
    window.history.pushState(null, "", returnTo);
    pendingScrollRestore.current = hadArchiveList
      ? null
      : readMemoryScrollPosition(getMemoryScrollStorage(window), returnTo);
    setArchivedDetailLocation({
      memoryId: null,
      returnTo: createMemoryArchiveLocation("/memory"),
    });
    setArchivedDetailState({ status: "idle" });
    setArchiveLocation(getMemoryArchiveLocation(window.location.search));
    if (!hadArchiveList) setArchivedState({ status: "loading" });
  }

  async function restoreArchivedMemory(id: string): Promise<void> {
    if (!mutationGate.current.enter()) return;
    const ticket = mutationOwnership.current.begin();
    setRestoringId(id);
    setActionError("");

    try {
      await api.request(
        `/memory/archived/${encodeURIComponent(id)}/restore`,
        { method: "POST" },
      );
      if (!mutationOwnership.current.owns(ticket)) return;
      const archiveReturn = getMemoryArchiveLocation(
        new URL(
          archivedDetailLocation.returnTo,
          window.location.origin,
        ).search,
      );
      const activeList = getSafeMemoryReturnTo(
        archiveReturn.returnTo,
      );
      const restoredFilters = readMemoryFilters(
        new URL(activeList, window.location.origin).search,
      );
      window.history.replaceState(null, "", activeList);
      setArchivedDetailLocation({
        memoryId: null,
        returnTo: createMemoryArchiveLocation("/memory"),
      });
      setArchivedDetailState({ status: "idle" });
      setArchiveLocation({ archived: false, returnTo: "/memory" });
      setFilters(restoredFilters);
      setSearchDraft(restoredFilters.q);
      setState({ status: "loading" });
      setReloadKey((value) => value + 1);
    } catch {
      if (mutationOwnership.current.owns(ticket)) {
        setActionError("恢复记忆失败，请稍后重试。");
      }
    } finally {
      mutationGate.current.leave();
      if (mutationOwnership.current.owns(ticket)) setRestoringId("");
    }
  }

  const visibleMemories =
    state.status === "ready"
      ? state.result.memories
      : [];

  const memoryGroups = groupMemoriesByMonth(visibleMemories);

  const detailMemory =
    detailState.status === "ready"
      ? detailState.memory
      : null;
  const showActiveBackground = !isDetail || listAvailableRef.current;

  return (
    <div className="page memory-page">
      {!isArchived && !isArchivedDetail ? (
        <>
          {showActiveBackground ? (
            <MemoryPageHeader
              count={state.status === "ready" ? state.result.metadata.count : 0}
              categories={availableCategories.map((value) => ({
                value,
                label: categoryLabels[value],
              }))}
              tags={availableTags}
              category={filters.category}
              tag={filters.tag}
              searchDraft={searchDraft}
              busy={busy}
              onCategoryChange={(value) =>
                commitFilters({
                  ...filters,
                  q: searchDraft,
                  category: value as MemoryFilterCategory,
                })
              }
              onTagChange={(value) =>
                commitFilters({
                  ...filters,
                  q: searchDraft,
                  tag: value,
                })
              }
              onSearchChange={updateSearch}
              onClearFilters={() => commitFilters(EMPTY_MEMORY_FILTERS)}
              onOpenArchive={() => openArchive()}
              onCreate={(trigger) => {
                paperTriggerRef.current = trigger;
                if (showCreate) {
                  if (!confirmAndDiscardDraft()) return;
                  invalidateMutationContext();
                  setShowCreate(false);
                } else {
                  focusCreateRef.current = true;
                  setShowCreate(true);
                }
                setActionError("");
              }}
            />
          ) : null}

          {isArchivedDetail && archivedState.status === "ready" ? (
        <ArchivedMemoryList
          state={archivedState}
          onOpen={(id, trigger) => {
            paperTriggerRef.current = trigger;
            openArchivedMemory(id);
          }}
          onBack={closeArchive}
          onRetry={() =>
            setArchiveReloadKey((value) => value + 1)
          }
        />
      ) : null}

      {actionError && !isDetail && !showCreate && (
            <section className="memory-message">
              <h2>操作没有完成</h2>
              <p>{actionError}</p>
            </section>
          )}

          {showActiveBackground ? (
            <>
              {showCreate && (
                <PaperDetailDialog
                  id="memory-create-paper"
                  open
                  label="创建 Memory"
                  dateLabel={formatMemoryPaperDate(new Date().toISOString())}
                  signature="N"
                  triggerRef={paperTriggerRef}
                  onRequestClose={() => {
                    if (!confirmAndDiscardDraft()) return false;
                    setShowCreate(false);
                    setActionError("");
                    return true;
                  }}
                  topRight={
                    <>
                      <button
                        className="memory-paper-control"
                        disabled={creating}
                        onClick={() => {
                          if (!confirmAndDiscardDraft()) return;
                          setShowCreate(false);
                          setActionError("");
                        }}
                      >
                        取消
                      </button>
                      <span>·</span>
                      <button
                        className="memory-paper-control"
                        disabled={creating || createInvalid}
                        onClick={handleCreate}
                      >
                        {creating ? "保存中…" : "保存"}
                      </button>
                    </>
                  }
                  bottomLeft={
                    <MemoryPaperMetadataEditor
                      category={category}
                      tagsValue={tags}
                      disabled={creating}
                      onCategoryChange={(value) => {
                        setCategory(value);
                        setActionError("");
                      }}
                      onTagsChange={(value) => {
                        setTags(value);
                        setActionError("");
                      }}
                    />
                  }
                  errorMessage={actionError || null}
                >
                  <MemoryPaperEditor
                    ref={createEditorRef}
                    keyValue={key}
                    content={content}
                    disabled={creating}
                    onKeyChange={(value) => {
                      setKey(value);
                      setActionError("");
                    }}
                    onContentChange={(value) => {
                      setContent(value);
                      setActionError("");
                    }}
                  />
                </PaperDetailDialog>
              )}

              {state.status === "ready" && (
                <>
                  {visibleMemories.length > 0 ? (
                    <section className="memory-months" aria-label="Memory 列表">
                      {memoryGroups.map((group) => (
                        <section className="memory-month-section" key={group.key}>
                          <h2 className="memory-month-label">{group.label}</h2>
                          <div className="memory-month-card">
                            {group.memories.map((memory) => (
                              <button
                                key={memory.id}
                                type="button"
                                className="memory-row"
                                data-memory-id={memory.id}
                                disabled={busy}
                                onClick={(event) => {
                                  paperTriggerRef.current = event.currentTarget;
                                  openMemory(memory.id);
                                }}
                              >
                                <span className="memory-row-title">{getMemoryRowTitle(memory)}</span>
                                <span className="memory-row-meta">
                                  <span>{formatMemoryRowDate(memory.updated_at)}</span>
                                  <span>{formatMemoryRowMeta(memory, categoryLabels[memory.category])}</span>
                                </span>
                              </button>
                            ))}
                          </div>
                        </section>
                      ))}
                    </section>
                  ) : (
                    <section className="memory-empty-state">
                      <p>{filters.q || filters.category || filters.tag ? "没有匹配的记忆" : "还没有记忆"}</p>
                      {(filters.q || filters.category || filters.tag) && (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => commitFilters(EMPTY_MEMORY_FILTERS)}
                        >
                          清除筛选
                        </button>
                      )}
                    </section>
                  )}
                </>
              )}

              {state.status === "loading" && (
                <section className="memory-months" aria-label="Memory 加载中">
                  {[0, 1].map((index) => (
                    <div className="memory-month-skeleton" key={index}>
                      <span className="memory-month-skeleton-label" />
                      <div className="memory-month-skeleton-card">
                        <span />
                        <span />
                      </div>
                    </div>
                  ))}
                </section>
              )}

              {state.status === "error" && (
                <MemoryMessage
                  title="暂时无法读取记忆"
                  description="连接没有完成，请稍后重试。"
                  action={
                    <button
                      className="secondary-button"
                      onClick={() => setReloadKey((value) => value + 1)}
                    >
                      重新加载
                    </button>
                  }
                />
              )}
            </>
          ) : null}

          {isDetail && (
            <MemoryDetail
              state={detailState}
              triggerRef={paperTriggerRef}
              errorMessage={actionError || null}
              editing={editingId === detailMemory?.id}
              editingKey={editingKey}
              editingCategory={editingCategory}
              editingContent={editingContent}
              editingTags={editingTags}
              updating={updatingId === detailMemory?.id}
              archiving={archivingId === detailMemory?.id}
              onEditingKeyChange={(value) => {
                setEditingKey(value);
                setActionError("");
              }}
              onEditingCategoryChange={(value) => {
                setEditingCategory(value);
                setActionError("");
              }}
              onEditingContentChange={(value) => {
                setEditingContent(value);
                setActionError("");
              }}
              onEditingTagsChange={(value) => {
                setEditingTags(value);
                setActionError("");
              }}
              onEdit={(memory) => {
                setEditingId(memory.id);
                setEditingKey(memory.key);
                setEditingCategory(memory.category);
                setEditingContent(memory.content);
                setEditingTags(memory.tags.join(", "));
                setActionError("");
              }}
              onCancel={() => {
                if (!confirmAndDiscardDraft()) return;
                invalidateMutationContext();
                setEditingId("");
                setEditingKey("");
                setEditingCategory("profile");
                setEditingContent("");
                setEditingTags("");
                setActionError("");
              }}
              onSave={() => {
                if (detailMemory) void handleUpdate(detailMemory.id);
              }}
              onArchive={(memory) => void handleArchive(memory.id, memory.key)}
              onRetry={() => setDetailReloadKey((value) => value + 1)}
              onRequestClose={() => {
                if (!confirmAndDiscardDraft()) return false;
                closeMemory(true);
                return true;
              }}
            />
          )}
        </>
      ) : (
        <>
          {isArchived ? (
            <ArchivedMemoryList
              state={archivedState}
              onOpen={(id, trigger) => {
                paperTriggerRef.current = trigger;
                openArchivedMemory(id);
              }}
              onBack={closeArchive}
              onRetry={() => setArchiveReloadKey((value) => value + 1)}
            />
          ) : null}
          {isArchivedDetail ? (
            <ArchivedMemoryDetail
              state={archivedDetailState}
              triggerRef={paperTriggerRef}
              errorMessage={actionError || null}
              onRetry={() => setArchiveReloadKey((value) => value + 1)}
              onBack={closeArchivedMemory}
              restoring={restoringId === archivedDetailLocation.memoryId}
              onRestore={(id) => void restoreArchivedMemory(id)}
            />
          ) : null}
        </>
      )}
    </div>
  );
}


function ArchivedMemoryList({
  state,
  onOpen,
  onBack,
  onRetry,
}: {
  state: ArchivedState;
  onOpen(id: string, trigger: HTMLElement): void;
  onBack(): void;
  onRetry(): void;
}) {
  const count = state.status === "ready" ? state.result.metadata.count : 0;

  let body: ReactNode;
  if (state.status === "loading") {
    body = (
      <>
        <MemoryMessage title="正在读取归档" description="正在读取归档…" />
        <section className="memory-months" aria-label="已归档 Memory 加载中">
          {[0, 1].map((index) => (
            <div className="memory-month-skeleton" key={index}>
              <span className="memory-month-skeleton-label" />
              <div className="memory-month-skeleton-card">
                <span />
                <span />
              </div>
            </div>
          ))}
        </section>
      </>
    );
  } else if (state.status === "error") {
    body = (
      <MemoryMessage
        title="暂时无法读取归档"
        description="连接没有完成，请稍后重试。"
        action={<button className="secondary-button" onClick={onRetry}>重新加载</button>}
      />
    );
  } else if (state.result.memories.length === 0) {
    body = <MemoryMessage title="还没有归档记忆" description="归档区目前为空。" />;
  } else {
    const groups = groupMemoriesByMonth(state.result.memories);
    body = (
      <section className="memory-months" aria-label="已归档 Memory 列表">
        {groups.map((group) => (
          <section className="memory-month-section" key={group.key}>
            <h2 className="memory-month-label">{group.label}</h2>
            <div className="memory-month-card">
              {group.memories.map((memory) => (
                <button
                  key={memory.id}
                  type="button"
                  className="memory-row"
                  data-memory-id={memory.id}
                  onClick={(event) => onOpen(memory.id, event.currentTarget)}
                >
                  <span className="memory-row-title">{getMemoryRowTitle(memory)}</span>
                  <span className="memory-row-meta">
                    <span>{formatMemoryRowDate(memory.updated_at)}</span>
                    <span>{formatMemoryRowMeta(memory, categoryLabels[memory.category])}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </section>
    );
  }

  return (
    <>
      <header className="memory-page-header memory-archive-header">
        <div className="memory-page-heading">
          <div className="memory-page-title">Archive</div>
          <div className="memory-page-count">{count}条记忆</div>
        </div>
        <button type="button" className="memory-archive-back" onClick={onBack}>
          返回
        </button>
      </header>
      {body}
    </>
  );
}


function ArchivedMemoryDetail({
  state,
  triggerRef,
  errorMessage,
  onRetry,
  onBack,
  restoring,
  onRestore,
}: {
  state: DetailState;
  triggerRef: RefObject<HTMLElement | null>;
  errorMessage: string | null;
  onRetry(): void;
  onBack(): void;
  restoring: boolean;
  onRestore(id: string): void;
}) {
  if (state.status === "loading") {
    return (
      <MemoryMessage
        title="正在读取已归档记忆"
        description="详情加载中…"
      />
    );
  }

  if (state.status === "error" || state.status === "idle") {
    return (
      <MemoryMessage
        title="无法读取已归档记忆"
        description="该记忆不存在、无权访问或暂时不可用。"
        action={
          <>
            <button
              className="secondary-button"
              onClick={onRetry}
            >
              重新加载
            </button>
            <button
              className="secondary-button"
              onClick={onBack}
            >
              返回归档列表
            </button>
          </>
        }
      />
    );
  }

  const memory = state.memory;

  return (
    <PaperDetailDialog
      id="memory-archive-detail-paper"
      open
      label={`已归档 Memory ${getMemoryRowTitle(memory)}`}
      dateLabel={formatMemoryPaperDate(memory.updated_at)}
      signature="N"
      triggerRef={triggerRef}
      errorMessage={errorMessage}
      onRequestClose={() => {
        if (restoring) return false;
        onBack();
        return true;
      }}
      topRight={
        <button
          className="memory-paper-control"
          disabled={restoring}
          onClick={() => onRestore(memory.id)}
        >
          {restoring ? "恢复中…" : "恢复"}
        </button>
      }
      bottomLeft={formatMemoryRowMeta(
        memory,
        categoryLabels[memory.category],
      )}
    >
      {memory.key.trim() ? (
        <h2 className="memory-paper-title">
          {memory.key}
        </h2>
      ) : null}

      <p className="memory-paper-content">
        {memory.content}
      </p>
    </PaperDetailDialog>
  );
}

function MemoryDetail({
  state,
  triggerRef,
  errorMessage,
  editing,
  editingKey,
  editingCategory,
  editingContent,
  editingTags,
  updating,
  archiving,
  onEditingKeyChange,
  onEditingCategoryChange,
  onEditingContentChange,
  onEditingTagsChange,
  onEdit,
  onCancel,
  onSave,
  onArchive,
  onRetry,
  onRequestClose,
}: {
  state: DetailState;
  triggerRef: RefObject<HTMLElement | null>;
  errorMessage: string | null;
  editing: boolean;
  editingKey: string;
  editingCategory: MemoryCategory;
  editingContent: string;
  editingTags: string;
  updating: boolean;
  archiving: boolean;
  onEditingKeyChange(value: string): void;
  onEditingCategoryChange(value: MemoryCategory): void;
  onEditingContentChange(value: string): void;
  onEditingTagsChange(value: string): void;
  onEdit(memory: MemoryRecord): void;
  onCancel(): void;
  onSave(): void;
  onArchive(memory: MemoryRecord): void;
  onRetry(): void;
  onRequestClose(): boolean;
}) {
  if (state.status === "loading") {
    return (
      <PaperDetailDialog
        id="memory-detail-paper"
        open
        label="正在读取 Memory"
        dateLabel=""
        signature="N"
        triggerRef={triggerRef}
        onRequestClose={onRequestClose}
      >
        <p className="memory-paper-status">正在读取记忆…</p>
      </PaperDetailDialog>
    );
  }

  if (state.status === "error" || state.status === "idle") {
    return (
      <PaperDetailDialog
        id="memory-detail-paper"
        open
        label="无法读取 Memory"
        dateLabel=""
        signature="N"
        triggerRef={triggerRef}
        onRequestClose={onRequestClose}
        topRight={<button className="memory-paper-control" onClick={onRetry}>重试</button>}
      >
        <p className="memory-paper-status">无法读取记忆</p>
        <p className="memory-paper-content">该记忆不存在、无权访问或暂时不可用。</p>
      </PaperDetailDialog>
    );
  }

  const memory = state.memory;
  return (
    <PaperDetailDialog
      id="memory-detail-paper"
      open
      label={`Memory ${getMemoryRowTitle(memory)}`}
      dateLabel={formatMemoryPaperDate(memory.updated_at)}
      signature="N"
      triggerRef={triggerRef}
      errorMessage={errorMessage}
      onRequestClose={onRequestClose}
      topRight={
        editing ? (
          <>
            <button className="memory-paper-control" disabled={updating} onClick={onCancel}>取消</button>
            <span>·</span>
            <button
              className="memory-paper-control"
              disabled={updating || !editingKey.trim() || !editingContent.trim()}
              onClick={onSave}
            >
              {updating ? "保存中…" : "保存"}
            </button>
          </>
        ) : (
          <>
            <button className="memory-paper-control" disabled={archiving} onClick={() => onArchive(memory)}>
              {archiving ? "归档中…" : "归档"}
            </button>
            <span>·</span>
            <button className="memory-paper-control" disabled={archiving} onClick={() => onEdit(memory)}>编辑</button>
          </>
        )
      }
      bottomLeft={
        editing ? (
          <MemoryPaperMetadataEditor
            category={editingCategory}
            tagsValue={editingTags}
            disabled={updating}
            onCategoryChange={onEditingCategoryChange}
            onTagsChange={onEditingTagsChange}
          />
        ) : formatMemoryRowMeta(memory, categoryLabels[memory.category])
      }
    >
      {editing ? (
        <MemoryPaperEditor
          keyValue={editingKey}
          content={editingContent}
          disabled={updating}
          onKeyChange={onEditingKeyChange}
          onContentChange={onEditingContentChange}
        />
      ) : (
        <>
          {memory.key.trim() ? <h2 className="memory-paper-title">{memory.key}</h2> : null}
          <p className="memory-paper-content">{memory.content}</p>
        </>
      )}
    </PaperDetailDialog>
  );
}


function MemoryMessage({
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
        <MemoryIcon />
      </div>

      <h2>{title}</h2>
      <p>{description}</p>

      {action}
    </section>
  );
}
