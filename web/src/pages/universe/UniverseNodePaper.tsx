import { formatDiarySourceDate, sourceOptionFromSummary, formatUniverseNodeTimestamp, formatStandaloneDate, formatMembershipWeight, canonicalWeightTextToPercentText, percentWeightTextToCanonicalText } from "./universe-node-presentation";
import { DiaryProvenanceTimeline } from "./DiaryProvenanceTimeline";
import { useEffect, useRef, useState, type RefObject } from "react";
import { PaperDetailDialog } from "../PaperDetailDialog";
import type { UniverseDiarySourceOption, UniverseDiarySourceSummary, UniverseGalaxy, UniverseNode, UniverseRelation } from "./universe-types";
import type { UniversePoint } from "./universe-map-transform";
import { relationTypeLabel } from "./universe-map-presentation";
import { UniverseNodeMetadata, parseUniverseTags, toCanonicalMemberships, type MembershipDraft } from "./UniverseNodeMetadata";
import { UniverseFloatingPopover } from "./UniverseFloatingPopover";
import "./universe-node-paper-web-mobile.css";

export type UniverseNodePaperMode =
  | { kind: "detail"; nodeId: string }
  | { kind: "edit"; nodeId: string }
  | { kind: "create"; position: UniversePoint };

export type UniverseNodePaperDraft = Pick<UniverseNode, "title" | "summary" | "content" | "type" | "tags" | "galaxies"> & { importance: string; sourceDiaryIds: string[] };

const NODE_TYPES: UniverseNode["type"][] = ["concept", "question", "claim", "experience", "project", "source", "reflection"];
const NODE_TYPE_LABELS: Record<string, string> = {
  concept: "概念",
  question: "问题",
  claim: "观点",
  experience: "经历",
  project: "项目",
  source: "来源",
  reflection: "反思",
};

