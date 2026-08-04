import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { WebApiClient } from "../api/useWebApiClient";
import { DiaryIcon } from "../components/icons";
import { NativeDateInput } from "../components/NativeDateInput";
import type { SettingsData } from "../settings/types";
import { PageHeader } from "./PageHeader";
import { isSearchLocation, navigateWithinApp } from "./app-navigation";
import {
  confirmUnsavedChanges,
  createMutationOwnership,
  createSubmissionGate,
} from "./submission-gate";
import { useUnsavedChanges } from "./use-unsaved-changes";
import {
  createDiaryFilterDebouncer,
  pushDiaryFilterHistory,
  subscribeToDiaryFilterHistory,
} from "./diary-filter-history";
import {
  buildDiaryListRequest,
  createLatestDiaryRequestTracker,
  settleLatestDiaryRequest,
} from "./diary-list-request";
import {
  EMPTY_DIARY_FILTERS,
  createArchivedDiaryDetailLocation,
  createDiaryArchiveLocation,
  createDiaryDetailLocation,
  getArchivedDiaryDetailLocation,
  getDiaryArchiveLocation,
  getDiaryDetailLocation,
  getSafeDiaryArchiveReturnTo,
  getSafeDiaryReturnTo,
  readDiaryFilters,
  type DiaryFilters,
} from "./diary-location";
import {
  getDiaryScrollStorage,
  readDiaryScrollPosition,
  saveDiaryScrollPosition,
} from "./diary-scroll-restoration";

type DiaryEntry = {
  id: string;
  title: string;
  content: string;
  date: string;
  tags: string[];
  mood: string | null;
  created_at: string;
  updated_at: string;
};

type DiaryListResponse = {
  success: true;
  data: { diaries: DiaryEntry[]; metadata: { count: number } };
};
type DiaryEntryResponse = { success: true; data: DiaryEntry };
type LoadState =
  | { status: "loading" }
  | { status: "ready"; diaries: DiaryEntry[]; count: number }
  | { status: "error" };
type DetailState = "idle" | "loading" | "ready" | "error";

