import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { WebApiClient } from "../api/useWebApiClient";
import { PageHeader } from "./PageHeader";
import {
  createLeileiOSUniverseAdapter,
} from "./universe/universe-adapter";
import {
  LeileiOSUniverseService,
  isUniverseNotInitialized,
  isUniverseVersionConflict,
} from "./universe/universe-service";
import { downloadUniverseJson } from "./universe/universe-export";
import type {
  UniverseGalaxy,
  UniverseNode,
  UniverseNodeCreateInput,
  UniverseRelation,
  UniverseRelationCreateInput,
  UniverseRelationType,
  UniverseSnapshot,
} from "./universe/universe-types";

const relationLabels: Record<UniverseRelationType, string> = {
  related_to: "相关",
  supports: "支持",
  contradicts: "矛盾",
  extends: "延伸",
  part_of: "属于",
  raises: "引出",
};

export const UNIVERSE_NODE_TYPES = [
  "concept",
  "question",
  "claim",
  "experience",
  "project",
  "source",
  "reflection",
] as const;

export const UNIVERSE_IMPORTANCE_OPTIONS = ["anchor", "major", "normal"] as const;

type UniverseState =
  | { status: "loading" }
  | { status: "not-initialized" }
  | { status: "error"; message: string }
  | { status: "ready"; snapshot: UniverseSnapshot; version: number };

export function UniversePage({ api }: { api: WebApiClient }) {
  return <UniversePageContent api={api} />;
}

