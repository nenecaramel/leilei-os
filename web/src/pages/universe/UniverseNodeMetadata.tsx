import { useMemo, useState } from "react";
import type { UniverseGalaxy, UniverseGalaxyMembership, UniverseNode } from "./universe-types";

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

export type UniverseNodeMetadataProps = {
  galaxies: readonly UniverseGalaxy[];
  type: UniverseNode["type"];
  importance: string;
  tags: string[];
  memberships: MembershipDraft[];
  editable: boolean;
  onTypeChange?(value: UniverseNode["type"]): void;
  onImportanceChange?(value: string): void;
  onTagsChange?(value: string): void;
  onMembershipsChange?(value: MembershipDraft[]): void;
};

export function UniverseNodeMetadata({
  galaxies,
  type,
  importance,
  tags,
  memberships,
  editable,
  onTypeChange,
  onImportanceChange,
  onTagsChange,
  onMembershipsChange,
}: UniverseNodeMetadataProps) {
  const [openMenu, setOpenMenu] = useState<"type" | "importance" | "galaxy" | null>(null);
  const available = useMemo(() => galaxies.filter((galaxy) => !memberships.some((membership) => membership.id === galaxy.id)), [galaxies, memberships]);
  const names = new Map(galaxies.map((galaxy) => [galaxy.id, galaxy.title]));
  const membershipText = memberships.map((membership) => `${names.get(membership.id) ?? membership.id} ${membership.weightText}`).join(" · ");
  if (!editable) {
    return (
      <div className="universe-node-metadata" aria-label="星球元数据">
        <span>{type} · {importance}{tags.length ? ` · ${tags.map((tag) => `#${tag}`).join(" ")}` : ""}</span>
        <span>{memberships.length ? `星系  ${membershipText}` : "星系"}</span>
      </div>
    );
  }
  const choose = (kind: "type" | "importance" | "galaxy") => setOpenMenu((current) => current === kind ? null : kind);
  return (
    <div className="universe-node-metadata universe-node-metadata-edit" aria-label="编辑星球元数据">
      <div className="universe-metadata-row">
        <span className="universe-metadata-popover-anchor">
          <button type="button" className="universe-metadata-trigger" onClick={() => choose("type")}>{type}</button>
          {openMenu === "type" ? <span className="universe-metadata-popover" role="menu">{["concept", "question", "claim", "experience", "project", "source", "reflection"].map((value) => <button type="button" key={value} onClick={() => { onTypeChange?.(value as UniverseNode["type"]); setOpenMenu(null); }}>{value}</button>)}</span> : null}
        </span>
        <span>·</span>
        <span className="universe-metadata-popover-anchor">
          <button type="button" className="universe-metadata-trigger" onClick={() => choose("importance")}>{importance}</button>
          {openMenu === "importance" ? <span className="universe-metadata-popover" role="menu">{["anchor", "major", "normal"].map((value) => <button type="button" key={value} onClick={() => { onImportanceChange?.(value); setOpenMenu(null); }}>{value}</button>)}</span> : null}
        </span>
        <span>·</span>
        <input aria-label="标签" className="universe-metadata-tags" value={tags.join(", ")} onChange={(event) => onTagsChange?.(event.target.value)} placeholder="#标签" />
      </div>
      <div className="universe-metadata-memberships">
        <span>星系</span>
        {memberships.map((membership) => (
          <span className="universe-membership-editor" key={membership.id}>
            <span>{names.get(membership.id) ?? membership.id}</span>
            <input
              aria-label={`${names.get(membership.id) ?? membership.id} 权重`}
              className="universe-metadata-weight"
              inputMode="decimal"
              value={membership.weightText}
              onInput={(event) => onMembershipsChange?.(memberships.map((item) => item.id === membership.id ? { ...item, weightText: event.currentTarget.value } : item))}
              onChange={(event) => onMembershipsChange?.(memberships.map((item) => item.id === membership.id ? { ...item, weightText: event.target.value } : item))}
            />
            <button type="button" className="universe-metadata-remove" onClick={() => onMembershipsChange?.(memberships.filter((item) => item.id !== membership.id))}>移出</button>
          </span>
        ))}
        <span className="universe-metadata-popover-anchor">
          <button type="button" className="universe-metadata-add" onClick={() => choose("galaxy")}>＋</button>
          {openMenu === "galaxy" ? <span className="universe-metadata-popover" role="menu">{available.map((galaxy) => <button type="button" key={galaxy.id} onClick={() => { onMembershipsChange?.([...memberships, { id: galaxy.id, weightText: "" }]); setOpenMenu(null); }}>{galaxy.title}</button>)}</span> : null}</span>
      </div>
    </div>
  );
}
