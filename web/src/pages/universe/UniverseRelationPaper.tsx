import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import { PaperDetailDialog } from "../PaperDetailDialog";
import type { UniverseNode, UniverseRelationCreateInput, UniverseRelationType } from "./universe-types";
import "./universe-node-paper-web-mobile.css";

const RELATION_TYPES: Array<{ value: UniverseRelationType; label: string; standaloneLabel: string }> = [
  { value: "related_to", label: "相关", standaloneLabel: "彼此相关" },
  { value: "supports", label: "支持", standaloneLabel: "支持" },
  { value: "contradicts", label: "矛盾", standaloneLabel: "彼此矛盾" },
  { value: "extends", label: "延伸", standaloneLabel: "延伸" },
  { value: "part_of", label: "属于", standaloneLabel: "属于" },
  { value: "raises", label: "引出", standaloneLabel: "引出" },
];

export function UniverseRelationPaper({
  source,
  nodes,
  open,
  saving,
  errorMessage,
  triggerRef,
  onRequestClose,
  onSave,
}: {
  source: UniverseNode | null;
  nodes: UniverseNode[];
  open: boolean;
  saving: boolean;
  errorMessage?: string | null;
  triggerRef: RefObject<HTMLElement | null>;
  onRequestClose(): boolean | Promise<boolean>;
  onSave(relation: UniverseRelationCreateInput): Promise<void>;
}) {
  const [relationType, setRelationType] = useState<UniverseRelationType>("related_to");
  const [strength, setStrength] = useState(0.7);
  const [selectedTargetId, setSelectedTargetId] = useState("");

  useEffect(() => {
    setSelectedTargetId("");
  }, [open, source?.id]);

  if (!source) return null;

  const candidateTargets = nodes.filter((node) => node.id !== source.id);
  const target = candidateTargets.find((node) => node.id === selectedTargetId) ?? null;

  const targetOptions = (
    <>
      <option value="">选择另一个思想</option>
      {candidateTargets.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}
    </>
  );

  const saveSelectedRelation = () => {
    if (!target || saving) return;
    void onSave({ source: source.id, target: target.id, relationType, strength });
  };

  const desktopBody = (
    <div className="universe-relation-paper-body">
      <h2>建立思想连接</h2>
      <p>从「{source.title}」连接到另一个思想。</p>
      <label>连接到<select value={selectedTargetId} onChange={(event) => setSelectedTargetId(event.target.value)}>{targetOptions}</select></label>
      <label>关系<select value={relationType} onChange={(event) => setRelationType(event.target.value as UniverseRelationType)}>{RELATION_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label>强度<input type="range" min="0" max="1" step="0.1" value={strength} onChange={(event) => setStrength(Number(event.target.value))} /><span>{Math.round(strength * 100)}%</span></label>
      <button className="secondary-button" type="button" disabled={saving || !target} onClick={saveSelectedRelation}>{saving ? "保存中…" : "建立连接"}</button>
    </div>
  );

  const strengthStyle = { "--strength-progress": `${Math.round(strength * 100)}%` } as CSSProperties;

  const mobileStandaloneBody = (
    <section className="universe-standalone-connection" aria-label="建立思想连接">
      <header className="universe-standalone-connection-heading">
        <p className="universe-standalone-connection-context">当前思想 · {source.title}</p>
        <h2>让两个思想相遇</h2>
      </header>

      <div className="universe-standalone-connection-body">
        <div className="universe-standalone-form-field">
          <label htmlFor="universe-standalone-relation-target">连接到</label>
          <select
            id="universe-standalone-relation-target"
            className={selectedTargetId ? undefined : "is-empty"}
            aria-label="连接到"
            value={selectedTargetId}
            onChange={(event) => setSelectedTargetId(event.target.value)}
          >
            {targetOptions}
          </select>
        </div>

        <div className="universe-standalone-form-field">
          <label htmlFor="universe-standalone-relation-type">它们如何彼此影响？</label>
          <select id="universe-standalone-relation-type" value={relationType} onChange={(event) => setRelationType(event.target.value as UniverseRelationType)}>
            {RELATION_TYPES.map((option) => <option key={option.value} value={option.value}>{option.standaloneLabel}</option>)}
          </select>
        </div>

        <div className="universe-standalone-strength">
          <div className="universe-standalone-strength-label"><span>连接强度</span><strong>{Math.round(strength * 100)}%</strong></div>
          <input
            aria-label="连接强度"
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={strength}
            style={strengthStyle}
            onChange={(event) => setStrength(Number(event.target.value))}
          />
        </div>

        {errorMessage ? <p className="universe-standalone-error" role="alert">{errorMessage}</p> : null}
      </div>

      <footer className="universe-standalone-connection-footer">
        <button className="universe-standalone-cancel" type="button" onClick={() => { void onRequestClose(); }}>取消</button>
        <button className="universe-standalone-primary" type="button" disabled={saving || !target} onClick={saveSelectedRelation}>{saving ? "保存中…" : "建立连接"}</button>
      </footer>
    </section>
  );

  return (
    <PaperDetailDialog
      id="universe-relation-paper"
      open={open}
      label="建立思想连接"
      dateLabel="NEW CONNECTION"
      signature="Universe"
      triggerRef={triggerRef}
      onRequestClose={onRequestClose}
      errorMessage={errorMessage}
    >
      <div className="universe-relation-paper-desktop">{desktopBody}</div>
      <div className="universe-relation-original-web-mobile">{mobileStandaloneBody}</div>
    </PaperDetailDialog>
  );
}