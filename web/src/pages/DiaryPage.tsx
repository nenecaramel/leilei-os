import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { WebApiClient } from "../api/useWebApiClient";
import { DiaryIcon } from "../components/icons";
import { NativeDateInput } from "../components/NativeDateInput";
import { DiaryPageHeader } from "./DiaryPageHeader";
import {
  DiaryPaperDateEditor,
  DiaryPaperEditor,
  DiaryPaperMetadataEditor,
  type DiaryPaperEditorHandle,
} from "./DiaryPaperEditor";
import { PaperDetailDialog } from "./PaperDetailDialog";
import {
  PaperAuthorSignature,
  type PaperAuthorValue,
} from "./PaperAuthorSignature";
import {
  formatDiaryPaperDate,
  formatDiaryRowDate,
  formatDiaryRowMeta,
  groupDiariesByMonth,
} from "./diary-presentation";
import { PageHeader } from "./PageHeader";
import { isSearchLocation, navigateWithinApp } from "./app-navigation";
import { consumeQuickCreateTarget } from "./quick-create";
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
  author: PaperAuthorValue;
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
function sameDiaryFilters(left: DiaryFilters, right: DiaryFilters): boolean {
  return left.q === right.q &&
    left.tag === right.tag &&
    left.mood === right.mood &&
    left.dateFrom === right.dateFrom &&
    left.dateTo === right.dateTo;
}

function useMobileDiaryLayout(): boolean {
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 760px)").matches
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  return mobile;
}

