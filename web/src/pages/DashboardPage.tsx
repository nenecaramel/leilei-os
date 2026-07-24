import { ArchiveIcon, DiaryIcon, MemoryIcon, TaskIcon } from "../components/icons";
import { PageHeader } from "./PageHeader";

const spaces = [
  {
    title: "Memory",
    note: "稳定偏好、目标和项目",
    icon: MemoryIcon,
    tone: "sage",
  },
  {
    title: "Diary",
    note: "个人记录与生活切片",
    icon: DiaryIcon,
    tone: "peach",
  },
  {
    title: "Task",
    note: "清晰、可执行的下一步",
    icon: TaskIcon,
    tone: "blue",
  },
  {
    title: "Archive",
    note: "未来的对话归档空间",
    icon: ArchiveIcon,
    tone: "lilac",
  },
];

export function DashboardPage() {
  return (
    <div className="page dashboard-page">
      <PageHeader
        eyebrow="Personal command center"
        title="早上好，蕾蕾"
        description="这里会成为记忆、日记、任务与长期思考的安静入口。"
        action={<span className="live-badge">OAuth connected</span>}
      />

      <section className="hero-panel">
        <div>
          <span className="status-pill">Phase 6 · Foundation</span>
          <h2>一个属于你的操作界面，正在长出来。</h2>
          <p>
            当前阶段只建立安全登录、信息架构与基础导航。数据仍由现有 Leilei OS
            后端可靠保管。
          </p>
        </div>
        <div className="orbit" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Spaces</p>
            <h2>你的个人系统</h2>
          </div>
          <span>4 foundations</span>
        </div>
        <div className="space-grid">
          {spaces.map(({ icon: Icon, note, title, tone }) => (
            <article className="space-card" key={title}>
              <div className={`space-icon ${tone}`}>
                <Icon />
              </div>
              <div>
                <h3>{title}</h3>
                <p>{note}</p>
              </div>
              <span className="card-state">Ready</span>
            </article>
          ))}
        </div>
      </section>

      <section className="quiet-panel">
        <p className="eyebrow">System status</p>
        <div className="status-row">
          <div>
            <span className="status-dot" />
            <strong>身份边界已建立</strong>
            <p>Web 使用独立 Auth0 Application，与现有用户身份保持一致。</p>
          </div>
          <div>
            <span className="status-dot" />
            <strong>业务数据保持隔离</strong>
            <p>本阶段没有读取、写入或调用 MCP。</p>
          </div>
        </div>
      </section>
    </div>
  );
}
