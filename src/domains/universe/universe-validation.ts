import { randomUUID } from "node:crypto";
import type {
  UniverseBackup,
  UniverseGalaxy,
  UniverseGalaxyMembership,
  UniverseMeta,
  UniverseMigration,
  UniverseNode,
  UniverseRelation,
  UniverseRelationType,
  UniverseRevision,
  UniverseRevisionSnapshot,
  UniverseSnapshot,
} from "./universe-types.js";
import { UNIVERSE_SCHEMA_VERSION } from "./universe-types.js";

export class UniverseValidationError extends Error {
  readonly code = "INVALID_UNIVERSE" as const;

  constructor(message = "Universe payload is invalid.") {
    super(message);
    this.name = "UniverseValidationError";
  }
}

const RELATION_TYPES = new Set<UniverseRelationType>([
  "related_to",
  "supports",
  "contradicts",
  "extends",
  "part_of",
  "raises",
]);

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UniverseValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, max = 100_000): string {
  if (typeof value !== "string" || value.length > max) {
    throw new UniverseValidationError(`${label} must be a string.`);
  }
  return value;
}

function nonBlankString(value: unknown, label: string, max = 512): string {
  const result = string(value, label, max);
  if (result.trim().length === 0) {
    throw new UniverseValidationError(`${label} must not be blank.`);
  }
  return result;
}

function array(value: unknown, label: string, max = 10_000): unknown[] {
  if (!Array.isArray(value) || value.length > max) {
    throw new UniverseValidationError(`${label} must be an array.`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  const result = string(value, label, 128);
  if (!result.includes("T") || !Number.isFinite(Date.parse(result))) {
    throw new UniverseValidationError(`${label} must be an ISO timestamp.`);
  }
  return result;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new UniverseValidationError(`${label} must be finite.`);
  }
  return value;
}

function stringArray(value: unknown, label: string, max = 500): string[] {
  return array(value, label, max).map((item, index) => nonBlankString(item, `${label}[${index}]`, 512));
}

function weightedMembershipArray(value: unknown, label: string, max = 500): UniverseGalaxyMembership[] {
  const memberships = array(value, label, max).map((item, index) => {
    const record = object(item, `${label}[${index}]`);
    return {
      id: nonBlankString(record.id, `${label}[${index}].id`, 256),
      weight: finiteNumber(record.weight, `${label}[${index}].weight`),
    };
  });
  assertUnique(memberships.map((membership) => membership.id), label);
  return memberships;
}

function readPosition(value: unknown): { x: number; y: number } {
  const record = object(value, "position");
  return {
    x: finiteNumber(record.x, "position.x"),
    y: finiteNumber(record.y, "position.y"),
  };
}

function readMigration(value: unknown): UniverseMigration | undefined {
  if (value === undefined) return undefined;
  const record = object(value, "migration");
  const source = record.source;
  if (source !== "mind-universe-static" && source !== "mind-universe") {
    throw new UniverseValidationError("migration.source is invalid.");
  }
  return { source, migratedAt: timestamp(record.migratedAt, "migration.migratedAt") };
}

export function validateUniverseNode(value: unknown): UniverseNode {
  const record = object(value, "node");
  const importance = record.importance === undefined
    ? undefined
    : string(record.importance, "importance", 128);
  const migration = readMigration(record.migration);
  return {
    id: nonBlankString(record.id, "node.id", 256),
    title: string(record.title, "node.title"),
    summary: string(record.summary, "node.summary"),
    content: string(record.content, "node.content"),
    type: nonBlankString(record.type, "node.type", 128),
    tags: stringArray(record.tags, "node.tags"),
    galaxies: weightedMembershipArray(record.galaxies, "node.galaxies"),
    position: readPosition(record.position),
    createdAt: timestamp(record.createdAt, "node.createdAt"),
    updatedAt: timestamp(record.updatedAt, "node.updatedAt"),
    ...(importance === undefined ? {} : { importance }),
    ...(migration === undefined ? {} : { migration }),
  };
}

export function validateUniverseRelation(value: unknown): UniverseRelation {
  const record = object(value, "relation");
  if (typeof record.relationType !== "string" || !RELATION_TYPES.has(record.relationType as UniverseRelationType)) {
    throw new UniverseValidationError("relation.relationType is invalid.");
  }
  return {
    id: nonBlankString(record.id, "relation.id", 256),
    source: nonBlankString(record.source, "relation.source", 256),
    target: nonBlankString(record.target, "relation.target", 256),
    relationType: record.relationType as UniverseRelationType,
    strength: finiteNumber(record.strength, "relation.strength"),
    createdAt: timestamp(record.createdAt, "relation.createdAt"),
  };
}

function validateGalaxy(value: unknown): UniverseGalaxy {
  const record = object(value, "galaxy");
  return {
    id: nonBlankString(record.id, "galaxy.id", 256),
    title: string(record.title, "galaxy.title"),
    description: string(record.description, "galaxy.description"),
    color: string(record.color, "galaxy.color", 128),
    order: finiteNumber(record.order, "galaxy.order"),
  };
}

function validateMeta(value: unknown): UniverseMeta {
  const record = object(value, "meta");
  return {
    name: string(record.name, "meta.name"),
    createdAt: timestamp(record.createdAt, "meta.createdAt"),
    updatedAt: timestamp(record.updatedAt, "meta.updatedAt"),
  };
}

function validateRevisionSnapshot(value: unknown): UniverseRevisionSnapshot {
  const record = object(value, "revision.snapshot");
  const importance = record.importance === undefined
    ? undefined
    : string(record.importance, "revision.snapshot.importance", 128);
  const migration = readMigration(record.migration);
  return {
    title: string(record.title, "revision.snapshot.title"),
    summary: string(record.summary, "revision.snapshot.summary"),
    content: string(record.content, "revision.snapshot.content"),
    type: nonBlankString(record.type, "revision.snapshot.type", 128),
    tags: stringArray(record.tags, "revision.snapshot.tags"),
    galaxies: weightedMembershipArray(record.galaxies, "revision.snapshot.galaxies"),
    ...(importance === undefined ? {} : { importance }),
    ...(migration === undefined ? {} : { migration }),
  };
}

function validateRevision(value: unknown): UniverseRevision {
  const record = object(value, "revision");
  return {
    id: nonBlankString(record.id, "revision.id", 256),
    nodeId: nonBlankString(record.nodeId, "revision.nodeId", 256),
    createdAt: timestamp(record.createdAt, "revision.createdAt"),
    reason: string(record.reason, "revision.reason", 1_000),
    snapshot: validateRevisionSnapshot(record.snapshot),
  };
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new UniverseValidationError(`${label} contains duplicate IDs.`);
  }
}

