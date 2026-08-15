export const UNIVERSE_SCHEMA_VERSION = 2 as const;

export type UniversePosition = { x: number; y: number };

export type UniverseGalaxyMembership = {
  id: string;
  weight: number;
};

export type UniverseMigration = {
  source: "mind-universe-static" | "mind-universe";
  migratedAt: string;
};

export type UniverseNode = {
  id: string;
  title: string;
  summary: string;
  content: string;
  type: string;
  tags: string[];
  galaxies: UniverseGalaxyMembership[];
  position: UniversePosition;
  createdAt: string;
  updatedAt: string;
  importance?: string;
  migration?: UniverseMigration;
};

export type UniverseRelationType =
  | "related_to"
  | "supports"
  | "contradicts"
  | "extends"
  | "part_of"
  | "raises";

export type UniverseRelation = {
  id: string;
  source: string;
  target: string;
  relationType: UniverseRelationType;
  strength: number;
  createdAt: string;
};

export type UniverseGalaxy = {
  id: string;
  title: string;
  description: string;
  color: string;
  order: number;
};

export type UniverseMeta = {
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type UniverseRevisionSnapshot = Pick<
  UniverseNode,
  "title" | "summary" | "content" | "type" | "tags" | "galaxies"
>;

export type UniverseRevision = {
  id: string;
  nodeId: string;
  createdAt: string;
  reason: string;
  snapshot: UniverseRevisionSnapshot;
};

export type UniverseSnapshot = {
  schemaVersion: typeof UNIVERSE_SCHEMA_VERSION;
  meta: UniverseMeta;
  galaxies: UniverseGalaxy[];
  nodes: UniverseNode[];
  relations: UniverseRelation[];
  revisions: UniverseRevision[];
};

export type UniverseBackup = {
  id: string;
  createdAt: string;
  reason: string;
  data: UniverseSnapshot;
};