function getToday(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatDiaryDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function parseTags(value: string): string[] {
  return [...new Set(
    value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
  )];
}

function initialFilters(): DiaryFilters {
  return readDiaryFilters(window.location.search);
}
function initialLocation() {
  return getDiaryDetailLocation(window.location.search);
}
function initialArchiveLocation() {
  return getDiaryArchiveLocation(window.location.search);
}
function initialArchivedDetailLocation() {
  return getArchivedDiaryDetailLocation(window.location.search);
}
function hasFilters(filters: DiaryFilters): boolean {
  return Object.values(filters).some((value) => value.trim() !== "");
}
export function DiaryPageContent({
  api,
  settings,
}: {
  api: WebApiClient;
  settings: SettingsData;
}) {
  const [filters, setFilters] = useState(initialFilters);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const [searchDraft, setSearchDraft] = useState(() => initialFilters().q);
  const [tagDraft, setTagDraft] = useState(() => initialFilters().tag);
  const [moodDraft, setMoodDraft] = useState(() => initialFilters().mood);
  const searchDraftRef = useRef(searchDraft);
  searchDraftRef.current = searchDraft;
  const tagDraftRef = useRef(tagDraft);
  tagDraftRef.current = tagDraft;
  const moodDraftRef = useRef(moodDraft);
  moodDraftRef.current = moodDraft;
  const [location, setLocation] = useState(initialLocation);
  const [archiveLocation, setArchiveLocation] =
    useState(initialArchiveLocation);
  const [archivedDetailLocation, setArchivedDetailLocation] =
    useState(initialArchivedDetailLocation);
  const isArchived = archiveLocation.archived;
  const isArchivedDetail = archivedDetailLocation.diaryId !== null;
  const isDetail = location.diaryId !== null;
  const [detailState, setDetailState] = useState<DetailState>(
    () => initialLocation().diaryId ? "loading" : "idle",
  );
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [archivedState, setArchivedState] =
    useState<LoadState>({ status: "loading" });
  const [archivedDetailState, setArchivedDetailState] =
    useState<DetailState>(
      () => initialArchivedDetailLocation().diaryId
        ? "loading"
        : "idle",
    );
  const [archivedDiary, setArchivedDiary] =
    useState<DiaryEntry | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [archiveReloadKey, setArchiveReloadKey] = useState(0);
  const tracker = useRef(createLatestDiaryRequestTracker());
  const listController = useRef<AbortController | null>(null);
  const pendingScrollRestore = useRef<number | null>(null);
  const mutationGate = useRef(createSubmissionGate());
  const mutationOwnership = useRef(createMutationOwnership());
  const [archiving, setArchiving] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [date, setDate] = useState(getToday());
  const [tags, setTags] = useState("");
  const [mood, setMood] = useState("");
  const [selectedDiary, setSelectedDiary] = useState<DiaryEntry | null>(null);
  const [editing, setEditing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingContent, setEditingContent] = useState("");
  const [editingDate, setEditingDate] = useState("");
  const [editingTags, setEditingTags] = useState("");
  const [editingMood, setEditingMood] = useState("");
  const [actionError, setActionError] = useState("");
  const [filterError, setFilterError] = useState("");

  const createDirty = showCreate && (
    title !== "" || content !== "" || tags !== "" || mood !== "" ||
    date !== getToday()
  );
  const editDirty = Boolean(selectedDiary && editing && (
    editingTitle !== selectedDiary.title ||
    editingContent !== selectedDiary.content ||
    editingDate !== selectedDiary.date ||
    editingTags !== selectedDiary.tags.join(", ") ||
    editingMood !== (selectedDiary.mood ?? "")
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

  function discardDraft(): void {
    if (createDirtyRef.current) {
      setTitle("");
      setContent("");
      setDate(getToday());
      setTags("");
      setMood("");
      setShowCreate(false);
    }
    if (editDirtyRef.current) {
      setEditing(false);
      setEditingTitle("");
      setEditingContent("");
      setEditingDate("");
      setEditingTags("");
      setEditingMood("");
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
      setArchiving(false);
      setRestoring(false);
    }
  }

  const searchDebouncer = useRef<
    ReturnType<typeof createDiaryFilterDebouncer> | null
  >(null);
  const tagDebouncer = useRef<
    ReturnType<typeof createDiaryFilterDebouncer> | null
  >(null);
  const moodDebouncer = useRef<
    ReturnType<typeof createDiaryFilterDebouncer> | null
  >(null);

  function invalidateList(): void {
    tracker.current.invalidate();
    listController.current?.abort();
    listController.current = null;
  }

  function commitFilters(
    next: DiaryFilters,
    options: { keepSearchTimer?: boolean; keepTagTimer?: boolean } = {},
  ): void {
    if (!options.keepSearchTimer) searchDebouncer.current?.cancel();
    if (!options.keepTagTimer) tagDebouncer.current?.cancel();
    moodDebouncer.current?.cancel();
    if (next.dateFrom && next.dateTo && next.dateFrom > next.dateTo) {
      setFilterError("开始日期不能晚于结束日期。");
      return;
    }
    setFilterError("");
    pendingScrollRestore.current = null;
    invalidateList();
    setState({ status: "loading" });
    pushDiaryFilterHistory(window, next);
    setFilters(next);
    setSearchDraft(next.q);
    setTagDraft(next.tag);
    setMoodDraft(next.mood);
  }

  if (!searchDebouncer.current) {
    searchDebouncer.current = createDiaryFilterDebouncer({
      delayMs: 300,
      commit: (q) => commitFilters(
        {
          ...filtersRef.current,
          q,
          tag: tagDraftRef.current,
          mood: moodDraftRef.current,
        },
        { keepSearchTimer: true },
      ),
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
    });
  }
  if (!tagDebouncer.current) {
    tagDebouncer.current = createDiaryFilterDebouncer({
      delayMs: 300,
      commit: (tag) => commitFilters(
        {
          ...filtersRef.current,
          q: searchDraftRef.current,
          tag,
          mood: moodDraftRef.current,
        },
        { keepTagTimer: true },
      ),
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
    });
  }
  if (!moodDebouncer.current) {
    moodDebouncer.current = createDiaryFilterDebouncer({
      delayMs: 300,
      commit: (mood) => commitFilters({
        ...filtersRef.current,
        q: searchDraftRef.current,
        tag: tagDraftRef.current,
        mood,
      }),
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
    });
  }

  useEffect(() => subscribeToDiaryFilterHistory(window, (restored) => {
    if (!confirmAndDiscardDraft()) {
      window.history.pushState(null, "", currentUrlRef.current);
      return;
    }
    invalidateMutationContext();
    searchDebouncer.current?.cancel();
    tagDebouncer.current?.cancel();
    moodDebouncer.current?.cancel();
    invalidateList();
    const restoredLocation = initialLocation();
    const restoredArchiveLocation = initialArchiveLocation();
    const restoredArchivedDetailLocation =
      initialArchivedDetailLocation();
    setFilters(restored);
    setSearchDraft(restored.q);
    setTagDraft(restored.tag);
    setMoodDraft(restored.mood);
    setFilterError("");
    setActionError("");
    setSelectedDiary(null);
    setEditing(false);
    setLocation(restoredLocation);
    setArchiveLocation(restoredArchiveLocation);
    setArchivedDetailLocation(restoredArchivedDetailLocation);
    setDetailState(restoredLocation.diaryId ? "loading" : "idle");
    setArchivedDetailState(
      restoredArchivedDetailLocation.diaryId ? "loading" : "idle",
    );
    if (
      !restoredLocation.diaryId &&
      !restoredArchiveLocation.archived &&
      !restoredArchivedDetailLocation.diaryId
    ) {
      const listUrl =
        `/diary${buildDiaryListRequest(restored).search}`;
      pendingScrollRestore.current =
        readDiaryScrollPosition(
          getDiaryScrollStorage(window),
          listUrl,
        );
      setState({ status: "loading" });
    }
  }), []);

  useEffect(() => () => {
    invalidateMutationContext(false);
    searchDebouncer.current?.cancel();
    tagDebouncer.current?.cancel();
    moodDebouncer.current?.cancel();
    invalidateList();
  }, []);

  useEffect(() => {
    if (isDetail || isArchived || isArchivedDetail) {
      invalidateList();
      return;
    }
    const controller = new AbortController();
    listController.current = controller;
    const ticket = tracker.current.begin();
    setState({ status: "loading" });
    void settleLatestDiaryRequest({
      request: api.request<DiaryListResponse>(
        buildDiaryListRequest(filters).url,
        { signal: controller.signal },
      ),
      ticket,
      signal: controller.signal,
      onSuccess: (response) => {
        setState({
          status: "ready",
          diaries: response.data.diaries,
          count: response.data.metadata.count,
        });
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
      if (listController.current === controller) listController.current = null;
    });
    return () => {
      tracker.current.invalidate();
      controller.abort();
      if (listController.current === controller) listController.current = null;
    };
  }, [api, filters, isArchived, isArchivedDetail, isDetail, reloadKey]);

  useEffect(() => {
    if (!isArchived) return;
    const controller = new AbortController();
    setArchivedState({ status: "loading" });
    api.request<DiaryListResponse>("/diary/archived", {
      signal: controller.signal,
    }).then((response) => {
      if (controller.signal.aborted) return;
      setArchivedState({
        status: "ready",
        diaries: response.data.diaries,
        count: response.data.metadata.count,
      });
      const position = readDiaryScrollPosition(
        getDiaryScrollStorage(window),
        window.location.pathname + window.location.search,
      );
      if (position !== null) {
        requestAnimationFrame(() => window.scrollTo({ top: position }));
      }
    }).catch(() => {
      if (!controller.signal.aborted) setArchivedState({ status: "error" });
    });
    return () => controller.abort();
  }, [api, archiveReloadKey, isArchived]);

  useEffect(() => {
    const id = archivedDetailLocation.diaryId;
    if (!id) {
      setArchivedDiary(null);
      setArchivedDetailState("idle");
      return;
    }
    const controller = new AbortController();
    setArchivedDiary(null);
    setArchivedDetailState("loading");
    api.request<DiaryEntryResponse>(
      `/diary/archived/${encodeURIComponent(id)}`,
      { signal: controller.signal },
    ).then((response) => {
      if (controller.signal.aborted) return;
      setArchivedDiary(response.data);
      setArchivedDetailState("ready");
      window.scrollTo({ top: 0 });
    }).catch(() => {
      if (!controller.signal.aborted) setArchivedDetailState("error");
    });
    return () => controller.abort();
  }, [api, archiveReloadKey, archivedDetailLocation]);

  useEffect(() => {
    const id = location.diaryId;
    if (!id) {
      setSelectedDiary(null);
      setDetailState("idle");
      return;
    }
    const controller = new AbortController();
    setSelectedDiary(null);
    setDetailState("loading");
    setActionError("");
    api.request<DiaryEntryResponse>(
      `/diary/${encodeURIComponent(id)}`,
      { signal: controller.signal },
    ).then((response) => {
      if (controller.signal.aborted) return;
      setSelectedDiary(response.data);
      setDetailState("ready");
      window.scrollTo({ top: 0 });
    }).catch(() => {
      if (controller.signal.aborted) return;
      setDetailState("error");
      setActionError("读取日记详情失败，请稍后重试。");
    });
    return () => controller.abort();
  }, [api, location]);

  function updateSearch(value: string): void {
    invalidateList();
    setState({ status: "loading" });
    setSearchDraft(value);
    searchDebouncer.current?.schedule(value);
  }
  function updateTag(value: string): void {
    invalidateList();
    setState({ status: "loading" });
    setTagDraft(value);
    tagDebouncer.current?.schedule(value);
  }
  function updateMood(value: string): void {
    invalidateList();
    setState({ status: "loading" });
    setMoodDraft(value);
    moodDebouncer.current?.schedule(value);
  }
  function clearFilters(): void {
    commitFilters(EMPTY_DIARY_FILTERS);
  }
  function openDiary(id: string, skipSafety = false): void {
    if (!skipSafety && !confirmAndDiscardDraft()) return;
    if (!skipSafety) invalidateMutationContext();
    const returnTo = `/diary${buildDiaryListRequest(filters).search}`;
    saveDiaryScrollPosition(
      getDiaryScrollStorage(window),
      returnTo,
      window.scrollY,
    );
    const next = createDiaryDetailLocation(id, returnTo);
    window.history.pushState(null, "", next);
    setLocation(getDiaryDetailLocation(window.location.search));
    setDetailState("loading");
  }
  function closeDiary(skipSafety = false): void {
    if (!skipSafety && !confirmAndDiscardDraft()) return;
    if (!skipSafety) invalidateMutationContext();
    const returnTo = getSafeDiaryReturnTo(location.returnTo);
    if (isSearchLocation(returnTo)) {
      navigateWithinApp(returnTo, window.history.state);
      return;
    }
    window.history.pushState(null, "", returnTo);
    const restored = readDiaryFilters(new URL(returnTo, window.location.origin).search);
    pendingScrollRestore.current =
      readDiaryScrollPosition(
        getDiaryScrollStorage(window),
        returnTo,
      );
    setFilters(restored);
    setSearchDraft(restored.q);
    setTagDraft(restored.tag);
    setMoodDraft(restored.mood);
    setLocation({ diaryId: null, returnTo: "/diary" });
    setSelectedDiary(null);
    setEditing(false);
    setState({ status: "loading" });
  }

  function openArchive(): void {
    if (!confirmAndDiscardDraft()) return;
    invalidateMutationContext();
    const returnTo = `/diary${buildDiaryListRequest(filters).search}`;
    const next = createDiaryArchiveLocation(returnTo);
    window.history.pushState(null, "", next);
    setArchiveLocation(getDiaryArchiveLocation(window.location.search));
    setLocation({ diaryId: null, returnTo: "/diary" });
    setArchivedDetailLocation({
      diaryId: null,
      returnTo: createDiaryArchiveLocation(returnTo),
    });
  }

  function closeArchive(): void {
    const returnTo = getSafeDiaryReturnTo(archiveLocation.returnTo);
    window.history.pushState(null, "", returnTo);
    const restored = readDiaryFilters(
      new URL(returnTo, window.location.origin).search,
    );
    setFilters(restored);
    setSearchDraft(restored.q);
    setTagDraft(restored.tag);
    setMoodDraft(restored.mood);
    setArchiveLocation({ archived: false, returnTo: "/diary" });
    setState({ status: "loading" });
  }

  function openArchivedDiary(id: string): void {
    const archiveUrl = window.location.pathname + window.location.search;
    saveDiaryScrollPosition(
      getDiaryScrollStorage(window),
      archiveUrl,
      window.scrollY,
    );
    const next = createArchivedDiaryDetailLocation(id, archiveUrl);
    window.history.pushState(null, "", next);
    setArchiveLocation({ archived: false, returnTo: "/diary" });
    setArchivedDetailLocation(
      getArchivedDiaryDetailLocation(window.location.search),
    );
  }

  function closeArchivedDiary(): void {
    const returnTo = getSafeDiaryArchiveReturnTo(
      archivedDetailLocation.returnTo,
    );
    if (isSearchLocation(returnTo)) {
      navigateWithinApp(returnTo, window.history.state);
      return;
    }
    window.history.pushState(null, "", returnTo);
    setArchivedDetailLocation({ diaryId: null, returnTo });
    setArchiveLocation(getDiaryArchiveLocation(window.location.search));
  }

  async function archiveDiary(id: string): Promise<void> {
    if (!mutationGate.current.enter()) return;
    const ticket = mutationOwnership.current.begin();
    setArchiving(true);
    setActionError("");
    try {
      await api.request(`/diary/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!mutationOwnership.current.owns(ticket)) return;
      closeDiary(true);
      setReloadKey((value) => value + 1);
    } catch {
      if (mutationOwnership.current.owns(ticket)) {
        setActionError("归档日记失败，请稍后重试。");
      }
    } finally {
      mutationGate.current.leave();
      if (mutationOwnership.current.owns(ticket)) setArchiving(false);
    }
  }

  async function restoreDiary(id: string): Promise<void> {
    if (!mutationGate.current.enter()) return;
    const ticket = mutationOwnership.current.begin();
    setRestoring(true);
    setActionError("");
    try {
      await api.request(`/diary/archived/${encodeURIComponent(id)}/restore`, {
        method: "POST",
      });
      if (!mutationOwnership.current.owns(ticket)) return;
      const activeReturnTo = getDiaryArchiveLocation(
        new URL(
          archivedDetailLocation.returnTo,
          window.location.origin,
        ).search,
      ).returnTo;
      window.history.replaceState(null, "", activeReturnTo);
      const restored = readDiaryFilters(
        new URL(activeReturnTo, window.location.origin).search,
      );
      setFilters(restored);
      setSearchDraft(restored.q);
      setTagDraft(restored.tag);
      setMoodDraft(restored.mood);
      setArchivedDetailLocation({ diaryId: null, returnTo: "/diary" });
      setArchiveLocation({ archived: false, returnTo: "/diary" });
      setState({ status: "loading" });
      setReloadKey((value) => value + 1);
    } catch {
      if (mutationOwnership.current.owns(ticket)) {
        setActionError("恢复日记失败，请稍后重试。");
      }
    } finally {
      mutationGate.current.leave();
      if (mutationOwnership.current.owns(ticket)) setRestoring(false);
    }
  }

  const createInvalid = !title.trim() || !content.trim() || !date.trim();
  const updateInvalid =
    !editingTitle.trim() || !editingContent.trim() || !editingDate.trim();

  async function handleCreate(): Promise<void> {
    if (createInvalid || !mutationGate.current.enter()) return;
    const ticket = mutationOwnership.current.begin();
    setCreating(true);
    setActionError("");
    try {
      const response = await api.request<DiaryEntryResponse>("/diary", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
          date,
          tags: parseTags(tags),
          mood: mood.trim() || null,
        }),
      });
      if (!mutationOwnership.current.owns(ticket)) return;
      setTitle("");
      setContent("");
      setDate(getToday());
      setTags("");
      setMood("");
      setShowCreate(false);
      setReloadKey((value) => value + 1);
      openDiary(response.data.id, true);
    } catch {
      if (mutationOwnership.current.owns(ticket)) {
        setActionError("创建日记失败，请稍后重试。");
      }
    } finally {
      mutationGate.current.leave();
      if (mutationOwnership.current.owns(ticket)) setCreating(false);
    }
  }

  function beginEditing(diary: DiaryEntry): void {
    setEditing(true);
    setEditingTitle(diary.title);
    setEditingContent(diary.content);
    setEditingDate(diary.date);
    setEditingTags(diary.tags.join(", "));
    setEditingMood(diary.mood ?? "");
    setActionError("");
  }

  async function handleUpdate(): Promise<void> {
    if (!selectedDiary || updateInvalid || !mutationGate.current.enter()) return;
    const ticket = mutationOwnership.current.begin();
    setUpdating(true);
    setActionError("");
    try {
      const response = await api.request<DiaryEntryResponse>(
        `/diary/${selectedDiary.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            title: editingTitle.trim(),
            content: editingContent.trim(),
            date: editingDate,
            tags: parseTags(editingTags),
            mood: editingMood.trim() || null,
          }),
        },
      );
      if (!mutationOwnership.current.owns(ticket)) return;
      setSelectedDiary(response.data);
      setEditing(false);
      setReloadKey((value) => value + 1);
    } catch {
      if (mutationOwnership.current.owns(ticket)) {
        setActionError("修改日记失败，请稍后重试。");
      }
    } finally {
      mutationGate.current.leave();
      if (mutationOwnership.current.owns(ticket)) setUpdating(false);
    }
  }

  return (
    <div className="page memory-page">
      <PageHeader
        eyebrow="Personal journal"
        title="Diary"
        description={settings.page_copy.diary_subtitle ?? "按时间记录、查看和整理属于蕾蕾的日常。"}
        action={isArchivedDetail ? (
          <button className="secondary-button" onClick={closeArchivedDiary}>
            返回归档列表
          </button>
        ) : isArchived ? (
          <button className="secondary-button" onClick={closeArchive}>
            返回日记列表
          </button>
        ) : isDetail ? (
          <button className="secondary-button" disabled={updating} onClick={() => closeDiary()}>
            返回日记列表
          </button>
        ) : (
          <div className="page-header-actions">
            <button
              className="secondary-button"
              disabled={creating || updating}
              onClick={openArchive}
            >
              查看归档
            </button>
            <button
              className="secondary-button"
              disabled={creating || updating}
              onClick={() => {
                if (showCreate) {
                  if (!confirmAndDiscardDraft()) return;
                  invalidateMutationContext();
                  setShowCreate(false);
                } else {
                  setShowCreate(true);
                }
                setActionError("");
              }}
            >
              {showCreate ? "取消新增" : "新增日记"}
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

      {isArchivedDetail ? (
        <ArchivedDiaryDetail
          state={archivedDetailState}
          diary={archivedDiary}
          restoring={restoring}
          onBack={closeArchivedDiary}
          onRestore={(id) => void restoreDiary(id)}
          onRetry={() => setArchiveReloadKey((value) => value + 1)}
        />
      ) : isArchived ? (
        <ArchivedDiaryList
          state={archivedState}
          onBack={closeArchive}
          onOpen={openArchivedDiary}
          onRetry={() => setArchiveReloadKey((value) => value + 1)}
        />
      ) : isDetail ? (
        <DiaryDetail
          state={detailState}
          diary={selectedDiary}
          editing={editing}
          updating={updating}
          values={{
            title: editingTitle,
            content: editingContent,
            date: editingDate,
            tags: editingTags,
            mood: editingMood,
          }}
          setValues={{
            title: setEditingTitle,
            content: setEditingContent,
            date: setEditingDate,
            tags: setEditingTags,
            mood: setEditingMood,
          }}
          onEdit={beginEditing}
          onCancel={() => {
            if (!confirmAndDiscardDraft()) return;
            invalidateMutationContext();
            setEditing(false);
          }}
          onSave={handleUpdate}
          onArchive={(id) => void archiveDiary(id)}
          archiving={archiving}
          onBack={closeDiary}
          invalid={updateInvalid}
        />
      ) : (
        <>
          {showCreate && (
            <section className="memory-message">
              <h2>创建日记</h2>
              <input aria-label="日记标题" placeholder="标题" value={title} disabled={creating} onChange={(event) => setTitle(event.target.value)} />
              <NativeDateInput aria-label="日记日期" type="date" value={date} disabled={creating} onChange={(event) => setDate(event.target.value)} />
              <input aria-label="日记心情" placeholder="心情（可选）" value={mood} disabled={creating} onChange={(event) => setMood(event.target.value)} />
              <input aria-label="日记标签" placeholder="标签，用逗号分隔（可选）" value={tags} disabled={creating} onChange={(event) => setTags(event.target.value)} />
              <textarea aria-label="日记正文" placeholder="今天发生了什么？" value={content} disabled={creating} onChange={(event) => setContent(event.target.value)} />
              <button className="secondary-button" disabled={creating || createInvalid} onClick={handleCreate}>
                {creating ? "保存中…" : "保存日记"}
              </button>
            </section>
          )}

          <section className="memory-message diary-filters">
            <h2>搜索与筛选</h2>
            <input
              aria-label="搜索日记内容"
              placeholder="搜索日记内容"
              value={searchDraft}
              maxLength={200}
              onChange={(event) => updateSearch(event.target.value)}
            />
            <input
              aria-label="按标签筛选"
              placeholder="标签（精确匹配）"
              value={tagDraft}
              maxLength={50}
              onChange={(event) => updateTag(event.target.value)}
            />
            <input
              aria-label="按心情筛选"
              placeholder="心情（精确匹配）"
              value={moodDraft}
              maxLength={50}
              onChange={(event) => updateMood(event.target.value)}
            />
            <label>
              <span>开始日期</span>
              <NativeDateInput
                aria-label="开始日期"
                type="date"
                value={filters.dateFrom}
                max={filters.dateTo || undefined}
                onChange={(event) => commitFilters({ ...filters, dateFrom: event.target.value })}
              />
            </label>
            <label>
              <span>结束日期</span>
              <NativeDateInput
                aria-label="结束日期"
                type="date"
                value={filters.dateTo}
                min={filters.dateFrom || undefined}
                onChange={(event) => commitFilters({ ...filters, dateTo: event.target.value })}
              />
            </label>
            {filterError && <p role="alert">{filterError}</p>}
            {hasFilters(filters) && (
              <>
                <p>当前已应用搜索或筛选条件。</p>
                <button className="secondary-button" onClick={clearFilters}>清除全部</button>
              </>
            )}
          </section>
          {state.status === "ready" && state.diaries.length > 0 && (
            <>
              <section className="memory-message">
                <h2>日记列表</h2>
                <p>共 {state.count} 篇，按日期从新到旧排列。</p>
              </section>
              <section className="memory-grid">
                {state.diaries.map((diary) => (
                  <article className="memory-card" key={diary.id}>
                    <div className="memory-card-topline">
                      <span>{formatDiaryDate(diary.date)}</span>
                      {diary.mood && <span>{diary.mood}</span>}
                    </div>
                    <h2>{diary.title}</h2>
                    <p>{diary.content.length > 160 ? `${diary.content.slice(0, 160)}…` : diary.content}</p>
                    {diary.tags.length > 0 && <p>{diary.tags.map((tag) => `#${tag}`).join(" ")}</p>}
                    <button className="secondary-button" onClick={() => openDiary(diary.id)}>查看详情</button>
                  </article>
                ))}
              </section>
            </>
          )}
          {state.status === "ready" && state.diaries.length === 0 && (
            <DiaryMessage
              title={hasFilters(filters) ? "没有符合条件的日记" : "还没有日记"}
              description={hasFilters(filters) ? "调整或清除搜索和筛选条件后再试。" : "创建第一篇日记后，它会显示在这里。"}
              action={hasFilters(filters) ? <button className="secondary-button" onClick={clearFilters}>清除条件</button> : undefined}
            />
          )}
          {state.status === "loading" && <DiaryLoading />}
          {state.status === "error" && (
            <DiaryMessage
              title="暂时无法读取日记"
              description="筛选条件已保留，请稍后重试。"
              action={<button className="secondary-button" onClick={() => setReloadKey((value) => value + 1)}>重新加载</button>}
            />
          )}
        </>
      )}
    </div>
  );
}

function DiaryDetail(props: {
  state: DetailState;
  diary: DiaryEntry | null;
  editing: boolean;
  updating: boolean;
  values: Record<"title" | "content" | "date" | "tags" | "mood", string>;
  setValues: Record<"title" | "content" | "date" | "tags" | "mood", (value: string) => void>;
  onEdit(diary: DiaryEntry): void;
  onCancel(): void;
  onSave(): void;
  onArchive(id: string): void;
  archiving: boolean;
  onBack(): void;
  invalid: boolean;
}) {
  if (props.state === "loading") return <DiaryMessage title="正在读取日记" description="详情加载中…" />;
  if (props.state === "error" || !props.diary) {
    return <DiaryMessage title="无法读取日记" description="该日记不存在、无权访问或暂时不可用。" action={<button className="secondary-button" onClick={props.onBack}>返回日记列表</button>} />;
  }
  const diary = props.diary;
  return (
    <section className="memory-message">
      {props.editing ? (
        <>
          <h2>编辑日记</h2>
          <input aria-label="编辑日记标题" value={props.values.title} disabled={props.updating} onChange={(event) => props.setValues.title(event.target.value)} />
          <NativeDateInput aria-label="编辑日记日期" type="date" value={props.values.date} disabled={props.updating} onChange={(event) => props.setValues.date(event.target.value)} />
          <input aria-label="编辑日记心情" value={props.values.mood} disabled={props.updating} onChange={(event) => props.setValues.mood(event.target.value)} />
          <input aria-label="编辑日记标签" value={props.values.tags} disabled={props.updating} onChange={(event) => props.setValues.tags(event.target.value)} />
          <textarea aria-label="编辑日记正文" value={props.values.content} disabled={props.updating} onChange={(event) => props.setValues.content(event.target.value)} />
          <button className="secondary-button" disabled={props.updating || props.invalid} onClick={props.onSave}>{props.updating ? "保存中…" : "保存修改"}</button>
          <button className="secondary-button" disabled={props.updating} onClick={props.onCancel}>取消</button>
        </>
      ) : (
        <>
          <div className="memory-card-topline">
            <span>{formatDiaryDate(diary.date)}</span>
            {diary.mood && <span>{diary.mood}</span>}
          </div>
          <h2>{diary.title}</h2>
          <p>{diary.content}</p>
          {diary.tags.length > 0 && <p>{diary.tags.map((tag) => `#${tag}`).join(" ")}</p>}
          <button className="secondary-button" onClick={() => props.onEdit(diary)}>编辑</button>
          <button
            className="secondary-button"
            disabled={props.archiving}
            onClick={() => {
              if (window.confirm(`确定归档“${diary.title}”吗？`)) {
                props.onArchive(diary.id);
              }
            }}
          >
            {props.archiving ? "归档中…" : "归档"}
          </button>
          <button className="secondary-button" onClick={props.onBack}>返回日记列表</button>
        </>
      )}
    </section>
  );
}

function ArchivedDiaryList({
  state,
  onBack,
  onOpen,
  onRetry,
}: {
  state: LoadState;
  onBack(): void;
  onOpen(id: string): void;
  onRetry(): void;
}) {
  if (state.status === "loading") return <DiaryLoading />;
  if (state.status === "error") {
    return (
      <DiaryMessage
        title="暂时无法读取归档日记"
        description="请稍后重试。"
        action={<button className="secondary-button" onClick={onRetry}>重新加载</button>}
      />
    );
  }
  if (state.diaries.length === 0) {
    return (
      <DiaryMessage
        title="还没有归档日记"
        description="归档后的日记会显示在这里。"
        action={<button className="secondary-button" onClick={onBack}>返回日记列表</button>}
      />
    );
  }
  return (
    <>
      <section className="memory-message">
        <h2>已归档日记</h2>
        <p>共 {state.count} 篇，按日期从新到旧排列。</p>
      </section>
      <section className="memory-grid">
        {state.diaries.map((diary) => (
          <article className="memory-card" key={diary.id}>
            <div className="memory-card-topline">
              <span>{formatDiaryDate(diary.date)}</span>
              {diary.mood && <span>{diary.mood}</span>}
            </div>
            <h2>{diary.title}</h2>
            <p>{diary.content.length > 160
              ? `${diary.content.slice(0, 160)}…`
              : diary.content}</p>
            {diary.tags.length > 0 && (
              <p>{diary.tags.map((tag) => `#${tag}`).join(" ")}</p>
            )}
            <button className="secondary-button" onClick={() => onOpen(diary.id)}>
              查看详情
            </button>
          </article>
        ))}
      </section>
    </>
  );
}

function ArchivedDiaryDetail({
  diary,
  onBack,
  onRestore,
  onRetry,
  restoring,
  state,
}: {
  diary: DiaryEntry | null;
  onBack(): void;
  onRestore(id: string): void;
  onRetry(): void;
  restoring: boolean;
  state: DetailState;
}) {
  if (state === "loading") {
    return <DiaryMessage title="正在读取归档日记" description="详情加载中…" />;
  }
  if (state === "error" || !diary) {
    return (
      <DiaryMessage
        title="无法读取归档日记"
        description="该日记不存在、无权访问或暂时不可用。"
        action={
          <>
            <button className="secondary-button" onClick={onRetry}>重新加载</button>
            <button className="secondary-button" onClick={onBack}>返回归档列表</button>
          </>
        }
      />
    );
  }
  return (
    <section className="memory-message">
      <p>已归档日记</p>
      <div className="memory-card-topline">
        <span>{formatDiaryDate(diary.date)}</span>
        {diary.mood && <span>{diary.mood}</span>}
      </div>
      <h2>{diary.title}</h2>
      <p>{diary.content}</p>
      {diary.tags.length > 0 && (
        <p>{diary.tags.map((tag) => `#${tag}`).join(" ")}</p>
      )}
      <button
        className="secondary-button"
        disabled={restoring}
        onClick={() => onRestore(diary.id)}
      >
        {restoring ? "恢复中…" : "恢复"}
      </button>
      <button className="secondary-button" onClick={onBack}>返回归档列表</button>
    </section>
  );
}

function DiaryLoading() {
  return (
    <section className="memory-grid">
      {[0, 1, 2].map((item) => (
        <div className="memory-card memory-card-loading" key={item}>
          <span /><strong /><p />
        </div>
      ))}
    </section>
  );
}

function DiaryMessage({
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
      <div className="placeholder-icon"><DiaryIcon /></div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  );
}
