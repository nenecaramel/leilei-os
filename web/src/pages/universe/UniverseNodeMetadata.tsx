import { useEffect, useMemo, useRef, useState } from "react";
import type { UniverseGalaxy, UniverseGalaxyMembership, UniverseNode } from "./universe-types";
import { UniverseFloatingPopover } from "./UniverseFloatingPopover";

export type MembershipDraft = { id: string; weightText: string };

export function toCanonicalMemberships(drafts: readonly MembershipDraft[]): UniverseGalaxyMembership[] | null {
  const ids = new Set<string>();
  const result: UniverseGalaxyMembership[] = [];
  for (const draft of drafts) {
    if (ids.has(draft.id)) return null;
    ids.add(draft.id);
    if (draft.weightText.trim() === "") return null;
    const weight = Number(draft.weightText);
    if (!Number.isFinite(weight)) return null;
    result.push({ id: draft.id, weight });
  }
  return result;
}

export function parseUniverseTags(value: string): string[] {
  return value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
}

export type UniverseNodeMetadataProps = {
  galaxies: readonly UniverseGalaxy[];
  type: UniverseNode["type"];
  importance: string;
  tags: string[];
  tagsValue?: string;
  memberships: MembershipDraft[];
  editable: boolean;
  onTypeChange?(value: UniverseNode["type"]): void;
  onImportanceChange?(value: string): void;
  onTagsChange?(value: string): void;
  onMembershipsChange?(value: MembershipDraft[]): void;
};

const nodeTypes: UniverseNode["type"][] = ["concept", "question", "claim", "experience", "project", "source", "reflection"];
const importanceOptions = ["anchor", "major", "normal"];

