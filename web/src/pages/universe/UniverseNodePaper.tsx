import { useEffect, useRef, useState, type RefObject } from "react";
import { PaperDetailDialog } from "../PaperDetailDialog";
import type { UniverseGalaxy, UniverseNode, UniverseRelation } from "./universe-types";
import type { UniversePoint } from "./universe-map-transform";
import { relationTypeLabel } from "./universe-map-presentation";
import { UniverseNodeMetadata, toCanonicalMemberships, type MembershipDraft } from "./UniverseNodeMetadata";

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
    void onSave({ title: title.trim(), summary: summary.trim(), content: content.trim(), type, importance, tags: tags.split(/[,，]/).map((value) => value.trim()).filter(Boolean), galaxies: nextMemberships });
  };

  return (
    <PaperDetailDialog
      id={id}
      open={open}
      label={label}
      dateLabel={formatUniverseNodeTimestamp(isCreate ? new Date().toISOString() : effectiveNode!.createdAt)}
      signature=""
      showRules={false}
      topRight={isEdit ? (
        <div className="universe-node-paper-top-actions">
          <button type="button" className="tertiary-button" onClick={() => void onRequestClose()}>取消</button>
          <button type="button" className="tertiary-button" disabled={saving || !title.trim() || canonicalMemberships === null} onClick={submit}>{saving ? "保存中…" : "保存"}</button>
        </div>
      ) : effectiveNode ? (
        <div className="universe-node-paper-top-actions">
          <button type="button" className="tertiary-button" onClick={() => onEdit?.(effectiveNode)}>编辑</button>
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
        </div>
      ) : null}
      triggerRef={triggerRef}
      onRequestClose={onRequestClose}
      errorMessage={errorMessage}
    >
      {isEdit ? (
        <div className="universe-node-paper-body">
          <input className="universe-paper-title-editor" aria-label="星球标题" placeholder="星球标题" autoFocus value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} />
          <textarea className="universe-paper-summary-editor" aria-label="星球摘要" placeholder="摘要" value={summary} rows={2} onChange={(event) => setSummary(event.target.value)} />
          <textarea className="universe-paper-content-editor" aria-label="星球正文" placeholder="记录这颗星球的想法" value={content} rows={6} onChange={(event) => setContent(event.target.value)} />
          <UniverseNodeMetadata
            galaxies={galaxies}
            type={type as UniverseNode["type"]}
            importance={importance}
            tags={tags.split(/[,，]/).map((value) => value.trim()).filter(Boolean)}
            memberships={memberships}
            editable
            onTypeChange={(value) => setType(value)}
            onImportanceChange={setImportance}
            onTagsChange={(value) => setTags(value)}
            onMembershipsChange={(value) => { setMembershipError(null); setMemberships(value); }}
          />
          {!isCreate && connections.length ? <section className="universe-node-connections" aria-label="思想连接"><h3>Connections</h3>{connections.map(({ relation, node: relatedNode }) => <div className="universe-node-connection" key={relation.id}><button type="button" className="universe-node-connection-link" onClick={() => onOpenRelatedNode?.(relatedNode.id)}><span>{relatedNode.title}</span><small>{relationTypeLabel(relation.relationType)}</small></button>{onDeleteRelation ? <button type="button" className="universe-node-connection-overflow" aria-label="连接操作" disabled={saving} onClick={() => onDeleteRelation(relation)}>···</button> : null}</div>)}</section> : null}
          {membershipError || (canonicalMemberships === null && memberships.length > 0) ? <p className="universe-paper-inline-error" role="alert">{membershipError ?? "请填写星系权重"}</p> : null}
          {!isCreate && effectiveNode && onDelete ? <button type="button" className="danger-button" disabled={saving} onClick={() => onDelete(effectiveNode)}>移除星球</button> : null}
        </div>
      ) : (
        <div className="universe-node-paper-body">
          <h2>{effectiveNode!.title}</h2>
          {effectiveNode!.summary ? <p>{effectiveNode!.summary}</p> : null}
          {effectiveNode!.content ? <p>{effectiveNode!.content}</p> : null}
          {connections.length ? <section className="universe-node-connections" aria-label="思想连接"><h3>Connections</h3>{connections.map(({ relation, node: relatedNode }) => <div className="universe-node-connection" key={relation.id}><button type="button" className="universe-node-connection-link" onClick={() => onOpenRelatedNode?.(relatedNode.id)}><span>{relatedNode.title}</span><small>{relationTypeLabel(relation.relationType)}</small></button></div>)}</section> : null}
          <UniverseNodeMetadata galaxies={galaxies} type={effectiveNode!.type} importance={effectiveNode!.importance ?? "normal"} tags={effectiveNode!.tags} memberships={effectiveNode!.galaxies.map((membership) => ({ id: membership.id, weightText: String(membership.weight) }))} editable={false} />
        </div>
      )}
    </PaperDetailDialog>
  );
}
