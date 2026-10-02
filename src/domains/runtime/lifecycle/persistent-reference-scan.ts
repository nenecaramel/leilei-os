export type PersistentReferenceState = {
  id: string;
  payload?: Record<string, unknown> | null;
  envelope: Record<string, unknown>;
  scopePathHeadMessageId?: string | null;
};

export function structuredValueReferencesAnyId(
  value: unknown,
  ids: ReadonlySet<string>,
): boolean {
  if (typeof value === "string") return ids.has(value);
  if (Array.isArray(value)) {
    return value.some((item) => structuredValueReferencesAnyId(item, ids));
  }
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, item]) =>
      ids.has(key)
      || structuredValueReferencesAnyId(item, ids),
  );
}

export function expandCausalStateReferences(input: {
  states: readonly PersistentReferenceState[];
  rootIds: ReadonlySet<string>;
  initiallySelectedStateIds?: ReadonlySet<string>;
  includePayload?: boolean;
}): Set<string> {
  const selected = new Set(input.initiallySelectedStateIds ?? []);
  let changed = true;

  while (changed) {
    changed = false;
    const references = new Set<string>([
      ...input.rootIds,
      ...selected,
    ]);

    for (const state of input.states) {
      if (selected.has(state.id)) continue;
      if (
        (
          state.scopePathHeadMessageId
          && references.has(state.scopePathHeadMessageId)
        )
        || structuredValueReferencesAnyId(state.envelope, references)
        || (
          input.includePayload !== false
          && structuredValueReferencesAnyId(state.payload, references)
        )
      ) {
        selected.add(state.id);
        changed = true;
      }
    }
  }

  return selected;
}
