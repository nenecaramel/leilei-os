import { useEffect, useState } from "react";
import { useWebApiClient } from "../api/useWebApiClient";
import { DiaryIcon } from "../components/icons";
import { PageHeader } from "./PageHeader";

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
  data: {
    diaries: DiaryEntry[];
    metadata: {
      count: number;
    };
  };
};

type DiaryEntryResponse = {
  success: true;
  data: DiaryEntry;
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; diaries: DiaryEntry[]; count: number }
  | { status: "error" };

function getToday(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatDiaryDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
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

export function DiaryPage() {
  const api = useWebApiClient();

  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<LoadState>({
    status: "loading",
  });

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [date, setDate] = useState(getToday());
  const [tags, setTags] = useState("");
  const [mood, setMood] = useState("");

  const [selectedDiary, setSelectedDiary] =
    useState<DiaryEntry | null>(null);
  const [loadingDiaryId, setLoadingDiaryId] = useState("");

  const [editing, setEditing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingContent, setEditingContent] = useState("");
  const [editingDate, setEditingDate] = useState("");
  const [editingTags, setEditingTags] = useState("");
  const [editingMood, setEditingMood] = useState("");

  const [actionError, setActionError] = useState("");

  useEffect(() => {
    let active = true;

    setState({
      status: "loading",
    });

    api.request<DiaryListResponse>("/diary")
      .then((response) => {
        if (!active) {
          return;
        }

        setState({
          status: "ready",
          diaries: response.data.diaries,
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
    content.trim().length === 0 ||
    date.trim().length === 0;

  const updateInvalid =
    editingTitle.trim().length === 0 ||
    editingContent.trim().length === 0 ||
    editingDate.trim().length === 0;

  async function handleCreate() {
    if (createInvalid || creating) {
      return;
    }

    setCreating(true);
    setActionError("");

    try {
      const response = await api.request<DiaryEntryResponse>(
        "/diary",
        {
          method: "POST",
          body: JSON.stringify({
            title: title.trim(),
            content: content.trim(),
            date,
            tags: parseTags(tags),
            mood: mood.trim() || null,
          }),
        },
      );

      setTitle("");
      setContent("");
      setDate(getToday());
      setTags("");
      setMood("");
      setShowCreate(false);
      setSelectedDiary(response.data);
      setReloadKey((value) => value + 1);
    } catch {
      setActionError("创建日记失败，请稍后重试。");
    } finally {
      setCreating(false);
    }
  }

  async function handleReadDiary(id: string) {
    if (loadingDiaryId) {
      return;
    }

    setLoadingDiaryId(id);
    setActionError("");
    setEditing(false);

    try {
      const response = await api.request<DiaryEntryResponse>(
        `/diary/${id}`,
      );

      setSelectedDiary(response.data);
    } catch {
      setActionError("读取日记详情失败，请稍后重试。");
    } finally {
      setLoadingDiaryId("");
    }
  }

  function beginEditing(diary: DiaryEntry) {
    setEditing(true);
    setEditingTitle(diary.title);
    setEditingContent(diary.content);
    setEditingDate(diary.date);
    setEditingTags(diary.tags.join(", "));
    setEditingMood(diary.mood ?? "");
    setActionError("");
  }

  async function handleUpdate() {
    if (
      !selectedDiary ||
      updateInvalid ||
      updating
    ) {
      return;
    }

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

      setSelectedDiary(response.data);
      setEditing(false);
      setReloadKey((value) => value + 1);
    } catch {
      setActionError("修改日记失败，请稍后重试。");
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="page memory-page">
      <PageHeader
        eyebrow="Personal journal"
        title="Diary"
        description="按时间记录、查看和整理属于蕾蕾的日常。"
        action={
          <button
            className="secondary-button"
            disabled={creating || updating}
            onClick={() => {
              setShowCreate((value) => !value);
              setActionError("");
            }}
          >
            {showCreate ? "取消新增" : "新增日记"}
          </button>
        }
      />

      {actionError && (
        <section className="memory-message">
          <h2>操作没有完成</h2>
          <p>{actionError}</p>
        </section>
      )}

      {showCreate && (
        <section className="memory-message">
          <h2>创建日记</h2>

          <input
            placeholder="标题"
            value={title}
            disabled={creating}
            onChange={(event) => {
              setTitle(event.target.value);
              setActionError("");
            }}
          />

          <input
            type="date"
            value={date}
            disabled={creating}
            onChange={(event) => {
              setDate(event.target.value);
              setActionError("");
            }}
          />

          <input
            placeholder="心情（可选）"
            value={mood}
            disabled={creating}
            onChange={(event) => {
              setMood(event.target.value);
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

          <textarea
            placeholder="今天发生了什么？"
            value={content}
            disabled={creating}
            onChange={(event) => {
              setContent(event.target.value);
              setActionError("");
            }}
          />

          <button
            className="secondary-button"
            disabled={creating || createInvalid}
            onClick={handleCreate}
          >
            {creating ? "保存中…" : "保存日记"}
          </button>
        </section>
      )}

      {selectedDiary && (
        <section className="memory-message">
          {editing ? (
            <>
              <h2>编辑日记</h2>

              <input
                value={editingTitle}
                disabled={updating}
                onChange={(event) => {
                  setEditingTitle(event.target.value);
                  setActionError("");
                }}
              />

              <input
                type="date"
                value={editingDate}
                disabled={updating}
                onChange={(event) => {
                  setEditingDate(event.target.value);
                  setActionError("");
                }}
              />

              <input
                placeholder="心情（可选）"
                value={editingMood}
                disabled={updating}
                onChange={(event) => {
                  setEditingMood(event.target.value);
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

              <textarea
                value={editingContent}
                disabled={updating}
                onChange={(event) => {
                  setEditingContent(event.target.value);
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
                <span>{formatDiaryDate(selectedDiary.date)}</span>

                {selectedDiary.mood && (
                  <span>{selectedDiary.mood}</span>
                )}
              </div>

              <h2>{selectedDiary.title}</h2>
              <p>{selectedDiary.content}</p>

              {selectedDiary.tags.length > 0 && (
                <p>
                  {selectedDiary.tags
                    .map((tag) => `#${tag}`)
                    .join(" ")}
                </p>
              )}

              <button
                className="secondary-button"
                onClick={() => beginEditing(selectedDiary)}
              >
                编辑
              </button>

              <button
                className="secondary-button"
                onClick={() => {
                  setSelectedDiary(null);
                  setEditing(false);
                }}
              >
                关闭详情
              </button>
            </>
          )}
        </section>
      )}

      {state.status === "ready" && state.diaries.length > 0 && (
        <>
          <section className="memory-message">
            <h2>日记列表</h2>
            <p>共 {state.count} 篇，按日期从新到旧排列。</p>
          </section>

          <section className="memory-grid">
            {state.diaries.map((diary) => (
              <article
                className="memory-card"
                key={diary.id}
              >
                <div className="memory-card-topline">
                  <span>{formatDiaryDate(diary.date)}</span>

                  {diary.mood && <span>{diary.mood}</span>}
                </div>

                <h2>{diary.title}</h2>

                <p>
                  {diary.content.length > 160
                    ? `${diary.content.slice(0, 160)}…`
                    : diary.content}
                </p>

                {diary.tags.length > 0 && (
                  <p>
                    {diary.tags
                      .map((tag) => `#${tag}`)
                      .join(" ")}
                  </p>
                )}

                <button
                  className="secondary-button"
                  disabled={loadingDiaryId.length > 0}
                  onClick={() => handleReadDiary(diary.id)}
                >
                  {loadingDiaryId === diary.id
                    ? "读取中…"
                    : "查看详情"}
                </button>
              </article>
            ))}
          </section>
        </>
      )}

      {state.status === "ready" && state.diaries.length === 0 && (
        <DiaryMessage
          title="还没有日记"
          description="创建第一篇日记后，它会显示在这里。"
        />
      )}

      {state.status === "loading" && <DiaryLoading />}

      {state.status === "error" && (
        <DiaryMessage
          title="暂时无法读取日记"
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
    </div>
  );
}

function DiaryLoading() {
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

function DiaryMessage({
  action,
  description,
  title,
}: {
  action?: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="memory-message">
      <div className="placeholder-icon">
        <DiaryIcon />
      </div>

      <h2>{title}</h2>
      <p>{description}</p>

      {action}
    </section>
  );
}