export function UniversePageContent({ api }: { api: WebApiClient }) {
  const service = useMemo(
    () => LeileiOSUniverseService({ adapter: createLeileiOSUniverseAdapter(api) }),
    [api],
  );
  const [state, setState] = useState<UniverseState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [galaxyFilter, setGalaxyFilter] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<UniverseNode | null>(null);
  const [saving, setSaving] = useState(false);
  const [relationEditorOpen, setRelationEditorOpen] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    const requestGeneration = ++generation.current;
    let active = true;
    setState({ status: "loading" });
    service.load().then((result) => {
      if (!active || requestGeneration !== generation.current) return;
      setState({ status: "ready", ...result });
    }).catch((error: unknown) => {
      if (!active || requestGeneration !== generation.current) return;
      if (isUniverseNotInitialized(error)) {
        setState({ status: "not-initialized" });
        return;
      }
      setState({ status: "error", message: safeUniverseError(error) });
    });
    return () => {
      active = false;
    };
  }, [service, reload]);

  const refreshFromService = () => {
    const current = service.getState();
    if (current) setState({ status: "ready", ...current });
  };

  async function saveNode(values: NodeDraft) {
    if (saving) return;
    setSaving(true);
    try {
      if (editingNode) {
        await service.updateNode(editingNode.id, values, "Universe Web 编辑");
        setNotice("星球已更新。");
      } else {
        const node: UniverseNodeCreateInput = {
          title: values.title,
          summary: values.summary,
          content: values.content,
          type: values.type,
          tags: values.tags,
          galaxies: values.galaxies,
          position: {
            x: 16 + ((Date.now() / 17) % 68),
            y: 18 + ((Date.now() / 29) % 58),
          },
          importance: values.importance,
        };
        await service.createNode(node);
        setNotice("一颗新星已经亮起。");
      }
      setEditorOpen(false);
      setEditingNode(null);
      refreshFromService();
    } catch (error) {
      setNotice(safeUniverseError(error));
    } finally {
      setSaving(false);
    }
  }

  async function removeNode(node: UniverseNode) {
    if (saving) return;
    setSaving(true);
    try {
      await service.deleteNode(node.id);
      setSelectedId(null);
      setNotice("星球已从当前宇宙移除。");
      refreshFromService();
    } catch (error) {
      setNotice(safeUniverseError(error));
    } finally {
      setSaving(false);
    }
  }

  async function saveRelation(relation: UniverseRelationCreateInput) {
    if (saving) return;
    setSaving(true);
    try {
      await service.createRelation(relation);
      setRelationEditorOpen(false);
      setNotice("新的思想连接已经出现。");
      refreshFromService();
    } catch (error) {
      setNotice(safeUniverseError(error));
    } finally {
      setSaving(false);
    }
  }

  async function removeRelation(relation: UniverseRelation) {
    if (saving) return;
    setSaving(true);
    try {
      await service.deleteRelation(relation.id);
      setNotice("思想连接已移除。");
      refreshFromService();
    } catch (error) {
      setNotice(safeUniverseError(error));
    } finally {
      setSaving(false);
    }
  }

  if (state.status === "loading") {
    return <UniverseFrame><UniverseStatus message="正在读取 Universe…" busy /></UniverseFrame>;
  }
  if (state.status === "not-initialized") {
    return <UniverseFrame><UniverseStatus message="Universe 尚未初始化。LeileiOS 模式不会自动导入本地数据或创建种子内容。" onRetry={() => setReload((value) => value + 1)} /></UniverseFrame>;
  }
  if (state.status === "error") {
    return <UniverseFrame><UniverseStatus message={state.message} onRetry={() => setReload((value) => value + 1)} /></UniverseFrame>;
  }

  const { snapshot, version } = state;
  const visibleNodes = galaxyFilter
    ? snapshot.nodes.filter((node) => node.galaxies.includes(galaxyFilter))
    : snapshot.nodes;
  const selectedNode = snapshot.nodes.find((node) => node.id === selectedId) ?? null;

  return (
    <div className="page universe-page">
      <PageHeader
        eyebrow="Universe"
        title={snapshot.meta.name || "Universe"}
        description={`空间知识图谱 · ${snapshot.nodes.length} 颗星球 · v${version}`}
        action={<><button className="secondary-button" type="button" onClick={() => downloadUniverseJson(snapshot)}>导出 JSON</button><button className="secondary-button" type="button" onClick={() => { setEditingNode(null); setEditorOpen(true); }}>点亮星球</button></>}
      />
      <div className="universe-toolbar" aria-label="Universe filters">
        <button className={!galaxyFilter ? "universe-filter is-active" : "universe-filter"} type="button" onClick={() => setGalaxyFilter(null)}>全部</button>
        {snapshot.galaxies.slice().sort((a, b) => a.order - b.order).map((galaxy) => (
          <button
            className={galaxyFilter === galaxy.id ? "universe-filter is-active" : "universe-filter"}
            key={galaxy.id}
            type="button"
            onClick={() => setGalaxyFilter(galaxy.id)}
          >
            <span className="universe-filter-dot" style={{ background: galaxy.color }} />
            {galaxy.title}
          </button>
        ))}
      </div>
      {notice ? <p className="universe-notice" role="status">{notice}</p> : null}
      <UniverseCanvas
        nodes={visibleNodes}
        relations={snapshot.relations}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      {selectedNode ? (
        <section className="universe-detail-card" aria-label="Selected universe node">
          <div className="universe-detail-heading">
            <div>
              <p className="eyebrow">{selectedNode.type}</p>
              <h2>{selectedNode.title}</h2>
            </div>
            <button className="tertiary-button" type="button" onClick={() => setSelectedId(null)}>关闭</button>
          </div>
          {selectedNode.summary ? <p>{selectedNode.summary}</p> : null}
          {selectedNode.content ? <p className="universe-detail-content">{selectedNode.content}</p> : null}
          <div className="universe-detail-actions">
            <button className="secondary-button" type="button" onClick={() => { setEditingNode(selectedNode); setEditorOpen(true); }}>调整轨道</button>
            {snapshot.nodes.length > 1 ? <button className="secondary-button" type="button" onClick={() => setRelationEditorOpen(true)}>建立连接</button> : null}
            {snapshot.revisions.some((revision) => revision.nodeId === selectedNode.id) ? <button className="tertiary-button" type="button" disabled={saving} onClick={() => { void service.restoreLatestRevision(selectedNode.id).then(() => { setNotice("已恢复最近的认知版本。"); refreshFromService(); }).catch((error) => setNotice(safeUniverseError(error))); }}>恢复上一版本</button> : null}
            <button className="danger-button" type="button" disabled={saving} onClick={() => void removeNode(selectedNode)}>移除星球</button>
          </div>
          <div className="universe-relation-list">
            {snapshot.relations.filter((relation) => relation.source === selectedNode.id || relation.target === selectedNode.id).map((relation) => <div className="universe-relation-item" key={relation.id}><span>{relationLabels[relation.relationType]}</span><button className="tertiary-button" type="button" disabled={saving} onClick={() => void removeRelation(relation)}>移除连接</button></div>)}
          </div>
        </section>
      ) : null}
      {editorOpen ? (
        <NodeEditor
          node={editingNode}
          galaxies={snapshot.galaxies}
          saving={saving}
          onCancel={() => { setEditorOpen(false); setEditingNode(null); }}
          onSave={saveNode}
        />
      ) : null}
      {relationEditorOpen && selectedNode ? <RelationEditor source={selectedNode} nodes={snapshot.nodes} saving={saving} onCancel={() => setRelationEditorOpen(false)} onSave={saveRelation} /> : null}
    </div>
  );
}

