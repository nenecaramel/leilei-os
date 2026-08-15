import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { WebApiClient } from "../api/useWebApiClient";
import "./universe-state-polish.css";
import {
  createLeileiOSUniverseAdapter,
} from "./universe/universe-adapter";
import {
  LeileiOSUniverseService,
  isUniverseNotInitialized,
  isUniverseVersionConflict,
} from "./universe/universe-service";
import { downloadUniverseJson } from "./universe/universe-export";
import { UniverseImportFlow } from "./universe/UniverseImportFlow";
import { UniverseMobileMap } from "./universe/UniverseMobileMap";
import { UniverseGalaxyPicker } from "./universe/UniverseGalaxyPicker";
import { UniverseNodePaper, type UniverseNodePaperDraft, type UniverseNodePaperMode } from "./universe/UniverseNodePaper";
import type { UniverseMapMode } from "./universe/universe-map-interaction";
import type { UniversePoint, UniverseViewport } from "./universe/universe-map-transform";
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
  const [galaxyPickerOpen, setGalaxyPickerOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<UniverseNode | null>(null);
  const [saving, setSaving] = useState(false);
  const [relationEditorOpen, setRelationEditorOpen] = useState(false);
  const [mapMode, setMapMode] = useState<UniverseMapMode>({ kind: "browse" });
  const [viewport, setViewport] = useState<UniverseViewport | null>(null);
  const [pendingPosition, setPendingPosition] = useState<UniversePoint | null>(null);
  const [paperMode, setPaperMode] = useState<UniverseNodePaperMode | null>(null);
  const paperTriggerRef = useRef<HTMLElement | null>(null);
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

  async function saveNode(values: UniverseNodePaperDraft) {
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
            position: pendingPosition ?? { x: 50, y: 50 },
          importance: values.importance,
        };
        await service.createNode(node);
        setNotice("一颗新星已经亮起。");
      }
      setEditorOpen(false);
      setEditingNode(null);
      setPendingPosition(null);
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
    return <UniverseFrame><UniverseLoadingState /></UniverseFrame>;
  }
  if (state.status === "not-initialized") {
    return (
      <UniverseFrame>
        <UniverseImportFlow
          service={service}
          onReady={(result, message) => {
            setNotice(message);
            setState({ status: "ready", ...result });
          }}
          onRecheck={() => setReload((value) => value + 1)}
        />
      </UniverseFrame>
    );
  }
  if (state.status === "error") {
    return <UniverseFrame><UniverseStatus message={state.message} onRetry={() => setReload((value) => value + 1)} /></UniverseFrame>;
  }

  const { snapshot } = state;
  const selectedNode = snapshot.nodes.find((node) => node.id === selectedId) ?? null;

  return (
    <div className="page memory-page universe-page">
      <UniverseHeader
        actions={(
          <>
            <button className="universe-header-action" type="button" aria-label="新增星球" onClick={() => { setMapMode({ kind: "placing-node" }); setNotice("点击地图选择新星球的位置。"); }}>＋</button>
            <button className="universe-header-action" type="button" aria-label="更多 Universe 操作" aria-expanded={overflowOpen} onClick={() => setOverflowOpen((value) => !value)}>···</button>
          </>
        )}
      />
      {overflowOpen ? <div className="universe-overflow-menu" role="menu"><button type="button" onClick={() => { downloadUniverseJson(snapshot); setOverflowOpen(false); }}>导出</button></div> : null}
      <UniverseGalaxyPicker galaxies={snapshot.galaxies} activeGalaxyId={galaxyFilter} open={galaxyPickerOpen} onOpenChange={setGalaxyPickerOpen} onSelect={setGalaxyFilter} />
      {notice ? <p className="universe-notice" role="status">{notice}</p> : null}
      <UniverseMobileMap
        galaxies={snapshot.galaxies}
        nodes={snapshot.nodes}
        relations={snapshot.relations}
        selectedNodeId={selectedId}
        activeGalaxyId={galaxyFilter}
        mode={mapMode}
        initialViewport={viewport}
        onViewportChange={setViewport}
        onSelectNode={setSelectedId}
        onOpenNode={(nodeId) => { setSelectedId(nodeId); setPaperMode({ kind: "detail", nodeId }); setEditorOpen(true); }}
        onPlaceNode={(position) => { setPendingPosition(position); setEditingNode(null); setPaperMode({ kind: "create", position }); setMapMode({ kind: "browse" }); setEditorOpen(true); }}
        onChooseRelationTarget={(nodeId) => { setSelectedId(nodeId); setMapMode({ kind: "browse" }); }}
        onMoveNode={async (nodeId, position) => {
          try {
            await service.updateNode(nodeId, { position }, "Universe Web 移动星球");
            setNotice("星球位置已更新。");
            refreshFromService();
          } catch (error) {
            setNotice(safeUniverseError(error));
          }
        }}
      />
      <UniverseNodePaper
        node={selectedNode}
        galaxies={snapshot.galaxies}
        mode={paperMode}
        open={editorOpen}
        saving={saving}
        triggerRef={paperTriggerRef}
        revisionsAvailable={selectedNode ? snapshot.revisions.some((revision) => revision.nodeId === selectedNode.id) : false}
        onRequestClose={() => { setEditorOpen(false); setPaperMode(null); return true; }}
        onSave={saveNode}
        onDelete={(node) => void removeNode(node)}
        onRestore={(node) => { void service.restoreLatestRevision(node.id).then(() => { setNotice("已恢复最近的认知版本。"); refreshFromService(); }).catch((error) => setNotice(safeUniverseError(error))); }}
        onCreateRelation={(node) => { setSelectedId(node.id); setRelationEditorOpen(true); setEditorOpen(false); setPaperMode(null); }}
        onEdit={(node) => { setEditingNode(node); setPaperMode({ kind: "edit", nodeId: node.id }); setEditorOpen(true); }}
      />
    </div>
  );
}