export function DiaryPageContent({
  api,
}: {
  api: WebApiClient;
}) {
  const isMobile = useMobileDiaryLayout();
  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile;
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
  const [detailReloadKey, setDetailReloadKey] = useState(0);
  const tracker = useRef(createLatestDiaryRequestTracker());
  const listController = useRef<AbortController | null>(null);
  const listAvailableRef = useRef(false);
  const loadedListUrlRef = useRef("");
  const pendingScrollRestore = useRef<number | null>(null);
  const mutationGate = useRef(createSubmissionGate());
  const mutationOwnership = useRef(createMutationOwnership());
  const [archiving, setArchiving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [permanentDeleteConfirmId, setPermanentDeleteConfirmId] = useState("");
  const [permanentDeletingId, setPermanentDeletingId] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const createTitleInput = useRef<HTMLInputElement | null>(null);
  const createEditorRef = useRef<DiaryPaperEditorHandle | null>(null);
  const paperTriggerRef = useRef<HTMLElement | null>(null);
  const focusCreateRef = useRef(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [date, setDate] = useState(getToday());
  const [tags, setTags] = useState("");
  const [mood, setMood] = useState("");
  const [author, setAuthor] = useState<PaperAuthorValue>(null);
  const [selectedDiary, setSelectedDiary] = useState<DiaryEntry | null>(null);
  const [editing, setEditing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingContent, setEditingContent] = useState("");
  const [editingDate, setEditingDate] = useState("");
  const [editingTags, setEditingTags] = useState("");
  const [editingMood, setEditingMood] = useState("");
  const [editingAuthor, setEditingAuthor] = useState<PaperAuthorValue>(null);
  const [actionError, setActionError] = useState("");
  const [filterError, setFilterError] = useState("");

  const createDirty = showCreate && (
    title !== "" || content !== "" || tags !== "" || mood !== "" ||
    date !== getToday() || author !== null
  );
  const editDirty = Boolean(selectedDiary && editing && (
    editingTitle !== selectedDiary.title ||
    editingContent !== selectedDiary.content ||
    editingDate !== selectedDiary.date ||
    editingTags !== selectedDiary.tags.join(", ") ||
    editingMood !== (selectedDiary.mood ?? "") ||
    editingAuthor !== selectedDiary.author
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
    const hasIntent = consumeQuickCreateTarget("diary");
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
    (window.requestAnimationFrame ?? ((callback: FrameRequestCallback) => window.setTimeout(callback, 0)))(() => {
      if (isMobileRef.current) createEditorRef.current?.focusTitle();
      else createTitleInput.current?.focus();
    });
  }, [showCreate]);

  function discardDraft(): void {
    if (createDirtyRef.current) {
      setTitle("");
      setContent("");
      setDate(getToday());
      setTags("");
      setMood("");
      setAuthor(null);
      setShowCreate(false);
    }
    if (editDirtyRef.current) {
      setEditing(false);
      setEditingTitle("");
      setEditingContent("");
      setEditingDate("");
      setEditingTags("");
      setEditingMood("");
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
    listAvailableRef.current = false;
    loadedListUrlRef.current = "";
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
    setEditingAuthor(null);
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
      const position = readDiaryScrollPosition(
        getDiaryScrollStorage(window),
        listUrl,
      );
      const canReuse =
        isMobileRef.current &&
        listAvailableRef.current &&
        loadedListUrlRef.current === listUrl;

      if (canReuse) {
        pendingScrollRestore.current = null;
        if (position !== null) {
          requestAnimationFrame(() => window.scrollTo({ top: position }));
        }
      } else {
        pendingScrollRestore.current = position;
        setState({ status: "loading" });
      }
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
    const listUrl = buildDiaryListRequest(filters).url;

    if (isDetail) {
      if (
        !isMobileRef.current ||
        !listAvailableRef.current ||
        loadedListUrlRef.current !== listUrl
      ) {
        invalidateList();
      }
      return;
    }

    if (isArchived || isArchivedDetail) {
      invalidateList();
      return;
    }

    if (
      isMobileRef.current &&
      listAvailableRef.current &&
      loadedListUrlRef.current === listUrl
    ) {
      const position = pendingScrollRestore.current;
      pendingScrollRestore.current = null;
      if (position !== null) {
        requestAnimationFrame(() => window.scrollTo({ top: position }));
      }
      return;
    }

    const controller = new AbortController();
    listController.current = controller;
    const ticket = tracker.current.begin();
    setState({ status: "loading" });
    void settleLatestDiaryRequest({
      request: api.request<DiaryListResponse>(
        listUrl,
        { signal: controller.signal },
      ),
      ticket,
      signal: controller.signal,
      onSuccess: (response) => {
        listAvailableRef.current = true;
        loadedListUrlRef.current = listUrl;
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
      if (!isMobileRef.current) window.scrollTo({ top: 0 });
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
      if (!isMobileRef.current) window.scrollTo({ top: 0 });
    }).catch(() => {
      if (controller.signal.aborted) return;
      setDetailState("error");
      setActionError("读取日记详情失败，请稍后重试。");
    });
    return () => controller.abort();
  }, [api, detailReloadKey, location]);

  function updateSearch(value: string): void {
    listAvailableRef.current = false;
    loadedListUrlRef.current = "";
    invalidateList();
    setState({ status: "loading" });
    setSearchDraft(value);
    searchDebouncer.current?.schedule(value);
  }
  function updateTag(value: string): void {
    listAvailableRef.current = false;
    loadedListUrlRef.current = "";
    invalidateList();
    setState({ status: "loading" });
    setTagDraft(value);
    tagDebouncer.current?.schedule(value);
  }
  function updateMood(value: string): void {
    listAvailableRef.current = false;
    loadedListUrlRef.current = "";
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
      navigateWithinApp(returnTo, window.history.state, { resetScroll: false });
      return;
    }
    const hadList =
      isMobileRef.current &&
      listAvailableRef.current &&
      loadedListUrlRef.current === returnTo;
    window.history.pushState(null, "", returnTo);
    const restored = readDiaryFilters(new URL(returnTo, window.location.origin).search);
    const position = readDiaryScrollPosition(
      getDiaryScrollStorage(window),
      returnTo,
    );
    pendingScrollRestore.current = hadList ? null : position;
    setFilters((current) =>
      isMobileRef.current && sameDiaryFilters(current, restored)
        ? current
        : restored
    );
    setSearchDraft(restored.q);
    setTagDraft(restored.tag);
    setMoodDraft(restored.mood);
    setLocation({ diaryId: null, returnTo: "/diary" });
    setSelectedDiary(null);
    setEditing(false);
    setEditingAuthor(null);
    if (hadList) {
      if (position !== null) {
        requestAnimationFrame(() => window.scrollTo({ top: position }));
      }
    } else {
      setState({ status: "loading" });
      setReloadKey((value) => value + 1);
    }
  }

  function openArchive(): void {
    if (!confirmAndDiscardDraft()) return;
    invalidateMutationContext();
    const returnTo = `/diary${buildDiaryListRequest(filters).search}`;
    if (isMobileRef.current) {
      searchDebouncer.current?.cancel();
      tagDebouncer.current?.cancel();
      moodDebouncer.current?.cancel();
      saveDiaryScrollPosition(
        getDiaryScrollStorage(window),
        returnTo,
        window.scrollY,
      );
    }
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
    if (isMobileRef.current) {
      navigateWithinApp(
        returnTo,
        window.history.state,
        { resetScroll: false },
      );
      return;
    }
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
    setPermanentDeleteConfirmId("");
    setPermanentDeletingId("");
    const archiveUrl = window.location.pathname + window.location.search;
    saveDiaryScrollPosition(
      getDiaryScrollStorage(window),
      archiveUrl,
      window.scrollY,
    );
    const next = createArchivedDiaryDetailLocation(id, archiveUrl);
    window.history.pushState(null, "", next);
    if (!isMobileRef.current) {
      setArchiveLocation({ archived: false, returnTo: "/diary" });
    }
    setArchivedDetailLocation(
      getArchivedDiaryDetailLocation(window.location.search),
    );
  }

  function closeArchivedDiary(): void {
    setPermanentDeleteConfirmId("");
    setPermanentDeletingId("");
    const returnTo = getSafeDiaryArchiveReturnTo(
      archivedDetailLocation.returnTo,
    );
    if (isSearchLocation(returnTo)) {
      navigateWithinApp(returnTo, window.history.state, { resetScroll: false });
      return;
    }
    const hadArchiveList =
      isMobileRef.current &&
      isArchived &&
      archivedState.status === "ready";
    window.history.pushState(null, "", returnTo);
    setArchivedDetailLocation({ diaryId: null, returnTo });
    setArchiveLocation(getDiaryArchiveLocation(window.location.search));

    if (isMobileRef.current) {
      const position = readDiaryScrollPosition(
        getDiaryScrollStorage(window),
        returnTo,
      );
      if (hadArchiveList) {
        if (position !== null) {
          requestAnimationFrame(() => window.scrollTo({ top: position }));
        }
      } else {
        setArchivedState({ status: "loading" });
        setArchiveReloadKey((value) => value + 1);
      }
    }
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
      listAvailableRef.current = false;
      loadedListUrlRef.current = "";
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
      listAvailableRef.current = false;
      loadedListUrlRef.current = "";
      pendingScrollRestore.current = readDiaryScrollPosition(
        getDiaryScrollStorage(window),
        activeReturnTo,
      );
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

  async function permanentlyDeleteDiary(id: string): Promise<void> {
    if (!permanentDeleteConfirmId || !mutationGate.current.enter()) return;
    const ticket = mutationOwnership.current.begin();
    setPermanentDeletingId(id);
    setActionError("");
    try {
      await api.request(`/diary/archived/${encodeURIComponent(id)}/permanent`, {
        method: "DELETE",
      });
      if (!mutationOwnership.current.owns(ticket)) return;
      setPermanentDeleteConfirmId("");
      setPermanentDeletingId("");
      setArchiveReloadKey((value) => value + 1);
      closeArchivedDiary();
    } catch {
      if (mutationOwnership.current.owns(ticket)) {
        setActionError("永久删除日记失败，请稍后重试。");
      }
    } finally {
      mutationGate.current.leave();
      if (mutationOwnership.current.owns(ticket)) setPermanentDeletingId("");
    }
  }

  const createInvalid = !title.trim() || !content.trim() || !date.trim();
  const updateInvalid =
    !editingTitle.trim() || !editingContent.trim() || !editingDate.trim();

  async function handleCreate(): Promise<void> {
    if (createInvalid) {
      setActionError("标题、正文和日期不能为空。");
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
      const response = await api.request<DiaryEntryResponse>("/diary", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
          date,
          tags: parseTags(tags),
          mood: mood.trim() || null,
          author,
        }),
      });
      if (!mutationOwnership.current.owns(ticket)) return;
      setTitle("");
      setContent("");
      setDate(getToday());
      setTags("");
      setMood("");
      setAuthor(null);
      setShowCreate(false);
      listAvailableRef.current = false;
      loadedListUrlRef.current = "";
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
    setEditingAuthor(diary.author ?? null);
    setActionError("");
  }

  async function handleUpdate(): Promise<void> {
    if (!selectedDiary || updateInvalid) return;
    if (editingAuthor == null) {
      setActionError("请选择作者");
      return;
    }
    if (!mutationGate.current.enter()) return;
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
            author: editingAuthor,
          }),
        },
      );
      if (!mutationOwnership.current.owns(ticket)) return;
      setSelectedDiary(response.data);
      setEditing(false);
      setEditingAuthor(response.data.author ?? null);
      listAvailableRef.current = false;
      loadedListUrlRef.current = "";
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