export function UniverseNodePaper({
  node,
  galaxies,
  mode,
  open,
  saving,
  errorMessage,
  triggerRef,
  revisionsAvailable,
  onRequestClose,
  onSave,
  onDelete,
  onRestore,
  onCreateRelation,
  onDeleteRelation,
  onOpenRelatedNode,
  onEdit,
  onCancelEdit,
  connections = [],
  sources = [],
  onOpenDiarySource,
  diarySourceOptions = [],
  onSearchDiarySourceOptions,
}: {
  node: UniverseNode | null;
  galaxies: UniverseGalaxy[];
  mode: UniverseNodePaperMode | null;
  open: boolean;
  saving: boolean;
  errorMessage?: string | null;
  triggerRef: RefObject<HTMLElement | null>;
  revisionsAvailable?: boolean;
  onRequestClose(): boolean | Promise<boolean>;
  onSave(draft: UniverseNodePaperDraft): Promise<void>;
  onDelete?(node: UniverseNode): void;
  onRestore?(node: UniverseNode): void;
  onCreateRelation?(node: UniverseNode): void;
  onDeleteRelation?(relation: UniverseRelation): void;
  onOpenRelatedNode?(nodeId: string): void;
  onEdit?(node: UniverseNode): void;
  onCancelEdit?: (node: UniverseNode) => void;
  connections?: Array<{ relation: UniverseRelation; node: UniverseNode }>;
  sources?: UniverseDiarySourceSummary[];
  onOpenDiarySource?: (diaryId: string) => void;
  diarySourceOptions?: UniverseDiarySourceOption[];
  onSearchDiarySourceOptions?: (query: string) => Promise<UniverseDiarySourceOption[]>;
}) {
  const isCreate = mode?.kind === "create";
  const isEdit = mode?.kind === "edit" || isCreate;
  const effectiveNode = node;
  const [title, setTitle] = useState(effectiveNode?.title ?? "");
  const [summary, setSummary] = useState(effectiveNode?.summary ?? "");
  const [content, setContent] = useState(effectiveNode?.content ?? "");
  const [type, setType] = useState(effectiveNode?.type ?? "concept");
  const [importance, setImportance] = useState(effectiveNode?.importance ?? "normal");
  const [tags, setTags] = useState((effectiveNode?.tags ?? []).join(", "));
  const [memberships, setMemberships] = useState<MembershipDraft[]>(() => (effectiveNode?.galaxies ?? []).map((membership) => ({ id: membership.id, weightText: String(membership.weight) })));
  const [sourceDiaryIds, setSourceDiaryIds] = useState<string[]>(() => (!isCreate ? sources.map((source) => source.diaryId) : []));
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [sourcePickerQuery, setSourcePickerQuery] = useState("");
  const [sourcePickerSelection, setSourcePickerSelection] = useState<string[]>([]);
  const [sourcePickerResults, setSourcePickerResults] = useState<UniverseDiarySourceOption[]>(diarySourceOptions);
  const [sourceMetadataById, setSourceMetadataById] = useState<Record<string, UniverseDiarySourceOption>>(() => Object.fromEntries([
    ...sources.map(sourceOptionFromSummary),
    ...diarySourceOptions,
  ].map((source) => [source.id, source])));
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [detailOverflowOpen, setDetailOverflowOpen] = useState(false);
  const [deleteConfirmPending, setDeleteConfirmPending] = useState(false);
  const [connectionMenuId, setConnectionMenuId] = useState<string | null>(null);
  const connectionAnchorRef = useRef<HTMLButtonElement | null>(null);
  const createTimestampRef = useRef<string | null>(null);

  if (isCreate && !createTimestampRef.current) createTimestampRef.current = new Date().toISOString();

  useEffect(() => {
    setTitle(effectiveNode?.title ?? "");
    setSummary(effectiveNode?.summary ?? "");
    setContent(effectiveNode?.content ?? "");
    setType(effectiveNode?.type ?? "concept");
    setImportance(effectiveNode?.importance ?? "normal");
    setTags((effectiveNode?.tags ?? []).join(", "));
    const nextMemberships = effectiveNode?.galaxies ?? [];
    setMemberships(nextMemberships.map((membership) => ({ id: membership.id, weightText: String(membership.weight) })));
    setSourceDiaryIds(!isCreate ? sources.map((source) => source.diaryId) : []);
    setSourcePickerOpen(false);
    setSourcePickerQuery("");
    setSourcePickerResults(diarySourceOptions);
    setMembershipError(null);
    setConnectionMenuId(null);
    setDetailOverflowOpen(false);
    setDeleteConfirmPending(false);
    if (!isCreate) createTimestampRef.current = null;
  }, [effectiveNode, mode?.kind]);

  useEffect(() => {
    const incoming = [...sources.map(sourceOptionFromSummary), ...diarySourceOptions];
    setSourceMetadataById((current) => {
      let changed = false;
      const next = { ...current };
      for (const source of incoming) {
        if (next[source.id]?.title !== source.title || next[source.id]?.date !== source.date || next[source.id]?.status !== source.status) {
          next[source.id] = source;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [sources, diarySourceOptions]);

  useEffect(() => {
    if (!sourcePickerOpen || !onSearchDiarySourceOptions) return;
    let active = true;
    void onSearchDiarySourceOptions(sourcePickerQuery).then((results) => {
      if (active) {
        setSourcePickerResults(results);
        setSourceMetadataById((current) => ({ ...current, ...Object.fromEntries(results.map((source) => [source.id, source])) }));
      }
    }).catch(() => {
      if (active) setSourcePickerResults([]);
    });
    return () => { active = false; };
  }, [onSearchDiarySourceOptions, sourcePickerOpen, sourcePickerQuery]);

  if (!effectiveNode && !isCreate) return null;
  const id = isCreate ? "universe-node-create-paper" : `universe-node-paper-${effectiveNode!.id}`;
  const label = isCreate ? "点亮一颗新星" : isEdit ? "调整星球" : "Universe 节点";

  const buildMemberships = () => {
    const next = toCanonicalMemberships(memberships);
    if (!next || next.some((membership) => !Number.isFinite(membership.weight))) {
      setMembershipError("请为每个星系成员填写权重。");
      return null;
    }
    return next;
  };
  const canonicalMemberships = toCanonicalMemberships(memberships);
  const sourceById = (diaryId: string) => sourceMetadataById[diaryId];
  const formatSourceChip = (diaryId: string) => {
    const source = sourceById(diaryId);
    return `${formatDiarySourceDate(source?.date ?? "")} · ${source?.title ?? diaryId} ×`;
  };
  const openSourcePicker = () => {
    setSourcePickerSelection(sourceDiaryIds);
    setSourcePickerResults(diarySourceOptions);
    setSourceMetadataById((current) => ({ ...current, ...Object.fromEntries(diarySourceOptions.map((source) => [source.id, source])) }));
    setSourcePickerQuery("");
    setSourcePickerOpen(true);
  };
  const toggleSourcePickerSelection = (diaryId: string) => {
    setSourcePickerSelection((current) => current.includes(diaryId) ? current.filter((id) => id !== diaryId) : [...current, diaryId]);
  };
  const submit = () => {
    const nextMemberships = buildMemberships();
    if (!nextMemberships) return;
    void onSave({ title: title.trim(), summary: summary.trim(), content: content.trim(), type, importance, tags: parseUniverseTags(tags), galaxies: nextMemberships, sourceDiaryIds });
  };

  const cancelEditor = () => {
    if (isCreate || !effectiveNode || !onCancelEdit) {
      void onRequestClose();
      return;
    }
    onCancelEdit(effectiveNode);
  };

  const toggleMembership = (galaxyId: string) => {
    setMembershipError(null);
    setMemberships((current) => current.some((membership) => membership.id === galaxyId)
      ? current.filter((membership) => membership.id !== galaxyId)
      : [...current, { id: galaxyId, weightText: "" }]);
  };

  const updateMembershipWeight = (galaxyId: string, weightText: string) => {
    setMembershipError(null);
    setMemberships((current) => current.map((membership) => membership.id === galaxyId ? { ...membership, weightText } : membership));
  };

  const metadata = (
    <UniverseNodeMetadata
      galaxies={galaxies}
      type={type as UniverseNode["type"]}
      importance={importance}
      tags={isEdit ? parseUniverseTags(tags) : (effectiveNode?.tags ?? [])}
      tagsValue={isEdit ? tags : undefined}
      memberships={memberships}
      editable={isEdit}
      onTypeChange={(value) => setType(value)}
      onImportanceChange={setImportance}
      onTagsChange={setTags}
      onMembershipsChange={(value) => { setMembershipError(null); setMemberships(value); }}
    />
  );

  const sourceEditorField = isEdit ? (
    <div className="universe-standalone-form-field universe-standalone-source-field">
      <label>来源日记 · 可选</label>
      <div className="universe-standalone-source-chips">
        {sourceDiaryIds.map((diaryId) => <button type="button" className="universe-standalone-source-chip" key={diaryId} onClick={() => setSourceDiaryIds((current) => current.filter((id) => id !== diaryId))}>{formatSourceChip(diaryId)}</button>)}
        <button type="button" className="universe-standalone-source-add" onClick={openSourcePicker}>＋ 添加</button>
      </div>
      {sourcePickerOpen ? (
        <div className="universe-standalone-source-picker" role="dialog" aria-label="选择来源日记">
          <div className="universe-standalone-source-picker-head"><strong>选择来源日记</strong></div>
          <input aria-label="搜索来源日记" placeholder="搜索标题、日期或标签" value={sourcePickerQuery} onChange={(event) => setSourcePickerQuery(event.target.value)} />
          <div className="universe-standalone-source-results">
            {sourcePickerResults.map((option) => {
              const selected = sourcePickerSelection.includes(option.id);
              return <button type="button" key={option.id} className={selected ? "is-selected" : undefined} aria-pressed={selected} onClick={() => toggleSourcePickerSelection(option.id)}><span>{formatDiarySourceDate(option.date)} · {option.title}</span>{option.status === "archived" ? <small>归档</small> : null}</button>;
            })}
          </div>
          <div className="universe-standalone-source-picker-actions">
            <button type="button" aria-label="取消来源选择" onClick={() => setSourcePickerOpen(false)}>取消</button>
            <button type="button" onClick={() => { setSourceDiaryIds(sourcePickerSelection); setSourcePickerOpen(false); }}>完成</button>
          </div>
        </div>
      ) : null}
    </div>
  ) : null;

  const renderManagementMenu = (className?: string) => effectiveNode ? (
    <span className={className ? `universe-node-paper-overflow ${className}` : "universe-node-paper-overflow"}>
      <button type="button" className="tertiary-button" aria-label="更多星球操作" aria-expanded={detailOverflowOpen} onClick={() => { setDetailOverflowOpen((value) => !value); setDeleteConfirmPending(false); }}>···</button>
      {detailOverflowOpen ? (
        <span className="universe-node-paper-overflow-menu" role="menu">
          {revisionsAvailable && onRestore ? <button type="button" disabled={saving} onClick={() => { setDetailOverflowOpen(false); setDeleteConfirmPending(false); onRestore(effectiveNode); }}>恢复上一版本</button> : null}
          {onDelete ? (
            <button
              type="button"
              className={deleteConfirmPending ? "universe-node-paper-delete is-confirming" : "universe-node-paper-delete"}
              disabled={saving}
              onClick={() => {
                if (!deleteConfirmPending) {
                  setDeleteConfirmPending(true);
                  return;
                }
                setDetailOverflowOpen(false);
                setDeleteConfirmPending(false);
                onDelete(effectiveNode);
              }}
            >
              {deleteConfirmPending ? "确认让它离开" : "让它离开宇宙"}
            </button>
          ) : null}
        </span>
      ) : null}
    </span>
  ) : null;

  const detailTopRight = effectiveNode ? (
    <div className="universe-node-paper-top-actions">
      {renderManagementMenu()}
      <button type="button" className="tertiary-button" onClick={() => onEdit?.(effectiveNode)}>编辑</button>
    </div>
  ) : null;

  const editTopRight = (
    <div className="universe-node-paper-top-actions">
      <button type="button" className="tertiary-button" onClick={cancelEditor}>取消</button>
      <button type="button" className="tertiary-button" disabled={saving || !title.trim() || canonicalMemberships === null} onClick={submit}>{saving ? "保存中…" : "保存"}</button>
    </div>
  );

  const desktopBody = isEdit ? (
    <div className="universe-node-paper-body">
      <input className="universe-paper-title-editor" aria-label="星球标题" placeholder="星球标题" autoFocus value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} />
      <textarea className="universe-paper-summary-editor" aria-label="星球摘要" placeholder=" " value={summary} rows={2} onChange={(event) => setSummary(event.target.value)} />
      <textarea className="universe-paper-content-editor" aria-label="星球正文" placeholder="记录这颗星球的想法" value={content} rows={6} onChange={(event) => setContent(event.target.value)} />
      {!isCreate && connections.length ? <section className="universe-node-connections" aria-label="思想连接"><h3>Connections</h3>{connections.map(({ relation, node: relatedNode }) => <div className="universe-node-connection" key={relation.id}><button type="button" className="universe-node-connection-link" onClick={() => onOpenRelatedNode?.(relatedNode.id)}><span>{relatedNode.title}</span><small>{relationTypeLabel(relation.relationType)}</small></button>{onDeleteRelation ? <span className="universe-node-connection-actions"><button type="button" className="universe-node-connection-overflow" aria-label="连接操作" disabled={saving} onClick={(event) => { connectionAnchorRef.current = event.currentTarget; setConnectionMenuId((current) => current === relation.id ? null : relation.id); }}>···</button>{connectionMenuId === relation.id ? <UniverseFloatingPopover open anchorRef={connectionAnchorRef} className="universe-connection-popover" ariaLabel="连接操作" onRequestClose={() => setConnectionMenuId(null)}><button type="button" disabled={saving} onClick={() => { setConnectionMenuId(null); onDeleteRelation(relation); }}>移除连接</button></UniverseFloatingPopover> : null}</span> : null}</div>)}</section> : null}
      {membershipError || (canonicalMemberships === null && memberships.length > 0) ? <p className="universe-paper-inline-error" role="alert">{membershipError ?? "请填写星系权重"}</p> : null}
    </div>
  ) : (
    <div className="universe-node-paper-body">
      <h2>{effectiveNode!.title}</h2>
      {effectiveNode!.summary ? <p>{effectiveNode!.summary}</p> : null}
      {effectiveNode!.content ? <p>{effectiveNode!.content}</p> : null}
      {connections.length ? <section className="universe-node-connections" aria-label="思想连接"><h3>Connections</h3>{connections.map(({ relation, node: relatedNode }) => <div className="universe-node-connection" key={relation.id}><button type="button" className="universe-node-connection-link" onClick={() => onOpenRelatedNode?.(relatedNode.id)}><span>{relatedNode.title}</span><small>{relationTypeLabel(relation.relationType)}</small></button></div>)}</section> : null}
      <DiaryProvenanceTimeline sources={sources} onOpen={onOpenDiarySource} />
    </div>
  );

  const mobileStandaloneBody = isEdit ? (
    <section className="universe-standalone-editor" aria-label={isCreate ? "点亮星球" : "调整星球"}>
      <header className="universe-standalone-editor-heading">
        <p className="universe-standalone-editor-context">{isCreate ? "新星 · 待点亮" : <>当前思想 · {effectiveNode!.title}</>}</p>
        {!isCreate ? renderManagementMenu("universe-standalone-editor-management") : null}
      </header>

      <div className="universe-standalone-editor-body">
        <h2>{isCreate ? "点亮一颗新星" : "调整这颗星球"}</h2>
        <div className="universe-standalone-form-field">
          <label htmlFor={`${id}-title`}>它叫什么？</label>
          <input id={`${id}-title`} value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} placeholder="一个概念、问题或经历" />
        </div>

        <div className="universe-standalone-form-field">
          <label htmlFor={`${id}-summary`}>一句话描述 · 可选</label>
          <textarea id={`${id}-summary`} value={summary} rows={2} onChange={(event) => setSummary(event.target.value)} placeholder="为什么它值得留在你的宇宙？" />
        </div>

        <div className="universe-standalone-form-field">
          <label htmlFor={`${id}-content`}>此刻的理解</label>
          <textarea id={`${id}-content`} value={content} rows={4} onChange={(event) => setContent(event.target.value)} placeholder="写下你现在怎样理解它。" />
        </div>

        <div className="universe-standalone-form-field">
          <label htmlFor={`${id}-type`}>节点性质</label>
          <select id={`${id}-type`} value={type} onChange={(event) => setType(event.target.value as UniverseNode["type"])}>
            {NODE_TYPES.map((option) => <option key={option} value={option}>{NODE_TYPE_LABELS[option] ?? option}</option>)}
          </select>
        </div>

        <div className="universe-standalone-form-field">
          <label htmlFor={`${id}-tags`}>标签</label>
          <input id={`${id}-tags`} value={tags} onChange={(event) => setTags(event.target.value)} placeholder="自我观察, 认知演化" />
        </div>

        {galaxies.length ? (
          <fieldset className="universe-standalone-galaxies">
            <legend>它同时闪耀在哪些星系？</legend>
            <div className="universe-standalone-galaxy-grid">
              {galaxies.slice().sort((a, b) => a.order - b.order).map((galaxy) => {
                const membership = memberships.find((item) => item.id === galaxy.id);
                const selected = Boolean(membership);
                return (
                  <label className={selected ? "universe-standalone-galaxy-chip is-selected" : "universe-standalone-galaxy-chip"} key={galaxy.id} style={selected ? { borderColor: galaxy.color, color: galaxy.color } : undefined}>
                    <input type="checkbox" checked={selected} onChange={() => toggleMembership(galaxy.id)} />
                    <span>{galaxy.title}</span>
                    {selected ? (
                      <span className="universe-standalone-weight-wrap">
                        <input
                          className="universe-standalone-weight"
                          aria-label={`${galaxy.title} 权重百分比`}
                          type="number"
                          step="any"
                          inputMode="decimal"
                          value={canonicalWeightTextToPercentText(membership?.weightText ?? "")}
                          onInput={(event) => updateMembershipWeight(galaxy.id, percentWeightTextToCanonicalText(event.currentTarget.value))}
                          onChange={(event) => updateMembershipWeight(galaxy.id, percentWeightTextToCanonicalText(event.target.value))}
                          placeholder="0"
                        />
                        <span className="universe-standalone-weight-suffix">%</span>
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        {sourceEditorField}

        {errorMessage ? <p className="universe-standalone-error" role="alert">{errorMessage}</p> : null}
      </div>

      <footer className="universe-standalone-editor-footer">
        <button className="universe-standalone-cancel" type="button" onClick={cancelEditor}>取消</button>
        <button className="universe-standalone-primary" type="button" disabled={saving || !title.trim() || canonicalMemberships === null} onClick={submit}>{saving ? "保存中…" : isCreate ? "点亮星球" : "保存星球"}</button>
      </footer>
    </section>
  ) : (
    <section className="universe-standalone-detail" aria-label="Selected universe node">
      <div className="universe-standalone-detail-head">
        <span className="universe-standalone-type-chip">{NODE_TYPE_LABELS[effectiveNode!.type] ?? effectiveNode!.type}</span>
        <span className="universe-standalone-updated">更新于 {formatStandaloneDate(effectiveNode!.updatedAt)}</span>
      </div>

      <div className="universe-standalone-detail-scroll">
        <h2>{effectiveNode!.title}</h2>
        {effectiveNode!.summary ? <p className="universe-standalone-summary">{effectiveNode!.summary}</p> : null}
        {effectiveNode!.content ? <p className="universe-standalone-content">{effectiveNode!.content}</p> : null}

        {effectiveNode!.tags.length ? <div className="universe-standalone-tags">{effectiveNode!.tags.map((tag) => <span className="universe-standalone-tag" key={tag}># {tag}</span>)}</div> : null}

        {effectiveNode!.galaxies.length ? (
          <div className="universe-standalone-memberships">
            {effectiveNode!.galaxies.map((membership) => {
              const galaxy = galaxies.find((item) => item.id === membership.id);
              return <span className="universe-standalone-membership" key={membership.id} style={{ borderLeftColor: galaxy?.color ?? "#9a8cff", color: galaxy?.color ?? "#aeb0bf" }}>{galaxy?.title ?? membership.id} · {formatMembershipWeight(membership.weight)}</span>;
            })}
          </div>
        ) : null}

        <div className="universe-standalone-divider" />
        <div className="universe-standalone-stats">
          <span>一阶关联 <strong>{connections.length}</strong> 条</span>
        </div>

        {connections.length ? (
          <div className="universe-standalone-relations" aria-label="思想连接">
            {connections.map(({ relation, node: relatedNode }) => (
              <div className="universe-standalone-relation-chip" key={relation.id}>
                <button type="button" className="universe-standalone-relation-link" onClick={() => onOpenRelatedNode?.(relatedNode.id)}>{relationTypeLabel(relation.relationType)} · {relatedNode.title}</button>
                {onDeleteRelation ? <button type="button" className="universe-standalone-relation-remove" aria-label={`移除与 ${relatedNode.title} 的连接`} disabled={saving} onClick={() => onDeleteRelation(relation)}>×</button> : null}
              </div>
            ))}
          </div>
        ) : null}

        <DiaryProvenanceTimeline sources={sources} onOpen={onOpenDiarySource} />

        {errorMessage ? <p className="universe-standalone-error" role="alert">{errorMessage}</p> : null}
      </div>

      <div className="universe-standalone-detail-actions">
        {onCreateRelation ? <button type="button" onClick={() => onCreateRelation(effectiveNode!)}>连接另一个思想</button> : <span />}
        <button type="button" onClick={() => onEdit?.(effectiveNode!)}>调整这颗星球</button>
      </div>
    </section>
  );

  return (
    <PaperDetailDialog
      id={id}
      open={open}
      label={label}
      dateLabel={formatUniverseNodeTimestamp(isCreate ? (createTimestampRef.current ?? new Date().toISOString()) : effectiveNode!.createdAt)}
      signature=""
      showRules={false}
      topRight={isEdit ? editTopRight : detailTopRight}
      triggerRef={triggerRef}
      onRequestClose={onRequestClose}
      errorMessage={errorMessage}
      bottomLeft={metadata}
    >
      <div className="universe-node-paper-desktop">{desktopBody}</div>
      <div className="universe-node-original-web-mobile">{mobileStandaloneBody}</div>
    </PaperDetailDialog>
  );
}
