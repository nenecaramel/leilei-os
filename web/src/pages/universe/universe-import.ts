import type {
  UniverseGalaxy,
  UniverseGalaxyMembership,
  UniverseNode,
  UniverseRelation,
  UniverseRelationType,
  UniverseRevision,
  UniverseRevisionSnapshot,
  UniverseSnapshot,
} from "./universe-types";

export class UniverseImportValidationError extends Error {
  readonly code = "INVALID_UNIVERSE_IMPORT" as const;

  constructor(message = "Universe import payload is invalid.") {
    super(message);
    this.name = "UniverseImportValidationError";
  }
}

export type UniverseImportPreview = {
  snapshot: UniverseSnapshot;
  counts: {
    galaxies: number;
    nodes: number;
    relations: number;
    revisions: number;
  };
  conversions: string[];
};

const RELATION_TYPES = new Set<UniverseRelationType>([
  "related_to",
  "supports",
  "contradicts",
  "extends",
  "part_of",
  "raises",
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UniverseImportValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, label: string, max = 10_000): unknown[] {
  if (!Array.isArray(value) || value.length > max) {
    throw new UniverseImportValidationError(`${label} must be an array.`);
  }
  return value;
}

function text(value: unknown, label: string, max = 100_000): string {
  if (typeof value !== "string" || value.length > max) {
    throw new UniverseImportValidationError(`${label} must be a string.`);
  }
  return value;
}

function nonBlank(value: unknown, label: string, max = 512): string {
  const result = text(value, label, max);
  if (result.trim().length === 0) {
    throw new UniverseImportValidationError(`${label} must not be blank.`);
  }
  return result;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new UniverseImportValidationError(`${label} must be finite.`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  const result = text(value, label, 128);
  if (!result.includes("T") || !Number.isFinite(Date.parse(result))) {
    throw new UniverseImportValidationError(`${label} must be an ISO timestamp.`);
  }
  return result;
}

function strings(value: unknown, label: string, max = 500): string[] {
  return list(value, label, max).map((item, index) => nonBlank(item, `${label}[${index}]`, 512));
}

function memberships(value: unknown, label: string): UniverseGalaxyMembership[] {
  const result = list(value, label, 500).map((item, index) => {
    const entry = record(item, `${label}[${index}]`);
    return {
      id: nonBlank(entry.id, `${label}[${index}].id`, 256),
      weight: finite(entry.weight, `${label}[${index}].weight`),
    };
  });
  unique(result.map((item) => item.id), label);
  return result;
}

function position(value: unknown): { x: number; y: number } {
  const entry = record(value, "node.position");
  return { x: finite(entry.x, "node.position.x"), y: finite(entry.y, "node.position.y") };
}

function migration(value: unknown): UniverseNode["migration"] {
  if (value === undefined) return undefined;
  const entry = record(value, "node.migration");
  if (entry.source !== "mind-universe-static" && entry.source !== "mind-universe") {
    throw new UniverseImportValidationError("node.migration.source is invalid.");
  }
  return {
    source: entry.source,
    migratedAt: timestamp(entry.migratedAt, "node.migration.migratedAt"),
  };
}

function node(value: unknown): UniverseNode {
  const entry = record(value, "node");
  const importance = entry.importance === undefined ? undefined : text(entry.importance, "node.importance", 128);
  const nodeMigration = migration(entry.migration);
  return {
    id: nonBlank(entry.id, "node.id", 256),
    title: text(entry.title, "node.title"),
    summary: text(entry.summary, "node.summary"),
    content: text(entry.content, "node.content"),
    type: nonBlank(entry.type, "node.type", 128),
    tags: strings(entry.tags, "node.tags"),
    galaxies: memberships(entry.galaxies, "node.galaxies"),
    position: position(entry.position),
    createdAt: timestamp(entry.createdAt, "node.createdAt"),
    updatedAt: timestamp(entry.updatedAt, "node.updatedAt"),
    ...(importance === undefined ? {} : { importance }),
    ...(nodeMigration === undefined ? {} : { migration: nodeMigration }),
  };
}

function relation(value: unknown): UniverseRelation {
  const entry = record(value, "relation");
  if (typeof entry.relationType !== "string" || !RELATION_TYPES.has(entry.relationType as UniverseRelationType)) {
    throw new UniverseImportValidationError("relation.relationType is invalid.");
  }
  return {
    id: nonBlank(entry.id, "relation.id", 256),
    source: nonBlank(entry.source, "relation.source", 256),
    target: nonBlank(entry.target, "relation.target", 256),
    relationType: entry.relationType as UniverseRelationType,
    strength: finite(entry.strength, "relation.strength"),
    createdAt: timestamp(entry.createdAt, "relation.createdAt"),
  };
}

function revisionSnapshot(value: unknown): UniverseRevisionSnapshot {
  const entry = record(value, "revision.snapshot");
  const importance = entry.importance === undefined ? undefined : text(entry.importance, "revision.snapshot.importance", 128);
  const nodeMigration = migration(entry.migration);
  return {
    title: text(entry.title, "revision.snapshot.title"),
    summary: text(entry.summary, "revision.snapshot.summary"),
    content: text(entry.content, "revision.snapshot.content"),
    type: nonBlank(entry.type, "revision.snapshot.type", 128),
    tags: strings(entry.tags, "revision.snapshot.tags"),
    galaxies: memberships(entry.galaxies, "revision.snapshot.galaxies"),
    ...(importance === undefined ? {} : { importance }),
    ...(nodeMigration === undefined ? {} : { migration: nodeMigration }),
  };
}

function revision(value: unknown): UniverseRevision {
  const entry = record(value, "revision");
  return {
    id: nonBlank(entry.id, "revision.id", 256),
    nodeId: nonBlank(entry.nodeId, "revision.nodeId", 256),
    createdAt: timestamp(entry.createdAt, "revision.createdAt"),
    reason: text(entry.reason, "revision.reason", 1_000),
    snapshot: revisionSnapshot(entry.snapshot),
  };
}

function galaxy(value: unknown): UniverseGalaxy {
  const entry = record(value, "galaxy");
  return {
    id: nonBlank(entry.id, "galaxy.id", 256),
    title: text(entry.title, "galaxy.title"),
    description: text(entry.description, "galaxy.description"),
    color: text(entry.color, "galaxy.color", 128),
    order: finite(entry.order, "galaxy.order"),
  };
}

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new UniverseImportValidationError(`${label} contains duplicate IDs.`);
  }
}