if (isMobile) {
  const busy = creating || updating || archiving;
  const showActiveBackground =
    !isDetail ||
    (
      listAvailableRef.current &&
      loadedListUrlRef.current === buildDiaryListRequest(filters).url
    );

  return (
    <div className="page memory-page diary-page">
      {!isArchived && !isArchivedDetail ? (
        <>
          {showActiveBackground ? (
            <DiaryPageHeader
              count={state.status === "ready" ? state.count : 0}
              dateFrom={filters.dateFrom}
              dateTo={filters.dateTo}
              moodDraft={moodDraft}
              tagDraft={tagDraft}
              searchDraft={searchDraft}
              filterError={filterError}
              busy={busy}
              onDateFromChange={(value) =>
                commitFilters({
                  ...filters,
                  q: searchDraft,
                  tag: tagDraft,
                  mood: moodDraft,
                  dateFrom: value,
                })
              }
              onDateToChange={(value) =>
                commitFilters({
                  ...filters,
                  q: searchDraft,
                  tag: tagDraft,
                  mood: moodDraft,
                  dateTo: value,
                })
              }
              onDateRangeClear={() =>
                commitFilters({
                  ...filters,
                  q: searchDraft,
                  tag: tagDraft,
                  mood: moodDraft,
                  dateFrom: "",
                  dateTo: "",
                })
              }
              onMoodChange={updateMood}
              onTagChange={updateTag}
              onSearchChange={updateSearch}
              onOpenArchive={(trigger) => {
                paperTriggerRef.current = trigger;
                openArchive();
              }}
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

          {actionError && !isDetail && !showCreate ? (
            <section className="memory-message">
              <h2>操作没有完成</h2>
              <p>{actionError}</p>
            </section>
          ) : null}

          {showActiveBackground ? (
            <>
              {showCreate ? (
                <PaperDetailDialog
                  id="diary-create-paper"
                  open
                  label="创建 Diary"
                  dateLabel={
                    <DiaryPaperDateEditor
                      value={date}
                      disabled={creating}
                      onChange={(value) => {
                        setDate(value);
                        setActionError("");
                      }}
                    />
                  }
                  signature=""
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
                        onClick={() => void handleCreate()}
                      >
                        {creating ? "保存中…" : "保存"}
                      </button>
                    </>
                  }
                  bottomLeft={
                    <>
                      <DiaryPaperMetadataEditor
                        moodValue={mood}
                        tagsValue={tags}
                        disabled={creating}
                        onMoodChange={(value) => {
                          setMood(value);
                          setActionError("");
                        }}
                        onTagsChange={(value) => {
                          setTags(value);
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
                    </>
                  }
                  errorMessage={actionError || null}
                >
                  <DiaryPaperEditor
                    ref={createEditorRef}
                    title={title}
                    content={content}
                    disabled={creating}
                    onTitleChange={(value) => {
                      setTitle(value);
                      setActionError("");
                    }}
                    onContentChange={(value) => {
                      setContent(value);
                      setActionError("");
                    }}
                  />
                </PaperDetailDialog>
              ) : null}

              {state.status === "ready" ? (
                state.diaries.length > 0 ? (
                  <MobileDiaryRows
                    diaries={state.diaries}
                    busy={busy}
                    label="Diary 列表"
                    onOpen={(id, trigger) => {
                      paperTriggerRef.current = trigger;
                      openDiary(id);
                    }}
                  />
                ) : (
                  <section className="memory-empty-state">
                    <p>
                      {hasFilters(filters)
                        ? "没有符合条件的日记"
                        : "还没有日记"}
                    </p>
                    {hasFilters(filters) ? (
                      <button
                        type="button"
                        className="secondary-button memory-empty-clear"
                        onClick={clearFilters}
                      >
                        清除条件
                      </button>
                    ) : null}
                  </section>
                )
              ) : null}

              {state.status === "loading" ? (
                <MobileDiaryLoading label="Diary 加载中" />
              ) : null}

              {state.status === "error" ? (
                <DiaryMessage
                  title="暂时无法读取日记"
                  description="筛选条件已保留，请稍后重试。"
                  action={
                    <button
                      className="secondary-button"
                      onClick={() => {
                        listAvailableRef.current = false;
                        loadedListUrlRef.current = "";
                        setReloadKey((value) => value + 1);
                      }}
                    >
                      重新加载
                    </button>
                  }
                />
              ) : null}
            </>
          ) : null}

          {isDetail ? (
            <MobileDiaryDetail
              state={detailState}
              diary={selectedDiary}
              triggerRef={paperTriggerRef}
              errorMessage={actionError || null}
              editing={editing}
              updating={updating}
              archiving={archiving}
              author={editingAuthor}
              onAuthorChange={(value) => {
                setEditingAuthor(value);
                setActionError("");
              }}
              values={{
                title: editingTitle,
                content: editingContent,
                date: editingDate,
                tags: editingTags,
                mood: editingMood,
              }}
              setValues={{
                title: (value) => {
                  setEditingTitle(value);
                  setActionError("");
                },
                content: (value) => {
                  setEditingContent(value);
                  setActionError("");
                },
                date: (value) => {
                  setEditingDate(value);
                  setActionError("");
                },
                tags: (value) => {
                  setEditingTags(value);
                  setActionError("");
                },
                mood: (value) => {
                  setEditingMood(value);
                  setActionError("");
                },
              }}
              invalid={updateInvalid}
              onEdit={beginEditing}
              onCancel={() => {
                if (!confirmAndDiscardDraft()) return;
                invalidateMutationContext();
                setEditing(false);
                setEditingAuthor(null);
                setActionError("");
              }}
              onSave={() => void handleUpdate()}
              onArchive={(id) => void archiveDiary(id)}
              onRetry={() => setDetailReloadKey((value) => value + 1)}
              onRequestClose={() => {
                if (!confirmAndDiscardDraft()) return false;
                closeDiary(true);
                return true;
              }}
            />
          ) : null}
        </>
      ) : (
        <>
          {isArchived ? (
            <MobileArchivedDiaryList
              state={archivedState}
              onBack={closeArchive}
              onOpen={(id, trigger) => {
                paperTriggerRef.current = trigger;
                openArchivedDiary(id);
              }}
              onRetry={() =>
                setArchiveReloadKey((value) => value + 1)
              }
            />
          ) : null}

          {isArchivedDetail ? (
            <MobileArchivedDiaryDetail
              state={archivedDetailState}
              diary={archivedDiary}
              triggerRef={paperTriggerRef}
              errorMessage={actionError || null}
              restoring={restoring}
              onRestore={(id) => void restoreDiary(id)}
              confirmingDelete={permanentDeleteConfirmId === archivedDetailLocation.diaryId}
              deleting={permanentDeletingId === archivedDetailLocation.diaryId}
              onRequestDelete={(id) => setPermanentDeleteConfirmId(id)}
              onConfirmDelete={(id) => void permanentlyDeleteDiary(id)}
              onCancelDelete={() => setPermanentDeleteConfirmId("")}
              onRetry={() =>
                setArchiveReloadKey((value) => value + 1)
              }
              onBack={closeArchivedDiary}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

  return (
    <div className="page memory-page">
      <PageHeader
        eyebrow="Personal journal"
        title="Diary"
        description="按时间记录、查看和整理属于蕾蕾的日常。"
        action={isArchivedDetail ? (
          <button
            className="secondary-button"
            disabled={restoring || permanentDeletingId === archivedDetailLocation.diaryId}
            onClick={closeArchivedDiary}
          >
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
          confirmingDelete={permanentDeleteConfirmId === archivedDetailLocation.diaryId}
          deleting={permanentDeletingId === archivedDetailLocation.diaryId}
          onRequestDelete={(id) => setPermanentDeleteConfirmId(id)}
          onConfirmDelete={(id) => void permanentlyDeleteDiary(id)}
          onCancelDelete={() => setPermanentDeleteConfirmId("")}
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
          author={editingAuthor}
          onAuthorChange={(value) => {
            setEditingAuthor(value);
            setActionError("");
          }}
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
            setEditingAuthor(null);
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
              <input ref={createTitleInput} aria-label="日记标题" placeholder="标题" value={title} disabled={creating} onChange={(event) => setTitle(event.target.value)} />
              <NativeDateInput aria-label="日记日期" type="date" value={date} disabled={creating} onChange={(event) => setDate(event.target.value)} />
              <input aria-label="日记心情" placeholder="心情（可选）" value={mood} disabled={creating} onChange={(event) => setMood(event.target.value)} />
              <input aria-label="日记标签" placeholder="标签，用逗号分隔（可选）" value={tags} disabled={creating} onChange={(event) => setTags(event.target.value)} />
              <textarea aria-label="日记正文" placeholder="今天发生了什么？" value={content} disabled={creating} onChange={(event) => setContent(event.target.value)} />
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
  author: PaperAuthorValue;
  onAuthorChange(value: "L" | "G"): void;
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
          <PaperAuthorSignature
            value={props.author}
            editable
            disabled={props.updating}
            onChange={props.onAuthorChange}
            error={props.author == null ? "请选择作者" : null}
          />
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
          <PaperAuthorSignature value={diary.author} editable={false} />
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
  confirmingDelete,
  deleting,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onRetry,
  restoring,
  state,
}: {
  diary: DiaryEntry | null;
  onBack(): void;
  onRestore(id: string): void;
  confirmingDelete: boolean;
  deleting: boolean;
  onRequestDelete(id: string): void;
  onConfirmDelete(id: string): void;
  onCancelDelete(): void;
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
      {confirmingDelete ? (
        <>
          <p>永久删除后无法恢复，确认继续吗？</p>
          <button className="secondary-button" disabled={deleting} onClick={onCancelDelete}>取消</button>
          <button className="secondary-button" disabled={deleting} onClick={() => onConfirmDelete(diary.id)}>{deleting ? "删除中…" : "确认永久删除"}</button>
        </>
      ) : (
        <>
          <button
            className="secondary-button"
            disabled={restoring || deleting}
            onClick={() => onRestore(diary.id)}
          >
            {restoring ? "恢复中…" : "恢复"}
          </button>
          <button className="secondary-button" disabled={restoring || deleting} onClick={() => onRequestDelete(diary.id)}>删除</button>
        </>
      )}
      <button className="secondary-button" disabled={deleting} onClick={onBack}>返回归档列表</button>
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
    <section className="memory-message memory-module-state">
      <div className="placeholder-icon"><DiaryIcon /></div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  );
}

function MobileDiaryLoading({ label }: { label: string }) {
  return (
    <section className="memory-months" aria-label={label}>
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
  );
}

function MobileDiaryRows({
  diaries,
  busy,
  label,
  onOpen,
}: {
  diaries: DiaryEntry[];
  busy: boolean;
  label: string;
  onOpen(id: string, trigger: HTMLElement): void;
}) {
  const groups = groupDiariesByMonth(diaries);

  return (
    <section className="memory-months" aria-label={label}>
      {groups.map((group) => (
        <section className="memory-month-section" key={group.key}>
          <h2 className="memory-month-label">{group.label}</h2>
          <div className="memory-month-card">
            {group.diaries.map((diary) => {
              const metadata = formatDiaryRowMeta(diary);
              return (
                <button
                  key={diary.id}
                  type="button"
                  className="memory-row"
                  data-diary-id={diary.id}
                  disabled={busy}
                  onClick={(event) => onOpen(diary.id, event.currentTarget)}
                >
                  <span className="memory-row-title">{diary.title}</span>
                  <span className="memory-row-meta">
                    <span>{formatDiaryRowDate(diary.date)}</span>
                    {metadata ? <span>{metadata}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </section>
  );
}

function MobileDiaryDetail({
  state,
  diary,
  triggerRef,
  errorMessage,
  editing,
  updating,
  archiving,
  author,
  onAuthorChange,
  values,
  setValues,
  invalid,
  onEdit,
  onCancel,
  onSave,
  onArchive,
  onRetry,
  onRequestClose,
}: {
  state: DetailState;
  diary: DiaryEntry | null;
  triggerRef: RefObject<HTMLElement | null>;
  errorMessage: string | null;
  editing: boolean;
  updating: boolean;
  archiving: boolean;
  author: PaperAuthorValue;
  onAuthorChange(value: "L" | "G"): void;
  values: Record<"title" | "content" | "date" | "tags" | "mood", string>;
  setValues: Record<
    "title" | "content" | "date" | "tags" | "mood",
    (value: string) => void
  >;
  invalid: boolean;
  onEdit(diary: DiaryEntry): void;
  onCancel(): void;
  onSave(): void;
  onArchive(id: string): void;
  onRetry(): void;
  onRequestClose(): boolean;
}) {
  if (state === "loading") {
    return (
      <PaperDetailDialog
        id="diary-detail-paper"
        open
        label="正在读取 Diary"
        dateLabel=""
        signature=""
        triggerRef={triggerRef}
        onRequestClose={onRequestClose}
      >
        <p className="memory-paper-status">正在读取日记…</p>
      </PaperDetailDialog>
    );
  }

  if (state === "error" || !diary) {
    return (
      <PaperDetailDialog
        id="diary-detail-paper"
        open
        label="无法读取 Diary"
        dateLabel=""
        signature=""
        triggerRef={triggerRef}
        onRequestClose={onRequestClose}
        topRight={
          <button className="memory-paper-control" onClick={onRetry}>
            重试
          </button>
        }
      >
        <p className="memory-paper-status">无法读取日记</p>
        <p className="memory-paper-content">
          该日记不存在、无权访问或暂时不可用。
        </p>
      </PaperDetailDialog>
    );
  }

  return (
    <PaperDetailDialog
      id="diary-detail-paper"
      open
      label={`Diary ${diary.title}`}
      dateLabel={
        editing ? (
          <DiaryPaperDateEditor
            value={values.date}
            disabled={updating}
            onChange={setValues.date}
          />
        ) : formatDiaryPaperDate(diary.date)
      }
      signature=""
      triggerRef={triggerRef}
      errorMessage={errorMessage}
      onRequestClose={onRequestClose}
      topRight={
        editing ? (
          <>
            <button
              className="memory-paper-control"
              disabled={updating}
              onClick={onCancel}
            >
              取消
            </button>
            <span>·</span>
            <button
              className="memory-paper-control"
              disabled={updating || invalid}
              onClick={onSave}
            >
              {updating ? "保存中…" : "保存"}
            </button>
          </>
        ) : (
          <>
            <button
              className="memory-paper-control"
              disabled={archiving}
              onClick={() => {
                if (window.confirm(`确定归档“${diary.title}”吗？`)) {
                  onArchive(diary.id);
                }
              }}
            >
              {archiving ? "归档中…" : "归档"}
            </button>
            <span>·</span>
            <button
              className="memory-paper-control"
              disabled={archiving}
              onClick={() => onEdit(diary)}
            >
              编辑
            </button>
          </>
        )
      }
      bottomLeft={
        editing ? (
          <>
            <DiaryPaperMetadataEditor
              moodValue={values.mood}
              tagsValue={values.tags}
              disabled={updating}
              onMoodChange={setValues.mood}
              onTagsChange={setValues.tags}
            />
            <PaperAuthorSignature
              value={author}
              editable
              disabled={updating}
              onChange={onAuthorChange}
              error={author == null ? "请选择作者" : null}
            />
          </>
        ) : (
          <>
            <span>{formatDiaryRowMeta(diary)}</span>
            <PaperAuthorSignature value={diary.author} editable={false} />
          </>
        )
      }
    >
      {editing ? (
        <DiaryPaperEditor
          title={values.title}
          content={values.content}
          disabled={updating}
          onTitleChange={setValues.title}
          onContentChange={setValues.content}
        />
      ) : (
        <>
          <h2 className="memory-paper-title">{diary.title}</h2>
          <p className="memory-paper-content">{diary.content}</p>
        </>
      )}
    </PaperDetailDialog>
  );
}

function MobileArchivedDiaryList({
  state,
  onBack,
  onOpen,
  onRetry,
}: {
  state: LoadState;
  onBack(): void;
  onOpen(id: string, trigger: HTMLElement): void;
  onRetry(): void;
}) {
  const count = state.status === "ready" ? state.count : 0;

  let body: ReactNode;
  if (state.status === "loading") {
    body = <MobileDiaryLoading label="已归档 Diary 加载中" />;
  } else if (state.status === "error") {
    body = (
      <DiaryMessage
        title="暂时无法读取归档日记"
        description="请稍后重试。"
        action={
          <button className="secondary-button" onClick={onRetry}>
            重新加载
          </button>
        }
      />
    );
  } else if (state.diaries.length === 0) {
    body = (
      <section className="memory-empty-state">
        <p>还没有归档日记</p>
      </section>
    );
  } else {
    body = (
      <MobileDiaryRows
        diaries={state.diaries}
        busy={false}
        label="已归档 Diary 列表"
        onOpen={onOpen}
      />
    );
  }

  return (
    <>
      <header className="memory-page-header memory-archive-header diary-archive-header">
        <div className="memory-page-heading">
          <div className="memory-page-title">Archive</div>
          <div className="memory-page-count">{count}篇日记</div>
        </div>
        <button
          type="button"
          className="memory-archive-back"
          onClick={onBack}
        >
          Return
        </button>
      </header>
      {body}
    </>
  );
}

function MobileArchivedDiaryDetail({
  state,
  diary,
  triggerRef,
  errorMessage,
  restoring,
  onRestore,
  confirmingDelete,
  deleting,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onRetry,
  onBack,
}: {
  state: DetailState;
  diary: DiaryEntry | null;
  triggerRef: RefObject<HTMLElement | null>;
  errorMessage: string | null;
  restoring: boolean;
  onRestore(id: string): void;
  confirmingDelete: boolean;
  deleting: boolean;
  onRequestDelete(id: string): void;
  onConfirmDelete(id: string): void;
  onCancelDelete(): void;
  onRetry(): void;
  onBack(): void;
}) {
  if (state === "loading") {
    return (
      <PaperDetailDialog
        id="diary-archive-detail-paper"
        open
        label="正在读取已归档 Diary"
        dateLabel=""
        signature=""
        triggerRef={triggerRef}
        onRequestClose={() => {
          if (restoring) return false;
          onBack();
          return true;
        }}
      >
        <p className="memory-paper-status">正在读取归档日记…</p>
      </PaperDetailDialog>
    );
  }

  if (state === "error" || !diary) {
    return (
      <PaperDetailDialog
        id="diary-archive-detail-paper"
        open
        label="无法读取已归档 Diary"
        dateLabel=""
        signature=""
        triggerRef={triggerRef}
        onRequestClose={() => {
          onBack();
          return true;
        }}
        topRight={
          <button className="memory-paper-control" onClick={onRetry}>
            重试
          </button>
        }
      >
        <p className="memory-paper-status">无法读取归档日记</p>
        <p className="memory-paper-content">
          该日记不存在、无权访问或暂时不可用。
        </p>
      </PaperDetailDialog>
    );
  }

  return (
    <PaperDetailDialog
      id="diary-archive-detail-paper"
      open
      label={`已归档 Diary ${diary.title}`}
      dateLabel={formatDiaryPaperDate(diary.date)}
      signature=""
      triggerRef={triggerRef}
      errorMessage={errorMessage}
      onRequestClose={() => {
        if (restoring || deleting) return false;
        onBack();
        return true;
      }}
      topRight={
        confirmingDelete ? (
          <>
            <button className="memory-paper-control" disabled={deleting} onClick={onCancelDelete}>取消</button>
            <span>·</span>
            <button className="memory-paper-control" disabled={deleting} onClick={() => onConfirmDelete(diary.id)}>{deleting ? "删除中…" : "确认永久删除"}</button>
          </>
        ) : (
          <>
            <button className="memory-paper-control" disabled={restoring || deleting} onClick={() => onRestore(diary.id)}>{restoring ? "恢复中…" : "恢复"}</button>
            <span>·</span>
            <button className="memory-paper-control" disabled={restoring || deleting} onClick={() => onRequestDelete(diary.id)}>删除</button>
          </>
        )
      }
      bottomLeft={
        <>
          <span>{formatDiaryRowMeta(diary)}</span>
          <PaperAuthorSignature value={diary.author} editable={false} />
        </>
      }
    >
      <h2 className="memory-paper-title">{diary.title}</h2>
      {confirmingDelete ? <p className="memory-paper-status">永久删除后无法恢复，确认继续吗？</p> : null}
      <p className="memory-paper-content">{diary.content}</p>
    </PaperDetailDialog>
  );
}
