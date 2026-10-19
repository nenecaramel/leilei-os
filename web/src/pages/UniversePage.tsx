import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import type { WebApiClient } from "../api/useWebApiClient";
import { UniverseHeader, UniverseFrame, UniverseLoadingState, UniverseStatus } from "./universe/UniversePagePresentation";
import "./universe-state-polish.css";
import {
  createLeileiOSUniverseAdapter,
} from "./universe/universe-adapter";
import {
  createLeileiOSUniverseService,
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
import { consumeUniverseNodeTarget, createUniverseNodeReturnTo } from "./universe/universe-location";
import { createArchivedDiaryDetailLocation, createDiaryDetailLocation } from "./diary-location";
import { navigateWithinApp } from "./app-navigation";
import type { UniverseMapMode } from "./universe/universe-map-interaction";
import type { UniversePoint, UniverseViewport } from "./universe/universe-map-transform";
import type {
  UniverseDiarySourceSummary,
  UniverseNode,
  UniverseNodeCreateInput,
  UniverseRelation,
  UniverseRelationCreateInput,
  UniverseSnapshot,
} from "./universe/universe-types";


type UniverseState =
  | { status: "loading" }
  | { status: "not-initialized" }
  | { status: "error"; message: string }
  | { status: "ready"; snapshot: UniverseSnapshot; version: number; sources?: UniverseDiarySourceSummary[] };

type UniverseNotice = { id: number; message: string };

export function UniversePage({ api }: { api: WebApiClient }) {
  return <UniversePageContent api={api} />;
}

function UniversePageContent({ api }: { api: WebApiClient }) {
  const service = useMemo(
    () => createLeileiOSUniverseService({ adapter: createLeileiOSUniverseAdapter(api) }),
    [api],
  );
  const location = useLocation();
  const [state, setState] = useState<UniverseState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [galaxyFilter, setGalaxyFilter] = useState<string | null>(null);
  const [galaxyPickerOpen, setGalaxyPickerOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [placementOpen, setPlacementOpen] = useState(false);
  const [notice, setNotice] = useState<UniverseNotice | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<UniverseNode | null>(null);
  const editingVersion = useRef<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [nodeSaveConflict, setNodeSaveConflict] = useState(false);
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
  const noticeSequence = useRef(0);

  const showNotice = (message: string) => {
    noticeSequence.current += 1;
    setNotice({ id: noticeSequence.current, message });
  };

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

  useEffect(() => {
    if (!notice || editorOpen || relationEditorOpen) return;
    const timer = window.setTimeout(() => {
      setNotice((current) => current?.id === notice.id ? null : current);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [notice, editorOpen, relationEditorOpen]);

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

  useEffect(() => {
    if (state.status !== "ready") return;
    const target = consumeUniverseNodeTarget(location.search, state.snapshot.nodes.map((node) => node.id));
    if (!target) return;
    window.history.replaceState(window.history.state, "", `${location.pathname}${target.remainingSearch}${location.hash}`);
    window.dispatchEvent(new window.PopStateEvent("popstate"));
    if (selectedId === target.nodeId) return;
    setPaperError(null);
    setSelectedId(target.nodeId);
    setRevealNodeId(target.nodeId);
    setPaperMode({ kind: "detail", nodeId: target.nodeId });
    setEditorOpen(true);
  }, [location, selectedId, state]);

  async function saveNode(values: UniverseNodePaperDraft) {
    if (saving || nodeSaveConflict) return;
    if (editingNode && editingVersion.current !== service.getState()?.version) {
      setNodeSaveConflict(true);
      setPaperError("Universe 已发生变化。草稿已保留，请取消编辑后重新打开，再决定如何修改。");
      return;
    }
    setSaving(true);
    setPaperError(null);
    try {
      if (editingNode) {
        const editedNodeId = editingNode.id;
        const { sourceDiaryIds, ...nodePatch } = values;
        await service.updateNode(editedNodeId, nodePatch, "Universe Web 编辑", sourceDiaryIds);
        showNotice("星球已更新。");
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
        await service.createNode(node, values.sourceDiaryIds);
        showNotice("一颗新星已经亮起。");
        setEditorOpen(false);
        setEditingNode(null);
        setPendingPosition(null);
        refreshFromService();
      }
    } catch (error) {
      if (isUniverseVersionConflict(error)) {
        setNodeSaveConflict(true);
        setPaperError("Universe 已在其他设备发生变化。草稿已保留，请取消编辑后重新打开，再决定如何修改。");
      } else {
        setPaperError(safeUniverseError(error));
      }
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
      showNotice("星球已从当前宇宙移除。");
      refreshFromService();
    } catch (error) {
      showNotice(safeUniverseError(error));
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
      showNotice("新的思想连接已经出现。");
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
            showNotice(message);
            setState({ status: "ready", ...result });
          }}
          onRecheck={() => setReload((value) => value + 1)}
        />
      </UniverseFrame>
    );
  }
  if (state.status === "error") {
    return <UniverseFrame><UniverseStatus onRetry={() => setReload((value) => value + 1)} /></UniverseFrame>;
  }

  const { snapshot } = state;
  const selectedNode = snapshot.nodes.find((node) => node.id === selectedId) ?? null;
  const selectedSources = selectedNode ? (state.sources ?? []).filter((source) => source.nodeId === selectedNode.id) : [];
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
      showNotice("思想连接已移除。");
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
        notice={notice?.message}
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
        onPlaceNode={(position) => { setNodeSaveConflict(false); setPlacementOpen(false); setPaperError(null); setPendingPosition(position); setEditingNode(null); setPaperMode({ kind: "create", position }); setMapMode({ kind: "browse" }); setEditorOpen(true); }}
        onMoveNode={async (nodeId, position) => {
          try {
            await service.updateNode(nodeId, { position }, "Universe Web 移动星球");
            showNotice("星球位置已更新。");
            refreshFromService();
          } catch (error) {
            showNotice(safeUniverseError(error));
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
        saveBlocked={nodeSaveConflict}
        errorMessage={paperError}
        triggerRef={paperTriggerRef}
        revisionsAvailable={selectedNode ? snapshot.revisions.some((revision) => revision.nodeId === selectedNode.id) : false}
        connections={selectedConnections}
        sources={selectedSources}
        onSearchDiarySourceOptions={(query) => service.searchDiarySourceOptions(query)}
        onOpenDiarySource={(diaryId) => {
          if (!selectedNode) return;
          const source = selectedSources.find((item) => item.diaryId === diaryId);
          if (!source) return;
          const returnTo = createUniverseNodeReturnTo(selectedNode.id);
          const next = source.status === "archived"
            ? createArchivedDiaryDetailLocation(diaryId, returnTo)
            : createDiaryDetailLocation(diaryId, returnTo);
          navigateWithinApp(next, window.history.state, { resetScroll: false });
        }}
        onRequestClose={() => { setNodeSaveConflict(false); setEditorOpen(false); setPaperMode(null); setPaperError(null); return true; }}
        onSave={saveNode}
        onDelete={(node) => void removeNode(node)}
        onRestore={(node) => { void service.restoreLatestRevision(node.id).then(() => { showNotice("已恢复最近的认知版本。"); refreshFromService(); }).catch((error) => { showNotice(safeUniverseError(error)); void reconcileAfterMutationFailure(); }); }}
        onCreateRelation={(node) => { setSelectedId(node.id); setRelationSourceId(node.id); setPaperError(null); setMapMode({ kind: "browse" }); setRelationEditorOpen(true); setEditorOpen(false); setPaperMode(null); }}
        onDeleteRelation={(relation) => void removeRelation(relation)}
        onOpenRelatedNode={(nodeId) => { setEditorOpen(false); setPaperMode(null); setSelectedId(nodeId); setRevealNodeId(nodeId); setPaperError(null); }}
        onEdit={(node) => { editingVersion.current = service.getState()?.version ?? null; setNodeSaveConflict(false); setEditingNode(node); setPaperMode({ kind: "edit", nodeId: node.id }); setEditorOpen(true); }}
        onCancelEdit={(node) => { setNodeSaveConflict(false); setEditingNode(null); setPaperMode({ kind: "detail", nodeId: node.id }); setPaperError(null); setEditorOpen(true); }}
      />
      <UniverseRelationPaper
        source={snapshot.nodes.find((node) => node.id === relationSourceId) ?? null}
        nodes={snapshot.nodes}
        open={relationEditorOpen}
        saving={saving}
        errorMessage={paperError}
        triggerRef={paperTriggerRef}
        onRequestClose={() => {
          const sourceId = relationSourceId;
          setRelationEditorOpen(false);
          setRelationSourceId(null);
          setPaperError(null);
          setMapMode({ kind: "browse" });
          if (sourceId) {
            setSelectedId(sourceId);
            setPaperMode({ kind: "detail", nodeId: sourceId });
            setEditorOpen(true);
          }
          return true;
        }}
        onSave={saveRelation}
      />
    </div>
  );
}

function safeUniverseError(error: unknown): string {
  if (isUniverseVersionConflict(error)) return "Universe 已在其他设备发生变化，请重新读取后再试。";
  if ((error as { code?: unknown })?.code === "UNIVERSE_NOT_INITIALIZED") return "Universe 尚未初始化。";
  return "Universe 暂时无法读取，请稍后重试。";
}
