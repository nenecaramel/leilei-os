import { useEffect, useState } from "react";
import { useWebApiClient } from "../api/useWebApiClient";
import { MemoryIcon } from "../components/icons";
import { PageHeader } from "./PageHeader";

type MemoryCategory = "profile" | "preference" | "goal" | "project";

type MemoryRecord = {
  id: string;
  category: MemoryCategory;
  key: string;
  content: string;
  updated_at: string;
};

type MemoryResponse = {
  success: true;
  data: {
    user: { display_name: string };
    memories: MemoryRecord[];
    metadata: { count: number };
  };
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; result: MemoryResponse["data"] }
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

function matchesSearch(
  memory: MemoryRecord,
  searchQuery: string,
): boolean {
  const normalizedQuery = searchQuery
    .trim()
    .toLocaleLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  const searchableText = [
    memory.key,
    memory.key.replaceAll("_", " "),
    memory.content,
    memory.category,
    categoryLabels[memory.category],
  ]
    .join(" ")
    .toLocaleLowerCase();

  return searchableText.includes(normalizedQuery);
}

export function MemoryPage() {
  const api = useWebApiClient();

  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<LoadState>({
    status: "loading",
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [actionError, setActionError] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [category, setCategory] =
    useState<MemoryCategory>("profile");
  const [key, setKey] = useState("");
  const [content, setContent] = useState("");
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState("");
  const [editingContent, setEditingContent] = useState("");
  const [updatingId, setUpdatingId] = useState("");
  const [deletingId, setDeletingId] = useState("");

  useEffect(() => {
    let active = true;

    setState({ status: "loading" });

    api.request<MemoryResponse>("/memory")
      .then((response) => {
        if (active) {
          setState({
            status: "ready",
            result: response.data,
          });
        }
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

  const busy =
    creating ||
    updatingId.length > 0 ||
    deletingId.length > 0;

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
        }),
      });

      setKey("");
      setContent("");
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
        }),
      });

      setEditingId("");
      setEditingContent("");
      setReloadKey((value) => value + 1);
    } catch {
      setActionError("修改记忆失败，请稍后重试。");
    } finally {
      setUpdatingId("");
    }
  }

  async function handleDelete(
    id: string,
    memoryKey: string,
  ) {
    if (busy) {
      return;
    }

    const confirmed = window.confirm(
      `确定删除“${memoryKey.replaceAll("_", " ")}”吗？`,
    );

    if (!confirmed) {
      return;
    }

    setDeletingId(id);
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
      }

      setReloadKey((value) => value + 1);
    } catch {
      setActionError("删除记忆失败，请稍后重试。");
    } finally {
      setDeletingId("");
    }
  }

  const filteredMemories =
    state.status === "ready"
      ? state.result.memories.filter((memory) =>
          matchesSearch(memory, searchQuery),
        )
      : [];

  return (
    <div className="page memory-page">
      <PageHeader
        eyebrow="Long-term context"
        title="Memory"
        description="由 Leilei OS 安全保存的核心信息、稳定偏好、长期目标与当前项目。"
        action={
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

          <button
            className="secondary-button"
            disabled={creating || createInvalid}
            onClick={handleCreate}
          >
            {creating ? "保存中…" : "保存"}
          </button>
        </section>
      )}

      {state.status === "ready" && (
        <>
          <section className="memory-message">
            <h2>搜索记忆</h2>

            <input
              type="search"
              placeholder="搜索 Key 或内容"
              value={searchQuery}
              onChange={(event) =>
                setSearchQuery(event.target.value)
              }
            />

            <p>
              显示 {filteredMemories.length} 条，共{" "}
              {state.result.metadata.count} 条
            </p>
          </section>

          {filteredMemories.length > 0 ? (
            <section className="memory-grid">
              {filteredMemories.map((memory) => {
                const editing =
                  editingId === memory.id;
                const updating =
                  updatingId === memory.id;
                const deleting =
                  deletingId === memory.id;

                return (
                  <article
                    className="memory-card"
                    key={memory.id}
                  >
                    <div className="memory-card-topline">
                      <span
                        className={`memory-category memory-category-${memory.category}`}
                      >
                        {categoryLabels[memory.category]}
                      </span>

                      <span>
                        {formatUpdatedAt(
                          memory.updated_at,
                        )}
                      </span>
                    </div>

                    <h2>
                      {memory.key.replaceAll("_", " ")}
                    </h2>

                    {editing ? (
                      <>
                        <textarea
                          value={editingContent}
                          disabled={updating || deleting}
                          onChange={(event) => {
                            setEditingContent(
                              event.target.value,
                            );
                            setActionError("");
                          }}
                        />

                        <button
                          className="secondary-button"
                          disabled={
                            updating ||
                            deleting ||
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
                          disabled={updating || deleting}
                          onClick={() => {
                            setEditingId("");
                            setEditingContent("");
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
                          onClick={() => {
                            setEditingId(memory.id);
                            setEditingContent(
                              memory.content,
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
                            handleDelete(
                              memory.id,
                              memory.key,
                            )
                          }
                        >
                          {deleting
                            ? "删除中…"
                            : "删除"}
                        </button>
                      </>
                    )}
                  </article>
                );
              })}
            </section>
          ) : (
            <MemoryMessage
              title="没有找到记忆"
              description={
                searchQuery.trim()
                  ? "没有与当前搜索内容匹配的记忆。"
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
  action?: React.ReactNode;
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