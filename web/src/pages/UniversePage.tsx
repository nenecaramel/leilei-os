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
import { UniverseRelationPaper } from "./universe/UniverseRelationPaper";
import { UniverseFloatingPopover } from "./universe/UniverseFloatingPopover";
import type { UniverseMapMode } from "./universe/universe-map-interaction";
import type { UniversePoint, UniverseViewport } from "./universe/universe-map-transform";
import type {
  UniverseGalaxy,
  UniverseNode,
  UniverseNodeCreateInput,
  UniverseRelation,
  UniverseRelationCreateInput,
  UniverseSnapshot,
} from "./universe/universe-types";

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
  const [placementOpen, setPlacementOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<UniverseNode | null>(null);
  const [saving, setSaving] = useState(false);
  const [paperError, setPaperError] = useState<string | null>(null);
  const [relationEditorOpen, setRelationEditorOpen] = useState(false);
  const [relationSourceId, setRelationSourceId] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<UniverseMapMode>({ kind: "browse" });
  const [viewport, setViewport] = useState<UniverseViewport | null>(null);
  const [pendingPosition, setPendingPosition] = useState<UniversePoint | null>(null);
  const [revealNodeId, setRevealNodeId] = useState<string | null>(null);
  const [paperMode, setPaperMode] = useState<UniverseNodePaperMode | null>(null);
  const paperTriggerRef = useRef<HTMLElement | null>(null);
  const addActionRef = useRef<HTMLButtonElement | null>(null);
  const overflowActionRef = useRef<HTMLButtonElement | null>(null);
  const generation = useRef(0);

  const cancelPlacement = () => {
    if (mapMode.kind === "placing-node" || placementOpen) {
      setMapMode({ kind: "browse" });
      setPlacementOpen(false);
      setPendingPosition(null);
      setNotice(null);
    }
  };

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

  const reconcileAfterMutationFailure = async () => {
    try {
      const fresh = await service.load();
      setState({ status: "ready", ...fresh });
    } catch {
      // Keep the last known canonical state visible when the recovery read is
      // itself unavailable; never invent an optimistic result.
      refreshFromService();
    }
  };

  async function saveNode(values: UniverseNodePaperDraft) {
    if (saving) return;
    setSaving(true);
    setPaperError(null);
    try {
      if (editingNode) {
        const editedNodeId = editingNode.id;
        await service.updateNode(editedNodeId, values, "Universe Web 编辑");
        setNotice("星球已更新。");
        refreshFromService();
        setEditingNode(null);
        setPendingPosition(null);
        setPaperMode({ kind: "detail", nodeId: editedNodeId });
        setEditorOpen(true);
      } else {
        if (!pendingPosition) {
          setPaperError("请先在星图上选择新星球的位置。");
          return;
        }
        const node: UniverseNodeCreateInput = {
          title: values.title,
          summary: values.summary,
          content: values.content,
          type: values.type,
          tags: values.tags,
          galaxies: values.galaxies,
          position: pendingPosition,
          importance: values.importance,
        };
        await service.createNode(node);
        setNotice("一颗新星已经亮起。");
        setEditorOpen(false);
        setEditingNode(null);
        setPendingPosition(null);
        refreshFromService();
      }
    } catch (error) {
      setPaperError(safeUniverseError(error));
      void reconcileAfterMutationFailure();
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
      void reconcileAfterMutationFailure();
    } finally {
      setSaving(false);
    }
  }

  async function saveRelation(relation: UniverseRelationCreateInput) {
    if (saving) return;
    setSaving(true);
    setPaperError(null);
    try {
      await service.createRelation(relation);
      setRelationEditorOpen(false);
      setRelationSourceId(null);
      setMapMode({ kind: "browse" });
      setNotice("新的思想连接已经出现。");
      refreshFromService();
    } catch (error) {
      setPaperError(safeUniverseError(error));
      void reconcileAfterMutationFailure();
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
  const selectedConnections = selectedNode
    ? snapshot.relations.filter((relation) => relation.source === selectedNode.id || relation.target === selectedNode.id).map((relation) => ({
      relation,
      node: snapshot.nodes.find((node) => node.id === (relation.source === selectedNode.id ? relation.target : relation.source)) ?? null,
    })).filter((connection): connection is { relation: typeof snapshot.relations[number]; node: UniverseNode } => connection.node !== null)
    : [];

  async function removeRelation(relation: UniverseRelation) {
    if (!relation.id || saving) return;
    setSaving(true);
    setPaperError(null);
    try {
      await service.deleteRelation(relation.id);
      setNotice("思想连接已移除。");
      refreshFromService();
    } catch (error) {
      setPaperError(safeUniverseError(error));
      void reconcileAfterMutationFailure();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page memory-page universe-page">
      <UniverseHeader
        actions={(
          <>
            <span className="universe-popover-anchor">
              <button ref={addActionRef} className="universe-header-action" type="button" aria-label="新增星球" aria-expanded={placementOpen} onClick={() => { if (placementOpen || mapMode.kind === "placing-node") { cancelPlacement(); return; } setPaperError(null); setOverflowOpen(false); setGalaxyPickerOpen(false); setPlacementOpen(true); setMapMode({ kind: "placing-node" }); setNotice(null); }}>＋</button>
              <UniverseFloatingPopover open={placementOpen} anchorRef={addActionRef} className="universe-placement-popover" ariaLabel="放置新星球" shouldIgnoreOutside={(target) => Boolean((target as Element | null)?.closest?.(".universe-mobile-map"))} onRequestClose={cancelPlacement}>
                <span>点击地图选择新星球的位置。</span>
              </UniverseFloatingPopover>
            </span>
            <span className="universe-popover-anchor">
              <button ref={overflowActionRef} className="universe-header-action" type="button" aria-label="更多 Universe 操作" aria-expanded={overflowOpen} onClick={() => { cancelPlacement(); setGalaxyPickerOpen(false); setOverflowOpen((value) => !value); }}>···</button>
              <UniverseFloatingPopover open={overflowOpen} anchorRef={overflowActionRef} className="universe-overflow-menu" ariaLabel="更多 Universe 操作" onRequestClose={() => setOverflowOpen(false)}>
                <button type="button" onClick={() => { downloadUniverseJson(snapshot); setOverflowOpen(false); }}>导出</button>
              </UniverseFloatingPopover>
            </span>
          </>
        )}
      />
      <UniverseGalaxyPicker galaxies={snapshot.galaxies} activeGalaxyId={galaxyFilter} open={galaxyPickerOpen} onOpenChange={(open) => { if (open) cancelPlacement(); setOverflowOpen(false); setGalaxyPickerOpen(open); }} onSelect={setGalaxyFilter} />
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
        onModeChange={(next) => { const previous = mapMode; setMapMode(next); if (previous.kind === "placing-node" && next.kind === "browse") { setPlacementOpen(false); setNotice(null); } }}
        revealNodeId={revealNodeId}
        onRevealNodeHandled={() => setRevealNodeId(null)}
        onOpenNode={(nodeId) => { setPaperError(null); setSelectedId(nodeId); setPaperMode({ kind: "detail", nodeId }); setEditorOpen(true); }}
        onPlaceNode={(position) => { setPlacementOpen(false); setPaperError(null); setPendingPosition(position); setEditingNode(null); setPaperMode({ kind: "create", position }); setMapMode({ kind: "browse" }); setEditorOpen(true); }}
        onMoveNode={async (nodeId, position) => {
          try {
            await service.updateNode(nodeId, { position }, "Universe Web 移动星球");
            setNotice("星球位置已更新。");
            refreshFromService();
          } catch (error) {
            setNotice(safeUniverseError(error));
            await reconcileAfterMutationFailure();
          }
        }}
      />
      <UniverseNodePaper
        node={selectedNode}
        galaxies={snapshot.galaxies}
        mode={paperMode}
        open={editorOpen}
        saving={saving}
        errorMessage={paperError}
        triggerRef={paperTriggerRef}
        revisionsAvailable={selectedNode ? snapshot.revisions.some((revision) => revision.nodeId === selectedNode.id) : false}
        connections={selectedConnections}
        onRequestClose={() => { setEditorOpen(false); setPaperMode(null); setPaperError(null); return true; }}
        onSave={saveNode}
        onDelete={(node) => void removeNode(node)}
        onRestore={(node) => { void service.restoreLatestRevision(node.id).then(() => { setNotice("已恢复最近的认知版本。"); refreshFromService(); }).catch((error) => { setNotice(safeUniverseError(error)); void reconcileAfterMutationFailure(); }); }}
        onCreateRelation={(node) => { setSelectedId(node.id); setRelationSourceId(node.id); setPaperError(null); setMapMode({ kind: "browse" }); setRelationEditorOpen(true); setEditorOpen(false); setPaperMode(null); }}
        onDeleteRelation={(relation) => void removeRelation(relation)}
        onOpenRelatedNode={(nodeId) => { setEditorOpen(false); setPaperMode(null); setSelectedId(nodeId); setRevealNodeId(nodeId); setPaperError(null); }}
        onEdit={(node) => { setEditingNode(node); setPaperMode({ kind: "edit", nodeId: node.id }); setEditorOpen(true); }}
        onCancelEdit={(node) => { setEditingNode(null); setPaperMode({ kind: "detail", nodeId: node.id }); setPaperError(null); setEditorOpen(true); }}
      />
      <UniverseRelationPaper
        source={snapshot.nodes.find((node) => node.id === relationSourceId) ?? null}
        nodes={snapshot.nodes}
        open={relationEditorOpen}
        saving={saving}
        errorMessage={paperError}
        triggerRef={paperTriggerRef}
        onRequestClose={() => { setRelationEditorOpen(false); setRelationSourceId(null); setPaperError(null); setMapMode({ kind: "browse" }); return true; }}
        onSave={saveRelation}
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

export function toggleUniverseGalaxyMemberships(
  current: UniverseNode["galaxies"],
  galaxyId: string,
  weight?: number,
): UniverseNode["galaxies"] {
  if (current.some((membership) => membership.id === galaxyId)) {
    return current.filter((membership) => membership.id !== galaxyId);
  }
  if (typeof weight !== "number" || !Number.isFinite(weight)) return current;
  return [...current, { id: galaxyId, weight }];
}

function safeUniverseError(error: unknown): string {
  if (isUniverseVersionConflict(error)) return "Universe 已在其他设备发生变化，请重新读取后再试。";
  if ((error as { code?: unknown })?.code === "UNIVERSE_NOT_INITIALIZED") return "Universe 尚未初始化。";
  return "Universe 暂时无法读取，请稍后重试。";
}
