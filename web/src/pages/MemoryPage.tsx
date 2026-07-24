import { useEffect, useState } from "react";
import { useWebApiClient } from "../api/useWebApiClient";
import { MemoryIcon } from "../components/icons";
import { PageHeader } from "./PageHeader";

type MemoryCategory = "profile" | "preference" | "goal" | "project";

type MemoryResponse = {
  success: true;
  data: {
    user: { display_name: string };
    memories: Array<{
      category: MemoryCategory;
      key: string;
      content: string;
      updated_at: string;
    }>;
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
  if (Number.isNaN(date.getTime())) return "更新时间未知";

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function MemoryPage() {
  const api = useWebApiClient();
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const [showCreate, setShowCreate] = useState(false);
  const [category, setCategory] = useState<MemoryCategory>("profile");
  const [key, setKey] = useState("");
  const [content, setContent] = useState("");

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
      .catch((error) => {
        console.error("Memory load failed:", error);

        if (active) {
          setState({ status: "error" });
        }
      });

    return () => {
      active = false;
    };
  }, [api, reloadKey]);

  async function handleCreate() {
    await api.request("/memory", {
      method: "POST",
      body: JSON.stringify({
        category,
        key,
        content,
      }),
    });

    setKey("");
    setContent("");
    setShowCreate(false);
    setReloadKey((value) => value + 1);
  }

  const count =
    state.status === "ready"
      ? state.result.metadata.count
      : null;

  return (
    <div className="page memory-page">
      <PageHeader
        eyebrow="Long-term context"
        title="Memory"
        description="由 Leilei OS 安全保存的核心信息、稳定偏好、长期目标与当前项目。"
        action={
          <div>
            {count !== null && (
              <span className="memory-count">
                {count} 条记忆
              </span>
            )}

            <button
              className="secondary-button"
              onClick={() => setShowCreate((v) => !v)}
            >
              新增记忆
            </button>
          </div>
        }
      />

      {showCreate && (
        <section className="memory-message">
          <h2>创建记忆</h2>

          <select
            value={category}
            onChange={(e) =>
              setCategory(e.target.value as MemoryCategory)
            }
          >
            <option value="profile">Profile</option>
            <option value="preference">Preference</option>
            <option value="goal">Goal</option>
            <option value="project">Project</option>
          </select>

          <input
            placeholder="Key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />

          <textarea
            placeholder="Content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />

          <button
            className="secondary-button"
            onClick={handleCreate}
          >
            保存
          </button>
        </section>
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

      {state.status === "ready" &&
        state.result.memories.length > 0 && (
          <section className="memory-grid">
            {state.result.memories.map((memory) => (
              <article
                className="memory-card"
                key={`${memory.category}:${memory.key}`}
              >
                <div className="memory-card-topline">
                  <span
                    className={`memory-category memory-category-${memory.category}`}
                  >
                    {categoryLabels[memory.category]}
                  </span>

                  <span>
                    {formatUpdatedAt(memory.updated_at)}
                  </span>
                </div>

                <h2>
                  {memory.key.replaceAll("_", " ")}
                </h2>

                <p>{memory.content}</p>
              </article>
            ))}
          </section>
        )}
    </div>
  );
}

function MemoryLoading() {
  return (
    <section className="memory-grid">
      {[0, 1, 2].map((item) => (
        <div className="memory-card memory-card-loading" key={item}>
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