function UniverseFrame({ children }: { children: ReactNode }) {
  return <div className="page universe-page"><PageHeader eyebrow="Universe" title="Universe" description="你的空间知识图谱。" />{children}</div>;
}

function UniverseStatus({ message, onRetry, busy }: { message: string; onRetry?: () => void; busy?: boolean }) {
  return <section className="universe-state" aria-live="polite"><p>{message}</p>{onRetry ? <button className="secondary-button" type="button" onClick={onRetry}>重新读取</button> : null}{busy ? <span className="sr-only">读取中</span> : null}</section>;
}

export function UniverseCanvas({
  nodes,
  relations,
  selectedId,
  onSelect,
}: {
  nodes: UniverseNode[];
  relations: UniverseRelation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  return (
    <section className="universe-cosmos" aria-label="Universe spatial canvas">
      <div className="universe-relation-layer" aria-hidden="true">
        {relations.map((relation) => {
          const source = nodeMap.get(relation.source);
          const target = nodeMap.get(relation.target);
          if (!source || !target) return null;
          const dx = target.position.x - source.position.x;
          const dy = target.position.y - source.position.y;
          const length = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * 180 / Math.PI;
          return <span className="universe-relation-line" key={relation.id} title={relationLabels[relation.relationType]} style={{ left: `${source.position.x}%`, top: `${source.position.y}%`, width: `${length}%`, transform: `rotate(${angle}deg)`, opacity: Math.max(0.25, relation.strength) }} />;
        })}
      </div>
      <div className="universe-node-layer">
        {nodes.map((node) => (
          <button className={selectedId === node.id ? "universe-node is-selected" : "universe-node"} key={node.id} type="button" style={{ left: `${node.position.x}%`, top: `${node.position.y}%` }} onClick={() => onSelect(node.id)} aria-label={`查看节点：${node.title}`}>
            <span className="universe-node-orb" />
            <span className="universe-node-copy"><strong>{node.title}</strong><small>{node.type}</small></span>
          </button>
        ))}
        {nodes.length === 0 ? <p className="universe-cosmos-empty">当前筛选没有星球。</p> : null}
      </div>
    </section>
  );
}

type NodeDraft = Pick<UniverseNode, "title" | "summary" | "content" | "type" | "tags" | "galaxies"> & { importance: string };

function NodeEditor({ node, galaxies, saving, onCancel, onSave }: { node: UniverseNode | null; galaxies: UniverseGalaxy[]; saving: boolean; onCancel: () => void; onSave: (draft: NodeDraft) => Promise<void> }) {
  const [title, setTitle] = useState(node?.title ?? "");
  const [summary, setSummary] = useState(node?.summary ?? "");
  const [content, setContent] = useState(node?.content ?? "");
  const [type, setType] = useState(node?.type ?? "concept");
  const [importance, setImportance] = useState(node?.importance ?? "normal");
  const [tags, setTags] = useState((node?.tags ?? []).join(", "));
  const [selectedGalaxies, setSelectedGalaxies] = useState<string[]>(node?.galaxies ?? []);
  return (
    <section className="universe-node-editor" role="dialog" aria-modal="true" aria-label={node ? "调整星球" : "点亮星球"}>
      <div className="universe-detail-heading"><div><p className="eyebrow">{node ? "ADJUST ORBIT" : "NEW STAR"}</p><h2>{node ? "调整这颗星球" : "点亮一颗新星"}</h2></div><button className="tertiary-button" type="button" onClick={onCancel}>取消</button></div>
      <label>标题<input value={title} maxLength={60} autoFocus onChange={(event) => setTitle(event.target.value)} /></label>
      <label>摘要<textarea value={summary} rows={2} onChange={(event) => setSummary(event.target.value)} /></label>
      <label>正文<textarea value={content} rows={4} onChange={(event) => setContent(event.target.value)} /></label>
      <label>类型<select value={type} onChange={(event) => setType(event.target.value)}>{UNIVERSE_NODE_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
      <label>重要性<select value={importance} onChange={(event) => setImportance(event.target.value)}>{UNIVERSE_IMPORTANCE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
      <label>标签<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="逗号分隔" /></label>
      {galaxies.length ? <fieldset><legend>星系</legend>{galaxies.map((galaxy) => <label className="universe-galaxy-choice" key={galaxy.id}><input type="checkbox" checked={selectedGalaxies.includes(galaxy.id)} onChange={() => setSelectedGalaxies((current) => current.includes(galaxy.id) ? current.filter((id) => id !== galaxy.id) : [...current, galaxy.id])} />{galaxy.title}</label>)}</fieldset> : null}
      <div className="universe-detail-actions"><button className="secondary-button" type="button" disabled={saving || !title.trim()} onClick={() => onSave({ title: title.trim(), summary: summary.trim(), content: content.trim(), type, importance, tags: tags.split(/[,，]/).map((value) => value.trim()).filter(Boolean), galaxies: selectedGalaxies })}>{saving ? "保存中…" : "保存"}</button></div>
    </section>
  );
}

function RelationEditor({ source, nodes, saving, onCancel, onSave }: { source: UniverseNode; nodes: UniverseNode[]; saving: boolean; onCancel: () => void; onSave: (relation: UniverseRelationCreateInput) => Promise<void> }) {
  const [target, setTarget] = useState(nodes.find((node) => node.id !== source.id)?.id ?? "");
  const [relationType, setRelationType] = useState<UniverseRelationType>("related_to");
  const [strength, setStrength] = useState(0.7);
  return <section className="universe-node-editor" role="dialog" aria-modal="true" aria-label="建立思想连接"><div className="universe-detail-heading"><div><p className="eyebrow">NEW CONNECTION</p><h2>建立思想连接</h2></div><button className="tertiary-button" type="button" onClick={onCancel}>取消</button></div><p className="universe-notice">从「{source.title}」连接到另一颗星球。</p><label>目标<select value={target} onChange={(event) => setTarget(event.target.value)}>{nodes.filter((node) => node.id !== source.id).map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select></label><label>关系<select value={relationType} onChange={(event) => setRelationType(event.target.value as UniverseRelationType)}>{Object.entries(relationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>强度<input type="range" min="0.1" max="1" step="0.1" value={strength} onChange={(event) => setStrength(Number(event.target.value))} /><span>{Math.round(strength * 100)}%</span></label><div className="universe-detail-actions"><button className="secondary-button" type="button" disabled={saving || !target} onClick={() => onSave({ source: source.id, target, relationType, strength })}>{saving ? "保存中…" : "建立连接"}</button></div></section>;
}

function safeUniverseError(error: unknown): string {
  if (isUniverseVersionConflict(error)) return "Universe 已在其他设备发生变化，请重新读取后再试。";
  if ((error as { code?: unknown })?.code === "UNIVERSE_NOT_INITIALIZED") return "Universe 尚未初始化。";
  return "Universe 暂时无法读取，请稍后重试。";
}
