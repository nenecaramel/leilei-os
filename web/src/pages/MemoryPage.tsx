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

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    api.request<MemoryResponse>("/memory")
      .then((response) => {
        if (active) setState({ status: "ready", result: response.data });
      })
      .catch((error) => {
        console.error("Memory load failed:", error);
        if (active) setState({ status: "error" });
      });

    return () => {
      active = false;
    };
  }, [api, reloadKey]);

  const count = state.status === "ready" ? state.result.metadata.count : null;

  return (
    <div className="page memory-page">
      <PageHeader
        eyebrow="Long-term context"
        title="Memory"
        description="由 Leilei OS 安全保存的核心信息、稳定偏好、长期目标与当前项目。"
        action={count !== null ? <span className="memory-count">{count} 条记忆</span> : undefined}
      />

      {state.status === "loading" && <MemoryLoading />}
      {state.status === "error" && (
        <MemoryMessage
          title="暂时无法读取记忆"
          description="连接没有完成，请稍后重试。现有记忆不会受到影响。"
          action={
            <button className="secondary-button" onClick={() => setReloadKey((value) => value + 1)}>
              重新加载
            </button>
          }
        />
      )}
      {state.status === "ready" && state.result.memories.length === 0 && (
        <MemoryMessage
          title="这里还很安静"
          description="当前没有可供助手读取的核心记忆。"
        />
      )}
      {state.status === "ready" && state.result.memories.length > 0 && (
        <section className="memory-grid" aria-live="polite">
          {state.result.memories.map((memory) => (
            <article className="memory-card" key={`${memory.category}:${memory.key}`}>
              <div className="memory-card-topline">
                <span className={`memory-category memory-category-${memory.category}`}>
                  {categoryLabels[memory.category]}
                </span>
                <span>{formatUpdatedAt(memory.updated_at)}</span>
              </div>
              <h2>{memory.key.replaceAll("_", " ")}</h2>
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
    <section className="memory-grid" aria-label="正在加载记忆" aria-live="polite">
      {[0, 1, 2].map((item) => (
        <div className="memory-card memory-card-loading" key={item}>
          <span />
          <strong />
          <p />
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
    <section className="memory-message" aria-live="polite">
      <div className="placeholder-icon"><MemoryIcon /></div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  );
}