export function UniverseNodeMetadata({
  galaxies,
  type,
  importance,
  tags,
  tagsValue,
  memberships,
  editable,
  onTypeChange,
  onImportanceChange,
  onTagsChange,
  onMembershipsChange,
}: UniverseNodeMetadataProps) {
  const [openMenu, setOpenMenu] = useState<"type" | "importance" | "galaxy" | null>(null);
  const [editingMembershipId, setEditingMembershipId] = useState<string | null>(null);
  const typeAnchorRef = useRef<HTMLButtonElement | null>(null);
  const importanceAnchorRef = useRef<HTMLButtonElement | null>(null);
  const galaxyAnchorRef = useRef<HTMLButtonElement | null>(null);
  const membershipAnchorRef = useRef<HTMLButtonElement | null>(null);
  const membershipInputRef = useRef<HTMLInputElement | null>(null);
  const available = useMemo(() => galaxies.filter((galaxy) => !memberships.some((membership) => membership.id === galaxy.id)), [galaxies, memberships]);
  const names = useMemo(() => new Map(galaxies.map((galaxy) => [galaxy.id, galaxy.title])), [galaxies]);

  useEffect(() => {
    if (!editingMembershipId) return;
    membershipInputRef.current?.focus({ preventScroll: true });
  }, [editingMembershipId]);

  if (!editable) {
    return (
      <div className="universe-node-metadata" aria-label="星球元数据">
        <span>{type} · {importance}{tags.length ? ` · ${tags.map((tag) => `#${tag}`).join(" ")}` : ""}</span>
        <span>{memberships.length ? `星系  ${memberships.map((membership) => `${names.get(membership.id) ?? membership.id} ${membership.weightText}`).join(" · ")}` : "星系"}</span>
      </div>
    );
  }

  const choose = (kind: "type" | "importance" | "galaxy") => {
    setEditingMembershipId(null);
    setOpenMenu((current) => current === kind ? null : kind);
  };
  const updateMembership = (id: string, weightText: string) => {
    onMembershipsChange?.(memberships.map((membership) => membership.id === id ? { ...membership, weightText } : membership));
  };

  return (
    <div className="universe-node-metadata universe-node-metadata-edit" aria-label="编辑星球元数据">
      <div className="universe-metadata-row">
        <span className="universe-metadata-popover-anchor">
          <button ref={typeAnchorRef} type="button" className="universe-metadata-trigger" onClick={() => choose("type")}>{type}</button>
          <UniverseFloatingPopover open={openMenu === "type"} anchorRef={typeAnchorRef} className="universe-metadata-popover" ariaLabel="选择星球类型" onRequestClose={() => setOpenMenu(null)}>
            {nodeTypes.map((value) => <button type="button" key={value} onClick={() => { onTypeChange?.(value); setOpenMenu(null); }}>{value}</button>)}
          </UniverseFloatingPopover>
        </span>
        <span>·</span>
        <span className="universe-metadata-popover-anchor">
          <button ref={importanceAnchorRef} type="button" className="universe-metadata-trigger" onClick={() => choose("importance")}>{importance}</button>
          <UniverseFloatingPopover open={openMenu === "importance"} anchorRef={importanceAnchorRef} className="universe-metadata-popover" ariaLabel="选择重要性" onRequestClose={() => setOpenMenu(null)}>
            {importanceOptions.map((value) => <button type="button" key={value} onClick={() => { onImportanceChange?.(value); setOpenMenu(null); }}>{value}</button>)}
          </UniverseFloatingPopover>
        </span>
        <span>·</span>
        <input aria-label="标签" className="universe-metadata-tags" value={tagsValue ?? tags.join(", ")} onInput={(event) => onTagsChange?.(event.currentTarget.value)} onChange={(event) => onTagsChange?.(event.target.value)} placeholder="#标签" />
      </div>
      <div className="universe-metadata-memberships">
        <span>星系</span>
        {memberships.map((membership) => {
          const name = names.get(membership.id) ?? membership.id;
          const editing = editingMembershipId === membership.id;
          return (
            <span className="universe-membership-editor" key={membership.id}>
              <button
                ref={(element) => { if (editing) membershipAnchorRef.current = element; }}
                type="button"
                className="universe-membership-trigger"
                onClick={(event) => { membershipAnchorRef.current = event.currentTarget; setOpenMenu(null); setEditingMembershipId((current) => current === membership.id ? null : membership.id); }}
              >
                {name}{membership.weightText.trim() ? ` ${membership.weightText}` : ""}
              </button>
              {editing ? (
                <UniverseFloatingPopover open anchorRef={membershipAnchorRef} className="universe-membership-editor-popover" ariaLabel={`${name} 权重编辑`} onRequestClose={() => setEditingMembershipId(null)}>
                  <input
                    ref={membershipInputRef}
                    aria-label={`${name} 权重`}
                    className="universe-metadata-weight"
                    inputMode="decimal"
                    value={membership.weightText}
                    onInput={(event) => updateMembership(membership.id, event.currentTarget.value)}
                    onChange={(event) => updateMembership(membership.id, event.target.value)}
                  />
                  <button type="button" className="universe-metadata-remove" onClick={() => { onMembershipsChange?.(memberships.filter((item) => item.id !== membership.id)); setEditingMembershipId(null); }}>移出星系</button>
                </UniverseFloatingPopover>
              ) : null}
            </span>
          );
        })}
        <span className="universe-metadata-popover-anchor">
          <button ref={galaxyAnchorRef} type="button" className="universe-metadata-add" aria-label="添加星系" onClick={() => choose("galaxy")}>＋</button>
          <UniverseFloatingPopover open={openMenu === "galaxy"} anchorRef={galaxyAnchorRef} className="universe-metadata-popover" ariaLabel="添加星系" onRequestClose={() => setOpenMenu(null)}>
            {available.length ? available.map((galaxy) => <button type="button" key={galaxy.id} onClick={() => { onMembershipsChange?.([...memberships, { id: galaxy.id, weightText: "" }]); setOpenMenu(null); setEditingMembershipId(galaxy.id); }}><span className="universe-galaxy-entry-dot" style={{ background: galaxy.color }} aria-hidden="true" />{galaxy.title}</button>) : <span>没有可加入的星系</span>}
          </UniverseFloatingPopover>
        </span>
      </div>
    </div>
  );
}