function UniverseHeader({ actions }: { actions?: ReactNode }) {
  return (
    <header className="memory-page-header universe-page-header">
      <div className="memory-page-heading">
        <div className="memory-page-title">Universe</div>
      </div>
      {actions ? <div className="universe-page-tools">{actions}</div> : null}
    </header>
  );
}

function UniverseFrame({ children }: { children: ReactNode }) {
  return <div className="page memory-page universe-page"><UniverseHeader />{children}</div>;
}

function UniverseLoadingState() {
  return (
    <section className="universe-cosmos universe-cosmos-loading" aria-label="Universe 加载中" aria-live="polite">
      <div className="universe-loading-line">
        <span>正在读取 Universe…</span>
        <span className="universe-loading-dots" aria-hidden="true"><i /><i /><i /></span>
      </div>
    </section>
  );
}

function UniverseStatus({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <section className="universe-cosmos universe-cosmos-state" aria-live="polite"><div className="universe-state-inline"><p>{message}</p>{onRetry ? <button className="secondary-button" type="button" onClick={onRetry}>重新加载</button> : null}</div></section>;
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

export function toggleUniverseGalaxyMemberships(
  current: UniverseNode["galaxies"],
  galaxyId: string,
): UniverseNode["galaxies"] {
  if (current.some((membership) => membership.id === galaxyId)) {
    return current.filter((membership) => membership.id !== galaxyId);
  }
  return [...current, { id: galaxyId, weight: current.length === 0 ? 1 : 0.72 }];
}

function NodeEditor({ node, galaxies, saving, onCancel, onSave }: { node: UniverseNode | null; galaxies: UniverseGalaxy[]; saving: boolean; onCancel: () => void; onSave: (draft: NodeDraft) => Promise<void> }) {
  const [title, setTitle] = useState(node?.title ?? "");
  const [summary, setSummary] = useState(node?.summary ?? "");
  const [content, setContent] = useState(node?.content ?? "");
  const [type, setType] = useState(node?.type ?? "concept");
  const [importance, setImportance] = useState(node?.importance ?? "normal");
  const [tags, setTags] = useState((node?.tags ?? []).join(", "));
  const [selectedGalaxies, setSelectedGalaxies] = useState(node?.galaxies ?? []);
  return (
    <section className="universe-node-editor" role="dialog" aria-modal="true" aria-label={node ? "调整星球" : "点亮星球"}>
      <div className="universe-detail-heading"><div><p className="eyebrow">{node ? "ADJUST ORBIT" : "NEW STAR"}</p><h2>{node ? "调整这颗星球" : "点亮一颗新星"}</h2></div><button className="tertiary-button" type="button" onClick={onCancel}>取消</button></div>
      <label>标题<input value={title} maxLength={60} autoFocus onChange={(event) => setTitle(event.target.value)} /></label>
      <label>摘要<textarea value={summary} rows={2} onChange={(event) => setSummary(event.target.value)} /></label>
      <label>正文<textarea value={content} rows={4} onChange={(event) => setContent(event.target.value)} /></label>
      <label>类型<select value={type} onChange={(event) => setType(event.target.value)}>{UNIVERSE_NODE_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
      <label>重要性<select value={importance} onChange={(event) => setImportance(event.target.value)}>{UNIVERSE_IMPORTANCE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
      <label>标签<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="逗号分隔" /></label>
      {galaxies.length ? <fieldset><legend>星系</legend>{galaxies.map((galaxy) => <label className="universe-galaxy-choice" key={galaxy.id}><input type="checkbox" checked={selectedGalaxies.some((membership) => membership.id === galaxy.id)} onChange={() => setSelectedGalaxies((current) => toggleUniverseGalaxyMemberships(current, galaxy.id))} />{galaxy.title}</label>)}</fieldset> : null}
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
