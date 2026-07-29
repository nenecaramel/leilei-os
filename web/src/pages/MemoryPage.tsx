import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { WebApiClient } from "../api/useWebApiClient";
import { MemoryIcon } from "../components/icons";
import type { SettingsData } from "../settings/types";
import { PageHeader } from "./PageHeader";
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

type MemoryCategory = "profile" | "preference" | "goal" | "project";

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

function formatUpdatedAt(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "更新时间未知";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

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

export function MemoryPageContent({
  api,
  settings,
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
  const pendingScrollRestore = useRef<number | null>(null);
  const tracker = useRef(createLatestMemoryRequestTracker());

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

  const [editingId, setEditingId] = useState("");
  const [editingContent, setEditingContent] = useState("");
  const [editingTags, setEditingTags] = useState("");
  const [updatingId, setUpdatingId] = useState("");
  const [archivingId, setArchivingId] = useState("");

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
    searchDebouncer.current?.cancel();
    invalidateList();
    detailController.current?.abort();
    archiveController.current?.abort();
    archivedDetailController.current?.abort();
  }, []);

  useEffect(() => {
    if (isDetail || isArchived || isArchivedDetail) {
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
    isDetail,
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
        window.scrollTo({ top: 0 });
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
        window.scrollTo({ top: 0 });
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
    if (createInvalid || busy) {
      setActionError("Key 和 Content 都不能为空。");
      return;
    }

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

      setKey("");
      setContent("");
      setTags("");
      setShowCreate(false);
      setReloadKey((value) => value + 1);
    } catch {
      setActionError("创建记忆失败，请稍后重试。");
    } finally {
      setCreating(false);
    }
  }

  async function handleUpdate(id: string) {
    if (!editingContent.trim()) {
      setActionError("记忆内容不能为空。");
      return;
    }

    if (busy) {
      return;
    }

    setUpdatingId(id);
    setActionError("");

    try {
      await api.request("/memory", {
        method: "PATCH",
        body: JSON.stringify({
          id,
          content: editingContent.trim(),
          tags: parseTags(editingTags),
        }),
      });

      setEditingId("");
      setEditingContent("");
      setEditingTags("");
      setReloadKey((value) => value + 1);
      if (isDetail) {
        setDetailReloadKey((value) => value + 1);
      }
    } catch {
      setActionError("修改记忆失败，请稍后重试。");
    } finally {
      setUpdatingId("");
    }
  }

  async function handleArchive(
    id: string,
    memoryKey: string,
  ) {
    if (busy) {
      return;
    }

    const confirmed = window.confirm(
      `确定归档“${memoryKey.replaceAll("_", " ")}”吗？`,
    );

    if (!confirmed) {
      return;
    }

    setArchivingId(id);
    setActionError("");

    try {
      await api.request("/memory", {
        method: "DELETE",
        body: JSON.stringify({
          id,
        }),
      });

      if (editingId === id) {
        setEditingId("");
        setEditingContent("");
        setEditingTags("");
      }

      setReloadKey((value) => value + 1);
    } catch {
      setActionError("归档记忆失败，请稍后重试。");
    } finally {
      setArchivingId("");
    }
  }

  function updateSearch(value: string): void {
    invalidateList();
    setState({ status: "loading" });
    setSearchDraft(value);
    searchDebouncer.current?.schedule(value);
  }

  function openMemory(id: string): void {
    const returnTo = createMemoryListLocation(filters);
    saveMemoryScrollPosition(
      getMemoryScrollStorage(window),
      returnTo,
      window.scrollY,
    );
    const next = createMemoryDetailLocation(id, returnTo);
    window.history.pushState(null, "", next);
    setEditingId("");
    setEditingContent("");
    setEditingTags("");
    setLocation(getMemoryDetailLocation(window.location.search));
    setDetailState({ status: "loading" });
  }

  function closeMemory(): void {
    const returnTo = getSafeMemoryReturnTo(location.returnTo);
    window.history.pushState(null, "", returnTo);
    pendingScrollRestore.current = readMemoryScrollPosition(
      getMemoryScrollStorage(window),
      returnTo,
    );
    const restoredFilters = readMemoryFilters(
      new URL(returnTo, window.location.origin).search,
    );
    setFilters(restoredFilters);
    setSearchDraft(restoredFilters.q);
    setEditingId("");
    setEditingContent("");
    setEditingTags("");
    setLocation({ memoryId: null, returnTo: "/memory" });
    setDetailState({ status: "idle" });
    setState({ status: "loading" });
  }

  function openArchive(): void {
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
    window.history.pushState(null, "", returnTo);
    pendingScrollRestore.current = readMemoryScrollPosition(
      getMemoryScrollStorage(window),
      returnTo,
    );
    const restoredFilters = readMemoryFilters(
      new URL(returnTo, window.location.origin).search,
    );
    setFilters(restoredFilters);
    setSearchDraft(restoredFilters.q);
    setArchiveLocation({ archived: false, returnTo: "/memory" });
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
    setArchiveLocation({ archived: false, returnTo: "/memory" });
    setArchivedDetailLocation(
      getArchivedMemoryDetailLocation(window.location.search),
    );
    setArchivedDetailState({ status: "loading" });
  }

  function closeArchivedMemory(): void {
    const returnTo = getSafeMemoryArchiveReturnTo(
      archivedDetailLocation.returnTo,
    );
    window.history.pushState(null, "", returnTo);
    pendingScrollRestore.current = readMemoryScrollPosition(
      getMemoryScrollStorage(window),
      returnTo,
    );
    setArchivedDetailLocation({
      memoryId: null,
      returnTo: createMemoryArchiveLocation("/memory"),
    });
    setArchivedDetailState({ status: "idle" });
    setArchiveLocation(
      getMemoryArchiveLocation(window.location.search),
    );
    setArchivedState({ status: "loading" });
  }

  const visibleMemories =
    state.status === "ready"
      ? state.result.memories
      : [];

  const detailMemory =
    detailState.status === "ready"
      ? detailState.memory
      : null;

  return (
    <div className="page memory-page">
      <PageHeader
        eyebrow="Long-term context"
        title="Memory"
        description={settings.page_copy.memory_subtitle ?? "由 Leilei OS 安全保存的核心信息、稳定偏好、长期目标与当前项目。"}
        action={isDetail ? (
          <button
            className="secondary-button"
            disabled={updatingId.length > 0}
            onClick={closeMemory}
          >
            返回记忆列表
          </button>
        ) : isArchivedDetail ? (
          <button
            className="secondary-button"
            onClick={closeArchivedMemory}
          >
            返回归档列表
          </button>
        ) : isArchived ? (
          <button
            className="secondary-button"
            onClick={closeArchive}
          >
            返回记忆列表
          </button>
        ) : (
          <div className="page-header-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={openArchive}
            >
              查看归档
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setShowCreate((value) => !value);
                setActionError("");
              }}
            >
              {showCreate ? "取消新增" : "新增记忆"}
            </button>
          </div>
        )}
      />

      {actionError && (
        <section className="memory-message">
          <h2>操作没有完成</h2>
          <p>{actionError}</p>
        </section>
      )}

      {isDetail ? (
        <MemoryDetail
          state={detailState}
          editing={editingId === detailMemory?.id}
          editingContent={editingContent}
          editingTags={editingTags}
          updating={updatingId === detailMemory?.id}
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
            setEditingContent(memory.content);
            setEditingTags(memory.tags.join(", "));
            setActionError("");
          }}
          onCancel={() => {
            setEditingId("");
            setEditingContent("");
            setEditingTags("");
            setActionError("");
          }}
          onSave={() => {
            if (detailMemory) void handleUpdate(detailMemory.id);
          }}
          onBack={closeMemory}
        />
      ) : isArchivedDetail ? (
        <ArchivedMemoryDetail
          state={archivedDetailState}
          onRetry={() =>
            setArchiveReloadKey((value) => value + 1)
          }
          onBack={closeArchivedMemory}
        />
      ) : isArchived ? (
        <ArchivedMemoryList
          state={archivedState}
          onOpen={openArchivedMemory}
          onRetry={() =>
            setArchiveReloadKey((value) => value + 1)
          }
        />
      ) : (
        <>
          {showCreate && (
            <section className="memory-message">
              <h2>创建记忆</h2>

              <select
                value={category}
                disabled={creating}
                onChange={(event) => {
                  setCategory(
                    event.target.value as MemoryCategory,
                  );
                  setActionError("");
                }}
              >
                <option value="profile">Profile</option>
                <option value="preference">Preference</option>
                <option value="goal">Goal</option>
                <option value="project">Project</option>
              </select>

              <input
                placeholder="Key"
                value={key}
                disabled={creating}
                onChange={(event) => {
                  setKey(event.target.value);
                  setActionError("");
                }}
              />

              <textarea
                placeholder="Content"
                value={content}
                disabled={creating}
                onChange={(event) => {
                  setContent(event.target.value);
                  setActionError("");
                }}
              />

              <input
                aria-label="记忆标签"
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
                {creating ? "保存中…" : "保存"}
              </button>
            </section>
          )}

          <section className="memory-message memory-filters">
            <h2>搜索与筛选</h2>

            <input
              aria-label="搜索记忆"
              type="search"
              maxLength={200}
              placeholder="搜索 Key 或内容"
              value={searchDraft}
              onChange={(event) =>
                updateSearch(event.target.value)
              }
            />

            <select
              aria-label="按分类筛选"
              value={filters.category}
              onChange={(event) => {
                commitFilters({
                  ...filters,
                  q: searchDraft,
                  category: event.target
                    .value as MemoryFilterCategory,
                });
              }}
            >
              <option value="">全部分类</option>
              {availableCategories.map((value) => (
                <option key={value} value={value}>
                  {categoryLabels[value]}
                </option>
              ))}
            </select>

            <select
              aria-label="按标签筛选"
              value={filters.tag}
              onChange={(event) => {
                commitFilters({
                  ...filters,
                  q: searchDraft,
                  tag: event.target.value,
                });
              }}
            >
              <option value="">全部标签</option>
              {availableTags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>

            {(filters.q || filters.category || filters.tag) && (
              <button
                className="secondary-button"
                onClick={() =>
                  commitFilters(EMPTY_MEMORY_FILTERS)
                }
              >
                清除筛选
              </button>
            )}
          </section>

          {state.status === "ready" && (
            <>
              {visibleMemories.length > 0 ? (
                <>
                  <section className="memory-message">
                    <h2>记忆列表</h2>
                    <p>
                      共 {state.result.metadata.count} 条，按更新时间从新到旧排列。
                    </p>
                  </section>

                  <section className="memory-grid">
                  {visibleMemories.map((memory) => {
                    const editing =
                      editingId === memory.id;
                    const updating =
                      updatingId === memory.id;
                    const archiving =
                      archivingId === memory.id;

                    return (
                      <article
                        className="memory-card"
                        key={memory.id}
                      >
                        <MemoryMetadata memory={memory} />

                        <h2>
                          {memory.key.replaceAll("_", " ")}
                        </h2>
                        <MemoryTags tags={memory.tags} />

                        {editing ? (
                          <>
                            <textarea
                              value={editingContent}
                              disabled={updating || archiving}
                              onChange={(event) => {
                                setEditingContent(
                                  event.target.value,
                                );
                                setActionError("");
                              }}
                            />
                            <input
                              aria-label="编辑记忆标签"
                              value={editingTags}
                              disabled={updating || archiving}
                              onChange={(event) => {
                                setEditingTags(event.target.value);
                                setActionError("");
                              }}
                            />

                            <button
                              className="secondary-button"
                              disabled={
                                updating ||
                                archiving ||
                                !editingContent.trim()
                              }
                              onClick={() =>
                                handleUpdate(memory.id)
                              }
                            >
                              {updating
                                ? "保存中…"
                                : "保存修改"}
                            </button>

                            <button
                              className="secondary-button"
                              disabled={updating || archiving}
                              onClick={() => {
                                setEditingId("");
                                setEditingContent("");
                                setEditingTags("");
                                setActionError("");
                              }}
                            >
                              取消
                            </button>
                          </>
                        ) : (
                          <>
                            <p>{memory.content}</p>

                            <button
                              className="secondary-button"
                              disabled={busy}
                              onClick={() => openMemory(memory.id)}
                            >
                              查看详情
                            </button>

                            <button
                              className="secondary-button"
                              disabled={busy}
                              onClick={() => {
                                setEditingId(memory.id);
                                setEditingContent(
                                  memory.content,
                                );
                                setEditingTags(
                                  memory.tags.join(", "),
                                );
                                setActionError("");
                              }}
                            >
                              编辑
                            </button>

                            <button
                              className="secondary-button"
                              disabled={busy}
                              onClick={() =>
                                handleArchive(
                                  memory.id,
                                  memory.key,
                                )
                              }
                            >
                              {archiving
                                ? "归档中…"
                                : "归档"}
                            </button>
                          </>
                        )}
                      </article>
                    );
                  })}
                  </section>
                </>
              ) : (
                <MemoryMessage
                  title="没有找到记忆"
                  description={
                    filters.q || filters.category || filters.tag
                      ? "没有与当前搜索、分类或标签匹配的记忆。"
                      : "目前还没有可显示的记忆。"
                  }
                />
              )}
            </>
          )}

          {state.status === "loading" && <MemoryLoading />}

          {state.status === "error" && (
            <MemoryMessage
              title="暂时无法读取记忆"
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

function ArchivedMemoryList({
  state,
  onOpen,
  onRetry,
}: {
  state: ArchivedState;
  onOpen(id: string): void;
  onRetry(): void;
}) {
  if (state.status === "loading") {
    return (
      <>
        <MemoryMessage
          title="已归档记忆"
          description="正在读取归档…"
        />
        <MemoryLoading />
      </>
    );
  }

  if (state.status === "error") {
    return (
      <MemoryMessage
        title="暂时无法读取归档"
        description="连接没有完成，请稍后重试。"
        action={
          <button
            className="secondary-button"
            onClick={onRetry}
          >
            重新加载
          </button>
        }
      />
    );
  }

  if (state.result.memories.length === 0) {
    return (
      <MemoryMessage
        title="已归档记忆"
        description="还没有归档记忆"
      />
    );
  }

  return (
    <>
      <section className="memory-message">
        <h2>已归档记忆</h2>
        <p>共 {state.result.metadata.count} 条</p>
      </section>
      <section className="memory-grid">
        {state.result.memories.map((memory) => (
          <article className="memory-card" key={memory.id}>
            <MemoryMetadata memory={memory} />
            <h2>{memory.key.replaceAll("_", " ")}</h2>
            <MemoryTags tags={memory.tags} />
            <p>{memory.content}</p>
            <button
              className="secondary-button"
              onClick={() => onOpen(memory.id)}
            >
              查看详情
            </button>
          </article>
        ))}
      </section>
    </>
  );
}

function ArchivedMemoryDetail({
  state,
  onRetry,
  onBack,
}: {
  state: DetailState;
  onRetry(): void;
  onBack(): void;
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
            <button className="secondary-button" onClick={onRetry}>
              重新加载
            </button>
            <button className="secondary-button" onClick={onBack}>
              返回归档列表
            </button>
          </>
        }
      />
    );
  }

  return (
    <section className="memory-message memory-detail">
      <p className="memory-detail-context">已归档记忆</p>
      <MemoryMetadata memory={state.memory} />
      <h2>{state.memory.key.replaceAll("_", " ")}</h2>
      <MemoryTags tags={state.memory.tags} />
      <p>{state.memory.content}</p>
      <button className="secondary-button" onClick={onBack}>
        返回归档列表
      </button>
    </section>
  );
}

function MemoryDetail({
  state,
  editing,
  editingContent,
  editingTags,
  updating,
  onEditingContentChange,
  onEditingTagsChange,
  onEdit,
  onCancel,
  onSave,
  onBack,
}: {
  state: DetailState;
  editing: boolean;
  editingContent: string;
  editingTags: string;
  updating: boolean;
  onEditingContentChange(value: string): void;
  onEditingTagsChange(value: string): void;
  onEdit(memory: MemoryRecord): void;
  onCancel(): void;
  onSave(): void;
  onBack(): void;
}) {
  if (state.status === "loading") {
    return (
      <MemoryMessage
        title="正在读取记忆"
        description="详情加载中…"
      />
    );
  }

  if (state.status === "error" || state.status === "idle") {
    return (
      <MemoryMessage
        title="无法读取记忆"
        description="该记忆不存在、无权访问或暂时不可用。"
        action={
          <button className="secondary-button" onClick={onBack}>
            返回记忆列表
          </button>
        }
      />
    );
  }

  const memory = state.memory;
  return (
    <section className="memory-message memory-detail">
      <MemoryMetadata memory={memory} />
      <h2>{memory.key.replaceAll("_", " ")}</h2>
      <MemoryTags tags={memory.tags} />

      {editing ? (
        <>
          <textarea
            aria-label="编辑记忆内容"
            value={editingContent}
            disabled={updating}
            onChange={(event) =>
              onEditingContentChange(event.target.value)
            }
          />
          <input
            aria-label="编辑记忆标签"
            value={editingTags}
            disabled={updating}
            onChange={(event) =>
              onEditingTagsChange(event.target.value)
            }
          />
          <button
            className="secondary-button"
            disabled={updating || !editingContent.trim()}
            onClick={onSave}
          >
            {updating ? "保存中…" : "保存修改"}
          </button>
          <button
            className="secondary-button"
            disabled={updating}
            onClick={onCancel}
          >
            取消
          </button>
        </>
      ) : (
        <>
          <p>{memory.content}</p>
          <button
            className="secondary-button"
            onClick={() => onEdit(memory)}
          >
            编辑
          </button>
          <button className="secondary-button" onClick={onBack}>
            返回记忆列表
          </button>
        </>
      )}
    </section>
  );
}

function MemoryTags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="memory-tags" aria-label="记忆标签">
      {tags.map((tag) => (
        <span key={tag}>#{tag}</span>
      ))}
    </div>
  );
}

function MemoryMetadata({ memory }: { memory: MemoryRecord }) {
  return (
    <div className="memory-card-topline">
      <span
        className={`memory-category memory-category-${memory.category}`}
      >
        {categoryLabels[memory.category]}
      </span>
      <span className="memory-source">
        {formatMemorySource(memory.source)}
      </span>
      <span>{formatUpdatedAt(memory.updated_at)}</span>
    </div>
  );
}

function MemoryLoading() {
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
