import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

type Scope = "active" | "archived";
type Author = "L" | "G" | "C";
type RecordValue = Record<string, unknown>;
type ToolInputParams = { arguments?: RecordValue };
type HostContext = { theme?: "light" | "dark"; platform?: string; [key: string]: unknown };

type PaperSummary = {
  id: string;
  title: string;
  preview: string;
  snippet: string | null;
  revision: number;
  created_by: Author;
  updated_by: Author;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type PaperDetail = {
  id: string;
  title: string;
  content: string;
  revision: number;
  created_by: Author;
  updated_by: Author;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type PaperEdit = {
  id: string;
  paper_id: string;
  base_revision: number;
  revision: number;
  author: Author;
  deleted_text: string;
  inserted_text: string;
  created_at: string;
};

type ToolResult = {
  isError?: boolean;
  structuredContent?: {
    success?: boolean;
    data?: RecordValue;
    error?: { code?: string; message?: string };
  };
};

type SharedPaperAppLike = {
  ontoolinput?: (params: ToolInputParams) => void;
  ontoolresult?: (params: RecordValue) => void;
  onhostcontextchanged?: (params: HostContext) => void;
  onteardown?: () => Promise<RecordValue>;
  connect: (transport?: Transport) => Promise<void>;
  getHostContext?: () => HostContext | undefined;
  callServerTool: (
    params: { name: string; arguments?: RecordValue },
    options?: { timeout?: number },
  ) => Promise<ToolResult>;
};

type SharedPaperWindow = Window & {
  openai?: RecordValue;
  sharedPaperApp?: {
    reload: () => Promise<void>;
    open: (id: string) => Promise<void>;
    state: () => RecordValue;
  };
  __LEILEIOS_DISABLE_SHARED_PAPER_APP_CONNECT__?: boolean;
};

const TOOL_TIMEOUT_MS = 18_000;
const PAPER_EDITOR_MIN_HEIGHT = 240;

class SharedPaperAppError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function objectOrEmpty(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseScope(value: unknown): Scope {
  return value === "archived" ? "archived" : "active";
}

function countOccurrences(source: string, needle: string): number {
  if (!needle) return source === "" ? 1 : 0;
  let count = 0;
  let offset = 0;
  while (offset <= source.length) {
    const index = source.indexOf(needle, offset);
    if (index < 0) break;
    count += 1;
    offset = index + 1;
  }
  return count;
}

export function buildUniqueEditReplacement(
  source: string,
  target: string,
): { matchText: string; replacementText: string } | null {
  if (source === target) return null;
  if (source === "") return { matchText: "", replacementText: target };

  const before = Array.from(source);
  const after = Array.from(target);
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  ) prefix += 1;

  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1;

  const originalStart = prefix;
  const originalEnd = before.length - suffix;
  const inserted = after.slice(prefix, after.length - suffix);

  let left = originalStart;
  let right = originalEnd;

  while (true) {
    const matchText = before.slice(left, right).join("");
    if (matchText && countOccurrences(source, matchText) === 1) {
      const replacementText = [
        ...before.slice(left, originalStart),
        ...inserted,
        ...before.slice(originalEnd, right),
      ].join("");
      return { matchText, replacementText };
    }
    if (left > 0) {
      left -= 1;
      continue;
    }
    if (right < before.length) {
      right += 1;
      continue;
    }
    return { matchText: source, replacementText: target };
  }
}

function actualChangedFragments(deletedText: string, insertedText: string): {
  deleted: string;
  inserted: string;
} {
  const before = Array.from(deletedText);
  const after = Array.from(insertedText);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1;
  return {
    deleted: before.slice(prefix, before.length - suffix).join(""),
    inserted: after.slice(prefix, after.length - suffix).join(""),
  };
}

function parsePaperSummary(value: unknown): PaperSummary | null {
  const source = objectOrEmpty(value);
  const id = asString(source.id);
  const title = asString(source.title);
  if (!id || !title) return null;
  return {
    id,
    title,
    preview: asString(source.preview),
    snippet: typeof source.snippet === "string" ? source.snippet : null,
    revision: asNumber(source.revision),
    created_by: (source.created_by as Author) || "L",
    updated_by: (source.updated_by as Author) || "L",
    created_at: asString(source.created_at),
    updated_at: asString(source.updated_at),
    archived_at: typeof source.archived_at === "string" ? source.archived_at : null,
  };
}

function parsePaperDetail(value: unknown): PaperDetail | null {
  const source = objectOrEmpty(value);
  const id = asString(source.id);
  const title = asString(source.title);
  if (!id || !title || typeof source.content !== "string") return null;
  return {
    id,
    title,
    content: source.content,
    revision: asNumber(source.revision),
    created_by: (source.created_by as Author) || "L",
    updated_by: (source.updated_by as Author) || "L",
    created_at: asString(source.created_at),
    updated_at: asString(source.updated_at),
    archived_at: typeof source.archived_at === "string" ? source.archived_at : null,
  };
}

function parseEdit(value: unknown): PaperEdit | null {
  const source = objectOrEmpty(value);
  const id = asString(source.id);
  const paperId = asString(source.paper_id);
  if (!id || !paperId) return null;
  return {
    id,
    paper_id: paperId,
    base_revision: asNumber(source.base_revision),
    revision: asNumber(source.revision),
    author: (source.author as Author) || "L",
    deleted_text: asString(source.deleted_text),
    inserted_text: asString(source.inserted_text),
    created_at: asString(source.created_at),
  };
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function resizePaperTextarea(node: HTMLTextAreaElement): void {
  const measuringNode = node.cloneNode(false) as HTMLTextAreaElement;
  measuringNode.value = node.value;
  measuringNode.style.position = "absolute";
  measuringNode.style.visibility = "hidden";
  measuringNode.style.pointerEvents = "none";
  measuringNode.style.height = "auto";
  measuringNode.style.minHeight = "0";
  measuringNode.style.maxHeight = "none";
  measuringNode.style.overflow = "hidden";
  const computedWidth = typeof window === "undefined" ? "" : window.getComputedStyle(node).width;
  if (computedWidth && computedWidth !== "auto") measuringNode.style.width = computedWidth;
  const parent = node.parentElement;
  if (parent) parent.appendChild(measuringNode);
  const height = measuringNode.scrollHeight;
  measuringNode.remove();
  node.style.height = `${Math.max(PAPER_EDITOR_MIN_HEIGHT, height)}px`;
}

function randomKey(prefix: string): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${random}`;
}

export function installSharedPaperAppRuntime(
  app: SharedPaperAppLike,
  windowRef: SharedPaperWindow = window,
  documentRef: Document = document,
): SharedPaperWindow["sharedPaperApp"] | null {
  const root = documentRef.querySelector<HTMLElement>("[data-shared-paper-app]");
  const status = documentRef.querySelector<HTMLElement>("[data-paper-status]");
  const search = documentRef.querySelector<HTMLInputElement>("[data-paper-search]");
  const scopeButton = documentRef.querySelector<HTMLButtonElement>("[data-paper-scope]");
  const list = documentRef.querySelector<HTMLElement>("[data-paper-list]");
  const empty = documentRef.querySelector<HTMLElement>("[data-paper-empty]");
  const detailNode = documentRef.querySelector<HTMLElement>("[data-paper-detail]");
  const detailTitle = documentRef.querySelector<HTMLElement>("[data-paper-detail-title]");
  const detailMeta = documentRef.querySelector<HTMLElement>("[data-paper-meta]");
  const contentNode = documentRef.querySelector<HTMLElement>("[data-paper-content]");
  const editor = documentRef.querySelector<HTMLElement>("[data-paper-editor]");
  const textarea = documentRef.querySelector<HTMLTextAreaElement>("[data-paper-editor] textarea");
  const editButton = documentRef.querySelector<HTMLButtonElement>("[data-paper-edit]");
  const saveButton = documentRef.querySelector<HTMLButtonElement>("[data-paper-save]");
  const cancelButton = documentRef.querySelector<HTMLButtonElement>("[data-paper-cancel]");
  const historyButton = documentRef.querySelector<HTMLButtonElement>("[data-paper-history]");
  const historyPanel = documentRef.querySelector<HTMLElement>("[data-paper-history-panel]");
  const historyList = documentRef.querySelector<HTMLElement>("[data-paper-history-list]");
  const closeHistory = documentRef.querySelector<HTMLButtonElement>("[data-paper-close-history]");
  const archiveButton = documentRef.querySelector<HTMLButtonElement>("[data-paper-archive]");
  const restoreButton = documentRef.querySelector<HTMLButtonElement>("[data-paper-restore]");
  const deleteButton = documentRef.querySelector<HTMLButtonElement>("[data-paper-delete]");
  const deleteConfirm = documentRef.querySelector<HTMLElement>("[data-paper-delete-confirm]");
  const cancelDelete = documentRef.querySelector<HTMLButtonElement>("[data-paper-cancel-delete]");
  const confirmDelete = documentRef.querySelector<HTMLButtonElement>("[data-paper-confirm-delete]");
  const conflict = documentRef.querySelector<HTMLElement>("[data-paper-conflict]");
  const useLatest = documentRef.querySelector<HTMLButtonElement>("[data-paper-use-latest]");
  const keepDraft = documentRef.querySelector<HTMLButtonElement>("[data-paper-keep-draft]");

  if (!root || !status || !search || !scopeButton || !list || !empty || !detailNode ||
      !detailTitle || !detailMeta || !contentNode || !editor || !textarea || !editButton ||
      !saveButton || !cancelButton || !historyButton || !historyPanel || !historyList ||
      !closeHistory || !archiveButton || !restoreButton || !deleteButton || !deleteConfirm ||
      !cancelDelete || !confirmDelete || !conflict || !useLatest || !keepDraft) return null;

  let connected = false;
  let destroyed = false;
  let scope: Scope = "active";
  let papers: PaperSummary[] = [];
  let selected: PaperDetail | null = null;
  let baseline: PaperDetail | null = null;
  let draft = "";
  let editing = false;
  let showingHistory = false;
  let conflictLatest: PaperDetail | null = null;
  let initialId = "";
  let busy = false;

  const setStatus = (message: string): void => {
    status.textContent = message;
  };

  const setBusy = (value: boolean): void => {
    busy = value;
    for (const node of [
      scopeButton, editButton, saveButton, cancelButton, historyButton,
      archiveButton, restoreButton, deleteButton, cancelDelete, confirmDelete,
      useLatest, keepDraft,
    ]) node.disabled = value;
  };

  const applyTheme = (context: HostContext | RecordValue): void => {
    const theme = asString(context.theme);
    if (theme === "light" || theme === "dark") documentRef.documentElement.dataset.theme = theme;
  };

  const call = async (name: string, args: RecordValue = {}): Promise<RecordValue> => {
    const result = await app.callServerTool({ name, arguments: args }, { timeout: TOOL_TIMEOUT_MS });
    const structured = result.structuredContent;
    if (!result || result.isError === true || !structured || structured.success !== true) {
      const error = structured?.error;
      throw new SharedPaperAppError(
        asString(error?.code) || "SHARED_PAPER_APP_CALL_FAILED",
        asString(error?.message) || `${name} failed`,
      );
    }
    return objectOrEmpty(structured.data);
  };

  const renderList = (): void => {
    list.replaceChildren();
    empty.hidden = papers.length > 0;
    empty.textContent = scope === "archived" ? "还没有归档 Shared Paper。" : "还没有 Shared Paper。";
    for (const paper of papers) {
      const button = documentRef.createElement("button");
      button.type = "button";
      button.dataset.paperRow = paper.id;
      button.setAttribute("data-paper-row", "");
      button.setAttribute("aria-current", selected?.id === paper.id ? "true" : "false");
      const title = documentRef.createElement("span");
      title.setAttribute("data-paper-row-title", "");
      title.textContent = paper.title;
      const preview = documentRef.createElement("span");
      preview.setAttribute("data-paper-row-preview", "");
      preview.textContent = paper.snippet ?? paper.preview;
      button.append(title, preview);
      button.addEventListener("click", () => { void openPaper(paper.id); });
      list.append(button);
    }
  };

  const renderDetail = (): void => {
    if (!selected) {
      detailNode.hidden = true;
      return;
    }
    detailNode.hidden = false;
    detailTitle.textContent = selected.title;
    detailMeta.textContent = `revision ${selected.revision} · ${selected.updated_by} · ${formatDate(selected.updated_at)}`;
    contentNode.textContent = selected.content;
    contentNode.hidden = editing || showingHistory;
    editor.hidden = !editing || showingHistory;
    historyPanel.hidden = !showingHistory;
    conflict.hidden = !conflictLatest;
    deleteConfirm.hidden = true;
    archiveButton.hidden = selected.archived_at !== null || showingHistory || editing;
    restoreButton.hidden = selected.archived_at === null || showingHistory || editing;
    deleteButton.hidden = selected.archived_at === null || showingHistory || editing;
    editButton.hidden = selected.archived_at !== null || showingHistory || editing;
    historyButton.hidden = showingHistory || editing;
    if (editing) {
      textarea.value = draft;
      resizePaperTextarea(textarea);
    }
    renderList();
  };

  const clearDetail = (): void => {
    selected = null;
    baseline = null;
    draft = "";
    editing = false;
    showingHistory = false;
    conflictLatest = null;
    renderDetail();
  };

  const loadList = async (): Promise<void> => {
    if (!connected || destroyed) return;
    setBusy(true);
    setStatus("正在读取 Shared Paper…");
    try {
      const query = search.value.trim();
      const data = query
        ? await call("search_shared_papers", { query, limit: 50, scope })
        : await call("list_shared_papers", { limit: 50, scope });
      papers = Array.isArray(data.papers)
        ? data.papers.map(parsePaperSummary).filter((paper): paper is PaperSummary => paper !== null)
        : [];
      renderList();
      setStatus(`${papers.length} 张纸 · ${scope === "archived" ? "Archive" : "Active"}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Shared Paper 读取失败");
    } finally {
      setBusy(false);
    }
  };

  const openPaper = async (id: string): Promise<void> => {
    if (!connected || destroyed || !id) return;
    setBusy(true);
    setStatus("正在打开…");
    try {
      const data = await call("get_shared_paper", { id });
      const paper = parsePaperDetail(data.paper);
      if (!paper) throw new Error("Shared Paper detail is invalid");
      selected = paper;
      baseline = paper;
      draft = paper.content;
      editing = false;
      showingHistory = false;
      conflictLatest = null;
      renderDetail();
      setStatus(`revision ${paper.revision}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Shared Paper 打开失败");
    } finally {
      setBusy(false);
    }
  };

  const reconcileSave = async (paperId: string): Promise<"committed" | "not_committed" | "unknown"> => {
    try {
      const data = await call("get_shared_paper", { id: paperId });
      const latest = parsePaperDetail(data.paper);
      if (!latest) return "unknown";
      if (latest.content === draft) {
        selected = latest;
        baseline = latest;
        editing = false;
        conflictLatest = null;
        renderDetail();
        return "committed";
      }
      return "not_committed";
    } catch {
      return "unknown";
    }
  };

  const save = async (): Promise<void> => {
    if (!selected || !baseline || !editing || busy) return;
    const replacement = buildUniqueEditReplacement(baseline.content, draft);
    if (!replacement) {
      editing = false;
      renderDetail();
      setStatus("没有需要保存的修改。");
      return;
    }
    setBusy(true);
    setStatus("正在保存…");
    try {
      await call("edit_shared_paper", {
        id: baseline.id,
        expected_revision: baseline.revision,
        author: "L",
        match_text: replacement.matchText,
        replacement_text: replacement.replacementText,
        idempotency_key: randomKey("shared.paper:app:edit"),
      });
      await openPaper(baseline.id);
      setStatus("已保存。");
    } catch (error) {
      if (error instanceof SharedPaperAppError && error.code === "PAPER_REVISION_CONFLICT") {
        try {
          const data = await call("get_shared_paper", { id: baseline.id });
          const latest = parsePaperDetail(data.paper);
          if (latest) {
            selected = latest;
            conflictLatest = latest;
            renderDetail();
            setStatus("检测到 revision conflict；草稿已保留。");
          } else {
            setStatus("冲突后无法读取最新内容。");
          }
        } catch {
          setStatus("冲突后无法读取最新内容。");
        }
      } else {
        const outcome = await reconcileSave(baseline.id);
        if (outcome === "committed") setStatus("已保存。");
        else setStatus(outcome === "unknown" ? "保存结果暂时无法确认，请重新打开后再操作。" : (error instanceof Error ? error.message : "保存失败"));
      }
    } finally {
      setBusy(false);
    }
  };

  const loadHistory = async (): Promise<void> => {
    if (!selected || busy) return;
    setBusy(true);
    setStatus("正在读取历史…");
    try {
      const data = await call("list_shared_paper_edits", { id: selected.id, limit: 100 });
      const edits = Array.isArray(data.edits)
        ? data.edits.map(parseEdit).filter((edit): edit is PaperEdit => edit !== null)
        : [];
      historyList.replaceChildren();
      for (const edit of edits) {
        const item = documentRef.createElement("div");
        item.setAttribute("data-paper-history-item", "");
        const meta = documentRef.createElement("div");
        meta.setAttribute("data-paper-history-meta", "");
        meta.textContent = `${edit.author} · ${edit.base_revision}→${edit.revision} · ${formatDate(edit.created_at)}`;
        const delta = documentRef.createElement("div");
        delta.setAttribute("data-paper-history-delta", "");
        const fragments = actualChangedFragments(edit.deleted_text, edit.inserted_text);
        if (fragments.deleted) {
          const deleted = documentRef.createElement("del");
          deleted.textContent = fragments.deleted;
          delta.append(deleted);
        }
        if (fragments.deleted && fragments.inserted) delta.append(documentRef.createTextNode(" "));
        if (fragments.inserted) {
          const inserted = documentRef.createElement("ins");
          inserted.textContent = fragments.inserted;
          delta.append(inserted);
        }
        if (!fragments.deleted && !fragments.inserted) delta.textContent = "saved";
        item.append(meta, delta);
        historyList.append(item);
      }
      const created = documentRef.createElement("div");
      created.setAttribute("data-paper-history-item", "");
      const createdMeta = documentRef.createElement("div");
      createdMeta.setAttribute("data-paper-history-meta", "");
      createdMeta.textContent = `Created · ${selected.created_by} · revision 1 · ${formatDate(selected.created_at)}`;
      created.append(createdMeta);
      historyList.append(created);
      showingHistory = true;
      editing = false;
      renderDetail();
      setStatus(`${edits.length} 条 committed edit`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "历史读取失败");
    } finally {
      setBusy(false);
    }
  };

  const lifecycleReadback = async (
    paperId: string,
    expected: "archived" | "active" | "deleted",
  ): Promise<"committed" | "not_committed" | "unknown"> => {
    try {
      const data = await call("get_shared_paper", { id: paperId });
      const latest = parsePaperDetail(data.paper);
      if (!latest) return "unknown";
      if (expected === "deleted") return "not_committed";
      const isArchived = latest.archived_at !== null;
      if (expected === "archived" && isArchived) return "committed";
      if (expected === "active" && !isArchived) return "committed";
      return "not_committed";
    } catch (error) {
      if (expected === "deleted" && error instanceof SharedPaperAppError && error.code === "PAPER_NOT_FOUND") return "committed";
      return "unknown";
    }
  };

  const runLifecycle = async (
    tool: "archive_shared_paper" | "restore_shared_paper" | "delete_shared_paper",
    expected: "archived" | "active" | "deleted",
  ): Promise<void> => {
    if (!selected || busy) return;
    const paperId = selected.id;
    setBusy(true);
    setStatus(tool === "delete_shared_paper" ? "正在永久删除…" : "正在更新状态…");
    try {
      await call(tool, {
        id: paperId,
        idempotency_key: randomKey(`shared.paper:app:${tool}`),
      });
      clearDetail();
      await loadList();
      setStatus(expected === "deleted" ? "已永久删除。" : expected === "archived" ? "已归档。" : "已恢复。");
    } catch (error) {
      const readback = await lifecycleReadback(paperId, expected);
      if (readback === "committed") {
        clearDetail();
        await loadList();
        setStatus(expected === "deleted" ? "已永久删除。" : expected === "archived" ? "已归档。" : "已恢复。");
      } else {
        setStatus(readback === "unknown"
          ? "操作结果暂时无法确认，请重新读取后再操作。"
          : error instanceof Error ? error.message : "Shared Paper lifecycle 操作失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const applyInitialInput = (value: unknown): void => {
    const input = objectOrEmpty(value);
    const nextScope = parseScope(input.scope);
    const nextId = asString(input.id || input.paper_id);
    scope = nextScope;
    scopeButton.textContent = scope === "active" ? "归档" : "返回";
    if (nextId) initialId = nextId;
  };

  app.ontoolinput = (params) => {
    applyInitialInput(params.arguments);
    if (connected) {
      void loadList().then(() => initialId ? openPaper(initialId) : undefined);
    }
  };

  app.ontoolresult = (params) => {
    const structured = objectOrEmpty(params.structuredContent);
    const data = objectOrEmpty(structured.data);
    applyInitialInput(data);
  };

  app.onhostcontextchanged = (context) => applyTheme(context);
  app.onteardown = async () => {
    destroyed = true;
    return {};
  };

  search.addEventListener("input", () => {
    windowRef.clearTimeout(Number(search.dataset.timer || "0"));
    const timer = windowRef.setTimeout(() => { void loadList(); }, 180);
    search.dataset.timer = String(timer);
  });

  scopeButton.addEventListener("click", () => {
    scope = scope === "active" ? "archived" : "active";
    scopeButton.textContent = scope === "active" ? "归档" : "返回";
    search.value = "";
    clearDetail();
    void loadList();
  });

  editButton.addEventListener("click", () => {
    if (!selected || selected.archived_at) return;
    baseline = selected;
    draft = selected.content;
    editing = true;
    showingHistory = false;
    conflictLatest = null;
    renderDetail();
    textarea.focus();
  });

  textarea.addEventListener("input", () => {
    draft = textarea.value;
    resizePaperTextarea(textarea);
  });

  cancelButton.addEventListener("click", () => {
    if (!selected) return;
    draft = selected.content;
    editing = false;
    conflictLatest = null;
    renderDetail();
  });

  saveButton.addEventListener("click", () => { void save(); });
  historyButton.addEventListener("click", () => { void loadHistory(); });
  closeHistory.addEventListener("click", () => {
    showingHistory = false;
    renderDetail();
    setStatus(selected ? `revision ${selected.revision}` : "");
  });

  archiveButton.addEventListener("click", () => { void runLifecycle("archive_shared_paper", "archived"); });
  restoreButton.addEventListener("click", () => { void runLifecycle("restore_shared_paper", "active"); });
  deleteButton.addEventListener("click", () => {
    deleteConfirm.hidden = false;
  });
  cancelDelete.addEventListener("click", () => {
    deleteConfirm.hidden = true;
  });
  confirmDelete.addEventListener("click", () => {
    deleteConfirm.hidden = true;
    void runLifecycle("delete_shared_paper", "deleted");
  });

  useLatest.addEventListener("click", () => {
    if (!conflictLatest) return;
    selected = conflictLatest;
    baseline = conflictLatest;
    draft = conflictLatest.content;
    conflictLatest = null;
    editing = false;
    renderDetail();
    setStatus(`已使用最新 revision ${selected.revision}。`);
  });

  keepDraft.addEventListener("click", () => {
    if (!conflictLatest) return;
    selected = conflictLatest;
    baseline = conflictLatest;
    conflictLatest = null;
    editing = true;
    renderDetail();
    setStatus("草稿已保留；再次保存会基于最新 revision 提交。");
  });

  applyTheme(objectOrEmpty(windowRef.openai));
  const fallbackInput = objectOrEmpty(objectOrEmpty(windowRef.openai).toolInput);
  if (Object.keys(fallbackInput).length) applyInitialInput(fallbackInput);

  const controller = {
    reload: loadList,
    open: openPaper,
    state: () => ({
      scope,
      selectedId: selected?.id ?? null,
      revision: selected?.revision ?? null,
      editing,
      showingHistory,
      conflict: conflictLatest !== null,
    }),
  };
  windowRef.sharedPaperApp = controller;
  return controller;
}

export function startSharedPaperApp(
  windowRef: SharedPaperWindow = window,
  documentRef: Document = document,
): SharedPaperWindow["sharedPaperApp"] | null {
  const app = new App(
    { name: "LeileiOS Shared Paper", version: "1.0.0" },
    {},
    { autoResize: true, strict: true },
  ) as unknown as SharedPaperAppLike;
  const controller = installSharedPaperAppRuntime(app, windowRef, documentRef);
  if (!controller || windowRef.__LEILEIOS_DISABLE_SHARED_PAPER_APP_CONNECT__) return controller;
  const transport = new PostMessageTransport(windowRef.parent, windowRef.parent);
  void app.connect(transport)
    .then(async () => {
      applyConnectedHost(app, documentRef);
      const context = app.getHostContext?.();
      if (context) app.onhostcontextchanged?.(context);
      const privateController = windowRef.sharedPaperApp;
      if (privateController) await privateController.reload();
      const input = objectOrEmpty(objectOrEmpty(windowRef.openai).toolInput);
      const id = asString(input.id || input.paper_id);
      if (id && privateController) await privateController.open(id);
    })
    .catch((error: unknown) => {
      const status = documentRef.querySelector<HTMLElement>("[data-paper-status]");
      if (status) status.textContent = error instanceof Error ? error.message : "无法连接 MCP Apps host";
    });
  return controller;
}

function applyConnectedHost(app: SharedPaperAppLike, documentRef: Document): void {
  const status = documentRef.querySelector<HTMLElement>("[data-paper-status]");
  if (status) status.textContent = "已连接。";
  // Connection itself is the capability check. Server tools remain authoritative.
  void app;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  startSharedPaperApp();
}
