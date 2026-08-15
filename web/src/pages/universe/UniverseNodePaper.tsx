import { useEffect, useRef, useState, type RefObject } from "react";
import { PaperDetailDialog } from "../PaperDetailDialog";
import type { UniverseGalaxy, UniverseNode, UniverseRelation } from "./universe-types";
import type { UniversePoint } from "./universe-map-transform";

export type UniverseNodePaperMode =
  | { kind: "detail"; nodeId: string }
  | { kind: "edit"; nodeId: string }
  | { kind: "create"; position: UniversePoint };

export type UniverseNodePaperDraft = Pick<UniverseNode, "title" | "summary" | "content" | "type" | "tags" | "galaxies"> & { importance: string };

const NODE_TYPES = ["concept", "question", "claim", "experience", "project", "source", "reflection"] as const;
const IMPORTANCE_OPTIONS = ["anchor", "major", "normal"] as const;

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
  const [membershipIds, setMembershipIds] = useState<string[]>(() => (effectiveNode?.galaxies ?? []).map((membership) => membership.id));
  const [membershipWeights, setMembershipWeights] = useState<Record<string, string>>(() => Object.fromEntries((effectiveNode?.galaxies ?? []).map((membership) => [membership.id, String(membership.weight)])));
  const [membershipError, setMembershipError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(effectiveNode?.title ?? "");
    setSummary(effectiveNode?.summary ?? "");
    setContent(effectiveNode?.content ?? "");
    setType(effectiveNode?.type ?? "concept");
    setImportance(effectiveNode?.importance ?? "normal");
    setTags((effectiveNode?.tags ?? []).join(", "));
    const nextMemberships = effectiveNode?.galaxies ?? [];
    setMembershipIds(nextMemberships.map((membership) => membership.id));
    setMembershipWeights(Object.fromEntries(nextMemberships.map((membership) => [membership.id, String(membership.weight)])));
    setMembershipError(null);
  }, [effectiveNode, mode?.kind]);

  if (!effectiveNode && !isCreate) return null;
  const id = isCreate ? "universe-node-create-paper" : `universe-node-paper-${effectiveNode!.id}`;
  const label = isCreate ? "点亮一颗新星" : isEdit ? "调整星球" : "Universe 节点";

  const toggleMembership = (galaxyId: string) => {
    setMembershipError(null);
    setMembershipIds((current) => current.includes(galaxyId)
      ? current.filter((id) => id !== galaxyId)
      : [...current, galaxyId]);
  };

  const buildMemberships = () => {
    const next = membershipIds.map((id) => ({ id, weight: Number(membershipWeights[id]) }));
    if (next.some((membership) => !Number.isFinite(membership.weight))) {
      setMembershipError("请为每个星系成员填写权重。");
      return null;
    }
    return next;
  };

  return (
    <PaperDetailDialog
      id={id}
      open={open}
      label={label}
      dateLabel={isCreate ? "NEW STAR" : effectiveNode!.createdAt}
      signature="Universe"
      triggerRef={triggerRef}
      onRequestClose={onRequestClose}
      errorMessage={errorMessage}
    >
      {isEdit ? (
        <div className="universe-node-paper-body">
          <h2>{isCreate ? "点亮一颗新星" : "调整这颗星球"}</h2>
          <label>标题<input autoFocus value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>摘要<textarea value={summary} rows={2} onChange={(event) => setSummary(event.target.value)} /></label>
          <label>正文<textarea value={content} rows={6} onChange={(event) => setContent(event.target.value)} /></label>
          <label>类型<select value={type} onChange={(event) => setType(event.target.value)}>{NODE_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
          <label>重要性<select value={importance} onChange={(event) => setImportance(event.target.value)}>{IMPORTANCE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
          <label>标签<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="逗号分隔" /></label>
          {galaxies.length ? <fieldset><legend>星系成员与权重</legend>{galaxies.map((galaxy) => {
            const selected = membershipIds.includes(galaxy.id);
            const updateWeight = (value: string) => setMembershipWeights((current) => ({ ...current, [galaxy.id]: value }));
            return <label className="universe-galaxy-choice" key={galaxy.id}><input type="checkbox" checked={selected} onChange={() => toggleMembership(galaxy.id)} />{galaxy.title}{selected ? <input aria-label={`${galaxy.title} 权重`} type="number" step="any" value={membershipWeights[galaxy.id] ?? ""} onInput={(event) => updateWeight(event.currentTarget.value)} onChange={(event) => updateWeight(event.target.value)} /> : null}</label>;
          })}</fieldset> : null}
          {membershipError ? <p className="universe-paper-inline-error" role="alert">{membershipError}</p> : null}
          <button type="button" className="secondary-button" disabled={saving || !title.trim()} onClick={() => {
            const nextMemberships = buildMemberships();
            if (!nextMemberships) return;
            void onSave({ title: title.trim(), summary: summary.trim(), content: content.trim(), type, importance, tags: tags.split(/[,，]/).map((value) => value.trim()).filter(Boolean), galaxies: nextMemberships });
          }}>{saving ? "保存中…" : "保存"}</button>
          {!isCreate && effectiveNode && onDelete ? <button type="button" className="danger-button" disabled={saving} onClick={() => onDelete(effectiveNode)}>移除星球</button> : null}
        </div>
      ) : (
        <div className="universe-node-paper-body">
          <h2>{effectiveNode!.title}</h2>
          {effectiveNode!.summary ? <p>{effectiveNode!.summary}</p> : null}
          {effectiveNode!.content ? <p>{effectiveNode!.content}</p> : null}
          <dl>
            <dt>类型</dt><dd>{effectiveNode!.type}</dd>
            <dt>重要性</dt><dd>{effectiveNode!.importance ?? "normal"}</dd>
            <dt>标签</dt><dd>{effectiveNode!.tags.join("、") || "无"}</dd>
            <dt>星系</dt><dd>{effectiveNode!.galaxies.map((membership) => `${membership.id} (${membership.weight})`).join("、") || "无"}</dd>
          </dl>
          <div className="universe-node-paper-actions">
            <button type="button" className="secondary-button" onClick={() => onCreateRelation?.(effectiveNode!)}>建立连接</button>
            <button type="button" className="secondary-button" onClick={() => onRestore?.(effectiveNode!)} disabled={!revisionsAvailable || saving}>恢复上一版本</button>
            <button type="button" className="tertiary-button" onClick={() => onEdit?.(effectiveNode!)}>编辑</button>
          </div>
          {connections.length ? <section className="universe-node-connections" aria-label="思想连接"><h3>Connections</h3>{connections.map(({ relation, node: relatedNode }) => <div className="universe-node-connection" key={relation.id}><button type="button" className="tertiary-button" onClick={() => onOpenRelatedNode?.(relatedNode.id)}>{relation.relationType} · {relatedNode.title}</button><button type="button" className="tertiary-button" disabled={saving} onClick={() => onDeleteRelation?.(relation)}>移除连接</button></div>)}</section> : null}
        </div>
      )}
    </PaperDetailDialog>
  );
}
