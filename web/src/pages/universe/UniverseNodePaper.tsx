import { useEffect, useRef, useState, type RefObject } from "react";
import { PaperDetailDialog } from "../PaperDetailDialog";
import type { UniverseGalaxy, UniverseNode, UniverseRelation } from "./universe-types";
import type { UniversePoint } from "./universe-map-transform";
import { relationTypeLabel } from "./universe-map-presentation";
import { UniverseNodeMetadata, parseUniverseTags, toCanonicalMemberships, type MembershipDraft } from "./UniverseNodeMetadata";
import { UniverseFloatingPopover } from "./UniverseFloatingPopover";
import "./universe-node-paper-web-mobile.css";

export type UniverseNodePaperMode =
  | { kind: "detail"; nodeId: string }
  | { kind: "edit"; nodeId: string }
  | { kind: "create"; position: UniversePoint };

export type UniverseNodePaperDraft = Pick<UniverseNode, "title" | "summary" | "content" | "type" | "tags" | "galaxies"> & { importance: string };

export function formatUniverseNodeTimestamp(value: string, timeZone?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}.${get("month")}.${get("day")} ${get("hour")}:${get("minute")}`;
}

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
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [detailOverflowOpen, setDetailOverflowOpen] = useState(false);
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
    setMembershipError(null);
    setConnectionMenuId(null);
    if (!isCreate) createTimestampRef.current = null;
  }, [effectiveNode, mode?.kind]);

  if (!effectiveNode && !isCreate) return null;
  const id = isCreate ? "universe-node-create-paper" : `universe-node-paper-${effectiveNode!.id}`;
  const label = isCreate ? "点亮一颗新星" : isEdit ? "调整星球" : "Universe 节点";

  const buildMemberships = () => {
    const next = toCanonicalMemberships(memberships);
    if (!next) {
      setMembershipError("请为每个星系成员填写权重。");
      return null;
    }
    return next;
  };
  const canonicalMemberships = toCanonicalMemberships(memberships);
  const submit = () => {
    const nextMemberships = buildMemberships();
    if (!nextMemberships) return;
    void onSave({ title: title.trim(), summary: summary.trim(), content: content.trim(), type, importance, tags: parseUniverseTags(tags), galaxies: nextMemberships });
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

  const detailTopRight = effectiveNode ? (
    <div className="universe-node-paper-top-actions">
      <span className="universe-node-paper-overflow">
        <button type="button" className="tertiary-button" aria-label="更多星球操作" aria-expanded={detailOverflowOpen} onClick={() => setDetailOverflowOpen((value) => !value)}>···</button>
        {detailOverflowOpen ? (
          <span className="universe-node-paper-overflow-menu" role="menu">
            <button type="button" onClick={() => { setDetailOverflowOpen(false); onCreateRelation?.(effectiveNode); }}>建立连接</button>
            <button type="button" disabled={!revisionsAvailable || saving} onClick={() => { setDetailOverflowOpen(false); onRestore?.(effectiveNode); }}>恢复上一版本</button>
            {onDelete ? <button type="button" disabled={saving} onClick={() => { setDetailOverflowOpen(false); onDelete(effectiveNode); }}>移除星球</button> : null}
          </span>
        ) : null}
      </span>
      <button type="button" className="tertiary-button" onClick={() => onEdit?.(effectiveNode)}>编辑</button>
    </div>
  ) : null;

  const editTopRight = (
    <div className="universe-node-paper-top-actions">
      <button
        type="button"
        className="tertiary-button"
        onClick={() => {
          if (isCreate || !effectiveNode || !onCancelEdit) {
            void onRequestClose();
            return;
          }
          onCancelEdit(effectiveNode);
        }}
      >取消</button>
      <button type="button" className="tertiary-button" disabled={saving || !title.trim() || canonicalMemberships === null} onClick={submit}>{saving ? "保存中…" : "保存"}</button>
    </div>
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
      {isEdit ? (
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
        </div>
      )}
    </PaperDetailDialog>
  );
}
