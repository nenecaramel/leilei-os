import { useState, type RefObject } from "react";
import { PaperDetailDialog } from "../PaperDetailDialog";
import type { UniverseNode, UniverseRelationCreateInput, UniverseRelationType } from "./universe-types";

const RELATION_TYPES: Array<{ value: UniverseRelationType; label: string }> = [
  { value: "related_to", label: "相关" },
  { value: "supports", label: "支持" },
  { value: "contradicts", label: "矛盾" },
  { value: "extends", label: "延伸" },
  { value: "part_of", label: "属于" },
  { value: "raises", label: "引出" },
];

export function UniverseRelationPaper({
  source,
  target,
  open,
  saving,
  triggerRef,
  onRequestClose,
  onSave,
}: {
  source: UniverseNode | null;
  target: UniverseNode | null;
  open: boolean;
  saving: boolean;
  triggerRef: RefObject<HTMLElement | null>;
  onRequestClose(): boolean | Promise<boolean>;
  onSave(relation: UniverseRelationCreateInput): Promise<void>;
}) {
  const [relationType, setRelationType] = useState<UniverseRelationType>("related_to");
  const [strength, setStrength] = useState(0.7);
  if (!source || !target) return null;
  return (
    <PaperDetailDialog
      id="universe-relation-paper"
      open={open}
      label="建立思想连接"
      dateLabel="NEW CONNECTION"
      signature="Universe"
      triggerRef={triggerRef}
      onRequestClose={onRequestClose}
    >
      <div className="universe-relation-paper-body">
        <h2>建立思想连接</h2>
        <p>从「{source.title}」连接到「{target.title}」。</p>
        <label>关系<select value={relationType} onChange={(event) => setRelationType(event.target.value as UniverseRelationType)}>{RELATION_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label>强度<input type="range" min="0.1" max="1" step="0.1" value={strength} onChange={(event) => setStrength(Number(event.target.value))} /><span>{Math.round(strength * 100)}%</span></label>
        <button className="secondary-button" type="button" disabled={saving} onClick={() => void onSave({ source: source.id, target: target.id, relationType, strength })}>{saving ? "保存中…" : "建立连接"}</button>
      </div>
    </PaperDetailDialog>
  );
}