export function validateUniverseSnapshot(value: unknown): UniverseSnapshot {
  const record = object(value, "universe");
  if (record.schemaVersion !== UNIVERSE_SCHEMA_VERSION) {
    throw new UniverseValidationError("schemaVersion must be 2.");
  }
  if ("backups" in record) {
    throw new UniverseValidationError("canonical universe must not contain backups.");
  }
  const galaxies = array(record.galaxies, "galaxies").map(validateGalaxy);
  const nodes = array(record.nodes, "nodes").map(validateUniverseNode);
  const relations = array(record.relations, "relations").map(validateUniverseRelation);
  const revisions = array(record.revisions, "revisions").map(validateRevision);
  assertUnique(galaxies.map((item) => item.id), "galaxies");
  assertUnique(nodes.map((item) => item.id), "nodes");
  assertUnique(relations.map((item) => item.id), "relations");
  assertUnique(revisions.map((item) => item.id), "revisions");
  const galaxyIds = new Set(galaxies.map((item) => item.id));
  const nodeIds = new Set(nodes.map((item) => item.id));
  for (const node of nodes) {
    assertUnique(node.galaxies.map((membership) => membership.id), `node ${node.id} galaxies`);
    if (node.galaxies.some((membership) => !galaxyIds.has(membership.id))) {
      throw new UniverseValidationError("node references an unknown galaxy.");
    }
  }
  const relationKeys = new Set<string>();
  for (const relation of relations) {
    if (!nodeIds.has(relation.source) || !nodeIds.has(relation.target)) {
      throw new UniverseValidationError("relation references an unknown node.");
    }
    const key = `${relation.source}\u0000${relation.target}\u0000${relation.relationType}`;
    if (relationKeys.has(key)) {
      throw new UniverseValidationError("duplicate directional relation.");
    }
    relationKeys.add(key);
  }
  return {
    schemaVersion: 2,
    meta: validateMeta(record.meta),
    galaxies,
    nodes,
    relations,
    revisions,
  };
}

export function normalizeNodeCreate(value: unknown, now = new Date().toISOString()): UniverseNode {
  const record = object(value, "node");
  const candidate = {
    ...record,
    id: record.id ? record.id : `node-${randomUUID()}`,
    createdAt: record.createdAt ? record.createdAt : now,
    updatedAt: now,
  };
  return validateUniverseNode(candidate);
}

export function normalizeRelationCreate(value: unknown, now = new Date().toISOString()): UniverseRelation {
  const record = object(value, "relation");
  const candidate = {
    ...record,
    id: record.id ? record.id : `edge-${randomUUID()}`,
    createdAt: record.createdAt ? record.createdAt : now,
  };
  return validateUniverseRelation(candidate);
}

export function validateUniverseBackup(value: unknown): UniverseBackup {
  const record = object(value, "backup");
  return {
    id: nonBlankString(record.id, "backup.id", 256),
    createdAt: timestamp(record.createdAt, "backup.createdAt"),
    reason: string(record.reason, "backup.reason", 1_000),
    data: validateUniverseSnapshot(record.data),
  };
}