function validateCanonical(value: unknown): UniverseSnapshot {
  const entry = record(value, "universe");
  if (entry.schemaVersion !== 2) {
    throw new UniverseImportValidationError("schemaVersion must be 2.");
  }
  if (Object.prototype.hasOwnProperty.call(entry, "backups")) {
    throw new UniverseImportValidationError("backups are not accepted by this importer.");
  }
  const meta = record(entry.meta, "meta");
  const galaxies = list(entry.galaxies, "galaxies").map(galaxy);
  const nodes = list(entry.nodes, "nodes").map(node);
  const relations = list(entry.relations, "relations").map(relation);
  const revisions = list(entry.revisions, "revisions").map(revision);
  unique(galaxies.map((item) => item.id), "galaxies");
  unique(nodes.map((item) => item.id), "nodes");
  unique(relations.map((item) => item.id), "relations");
  unique(revisions.map((item) => item.id), "revisions");
  const galaxyIds = new Set(galaxies.map((item) => item.id));
  const nodeIds = new Set(nodes.map((item) => item.id));
  for (const item of nodes) {
    if (item.galaxies.some((membership) => !galaxyIds.has(membership.id))) {
      throw new UniverseImportValidationError("node references an unknown galaxy.");
    }
  }
  for (const item of relations) {
    if (!nodeIds.has(item.source) || !nodeIds.has(item.target)) {
      throw new UniverseImportValidationError("relation references an unknown node.");
    }
  }
  const relationKeys = new Set<string>();
  for (const item of relations) {
    const key = `${item.source}\u0000${item.target}\u0000${item.relationType}`;
    if (relationKeys.has(key)) {
      throw new UniverseImportValidationError("duplicate directional relation.");
    }
    relationKeys.add(key);
  }
  for (const item of revisions) {
    if (!nodeIds.has(item.nodeId)) {
      throw new UniverseImportValidationError("revision references an unknown node.");
    }
  }
  return {
    schemaVersion: 2,
    meta: {
      name: text(meta.name, "meta.name"),
      createdAt: timestamp(meta.createdAt, "meta.createdAt"),
      updatedAt: timestamp(meta.updatedAt, "meta.updatedAt"),
    },
    galaxies,
    nodes,
    relations,
    revisions,
  };
}

export function parseStandaloneUniverseJson(textValue: string): UniverseImportPreview {
  let raw: unknown;
  try {
    raw = JSON.parse(textValue) as unknown;
  } catch {
    throw new UniverseImportValidationError("JSON could not be parsed.");
  }
  const entry = record(raw, "universe export");
  const snapshot = validateCanonical({
    schemaVersion: entry.schemaVersion,
    meta: entry.meta,
    galaxies: entry.galaxies,
    nodes: entry.nodes,
    relations: entry.edges,
    revisions: entry.revisions,
    ...(Object.prototype.hasOwnProperty.call(entry, "backups") ? { backups: entry.backups } : {}),
  });
  return {
    snapshot,
    counts: {
      galaxies: snapshot.galaxies.length,
      nodes: snapshot.nodes.length,
      relations: snapshot.relations.length,
      revisions: snapshot.revisions.length,
    },
    conversions: ["edges → relations"],
  };
}

function canonicalForComparison(snapshot: UniverseSnapshot): string {
  return JSON.stringify({
    ...snapshot,
    galaxies: [...snapshot.galaxies].sort((left, right) => left.id.localeCompare(right.id)),
    nodes: [...snapshot.nodes].sort((left, right) => left.id.localeCompare(right.id)),
    relations: [...snapshot.relations].sort((left, right) => left.id.localeCompare(right.id)),
    revisions: [...snapshot.revisions].sort((left, right) => left.id.localeCompare(right.id)),
  });
}

export function verifyUniverseImportReadback(expected: UniverseSnapshot, actual: UniverseSnapshot): void {
  try {
    const canonicalExpected = validateCanonical(expected);
    const canonicalActual = validateCanonical(actual);
    if (canonicalForComparison(canonicalExpected) !== canonicalForComparison(canonicalActual)) {
      throw new UniverseImportValidationError("Universe readback differs from the selected snapshot.");
    }
  } catch (error) {
    if (error instanceof UniverseImportValidationError) throw error;
    throw new UniverseImportValidationError("Universe readback is invalid.");
  }
}
