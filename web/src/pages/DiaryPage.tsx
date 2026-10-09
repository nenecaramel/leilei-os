import {
  useEffect,
  useRef,
  useState,
} from "react";
import type { WebApiClient } from "../api/useWebApiClient";
import { ModuleStateMessage } from "../components/ModuleSearch";
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
import { MobileDiaryLoading, MobileDiaryRows } from "./diary/DiaryListPresentation";
import { MobileDiaryDetail } from "./diary/DiaryDetailPresentation";
import { MobileArchivedDiaryList, MobileArchivedDiaryDetail } from "./diary/DiaryArchivePresentation";
import type { DiaryEntry, LoadState, DetailState } from "./diary/diary-page-types";
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
import { isUniverseNodeReturnTo } from "./universe/universe-location";
import {
  getDiaryScrollStorage,
  readDiaryScrollPosition,
  saveDiaryScrollPosition,
} from "./diary-scroll-restoration";

type DiaryListResponse = {
  success: true;
  data: { diaries: DiaryEntry[]; metadata: { count: number } };
};
type DiaryEntryResponse = { success: true; data: DiaryEntry };

function getToday(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
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
      createEditorRef.current?.focusTitle();
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
    if (isUniverseNodeReturnTo(returnTo)) {
      navigateWithinApp(returnTo, window.history.state, { resetScroll: false });
      return;
    }
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
    if (isUniverseNodeReturnTo(returnTo)) {
      navigateWithinApp(returnTo, window.history.state, { resetScroll: false });
      return;
    }
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
      const returnTo = getSafeDiaryReturnTo(location.returnTo);
      if (isUniverseNodeReturnTo(returnTo)) navigateWithinApp(returnTo, window.history.state, { resetScroll: false });
      else closeDiary(true);
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
      const directReturnTo = getSafeDiaryArchiveReturnTo(archivedDetailLocation.returnTo);
      if (isUniverseNodeReturnTo(directReturnTo)) {
        navigateWithinApp(directReturnTo, window.history.state, { resetScroll: false });
        return;
      }
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
      setSelectedDiary((current) =>
        current?.id === response.data.id
          ? {
              ...response.data,
              comments: current.comments,
              comments_metadata: current.comments_metadata,
            }
          : response.data
      );
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

          {!isMobile && showActiveBackground ? (
            <p className="desktop-page-description">
              按时间记录、查看和整理属于蕾蕾的日常。
            </p>
          ) : null}

          {actionError && !isDetail && !showCreate ? (
            <section className="memory-action-notice" role="status">{actionError}</section>
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
                ) : filters.q ? (
                  <ModuleStateMessage
                    state="empty"
                    emptyText="没有符合条件的日记"
                    errorText=""
                    action={<button type="button" className="secondary-button memory-empty-clear" onClick={clearFilters}>清除条件</button>}
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
                filters.q ? (
                  <ModuleStateMessage state="loading" placement="module" emptyText="" errorText="" loadingText="Searching..." />
                ) : <MobileDiaryLoading label="Diary 加载中" />
              ) : null}

              {state.status === "error" ? (
                <ModuleStateMessage
                  state="error"
                  placement={filters.q ? "module" : "page"}
                  emptyText=""
                  errorText="Unable to read diary entries."
                  retryLabel="Retry"
                  onRetry={() => {
                    listAvailableRef.current = false;
                    loadedListUrlRef.current = "";
                    setReloadKey((value) => value + 1);
                  }}
                />
              ) : null}
            </>
          ) : null}

          {isDetail ? (
            <MobileDiaryDetail
              api={api}
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
              onCommentsChange={(comments, metadata) => {
                setSelectedDiary((current) =>
                  current
                    ? { ...current, comments, comments_metadata: metadata }
                    : current
                );
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
              api={api}
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
              onCommentsChange={(comments, metadata) => {
                setArchivedDiary((current) =>
                  current
                    ? { ...current, comments, comments_metadata: metadata }
                    : current
                );
              }}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
