import { useState, type RefObject } from "react";
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
  target,
  open,
  saving,
  errorMessage,
  triggerRef,
  onRequestClose,
  onSave,
}: {
  source: UniverseNode | null;
  target: UniverseNode | null;
  open: boolean;
  saving: boolean;
  errorMessage?: string | null;
  triggerRef: RefObject<HTMLElement | null>;
  onRequestClose(): boolean | Promise<boolean>;
  onSave(relation: UniverseRelationCreateInput): Promise<void>;
}) {
  const [relationType, setRelationType] = useState<UniverseRelationType>("related_to");
  const [strength, setStrength] = useState(0.7);
  if (!source || !target) return null;

  const desktopBody = (
    <div className="universe-relation-paper-body">
      <h2>建立思想连接</h2>
      <p>从「{source.title}」连接到「{target.title}」。</p>
      <label>关系<select value={relationType} onChange={(event) => setRelationType(event.target.value as UniverseRelationType)}>{RELATION_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label>强度<input type="range" min="0.1" max="1" step="0.1" value={strength} onChange={(event) => setStrength(Number(event.target.value))} /><span>{Math.round(strength * 100)}%</span></label>
      <button className="secondary-button" type="button" disabled={saving} onClick={() => void onSave({ source: source.id, target: target.id, relationType, strength })}>{saving ? "保存中…" : "建立连接"}</button>
    </div>
  );

  const mobileStandaloneBody = (
    <section className="universe-standalone-connection" aria-label="建立思想连接">
      <header className="universe-standalone-connection-header">
        <div>
          <div className="universe-standalone-eyebrow"><i aria-hidden="true" /><span>CREATE CONNECTION</span></div>
          <h2>让两个思想相遇</h2>
        </div>
        <button className="universe-standalone-close" type="button" aria-label="关闭" onClick={() => { void onRequestClose(); }}>×</button>
      </header>
      <p className="universe-standalone-connection-intro">从当前星球出发，选择它与另一个节点之间的关系。</p>

      <div className="universe-standalone-form-field">
        <label>连接到</label>
        <div className="universe-standalone-readonly-select" aria-label={`连接到 ${target.title}`}>{target.title}<span aria-hidden="true">⌄</span></div>
      </div>

      <div className="universe-standalone-form-field">
        <label htmlFor="universe-standalone-relation-type">它们如何彼此影响?</label>
        <select id="universe-standalone-relation-type" value={relationType} onChange={(event) => setRelationType(event.target.value as UniverseRelationType)}>
          {RELATION_TYPES.map((option) => <option key={option.value} value={option.value}>{option.standaloneLabel}</option>)}
        </select>
      </div>

      <div className="universe-standalone-strength">
        <div className="universe-standalone-strength-label"><span>连接强度</span><strong>{Math.round(strength * 100)}%</strong></div>
        <input aria-label="连接强度" type="range" min="0.1" max="1" step="0.1" value={strength} onChange={(event) => setStrength(Number(event.target.value))} />
      </div>

      {errorMessage ? <p className="universe-standalone-error" role="alert">{errorMessage}</p> : null}
      <footer className="universe-standalone-connection-footer">
        <button className="universe-standalone-cancel" type="button" onClick={() => { void onRequestClose(); }}>取消</button>
        <button className="universe-standalone-primary" type="button" disabled={saving} onClick={() => void onSave({ source: source.id, target: target.id, relationType, strength })}>{saving ? "保存中…" : "建立连接"}</button>
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
