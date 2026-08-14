import type { UniverseSnapshot } from "./universe-types";

type DownloadLink = {
  href: string;
  download: string;
  click(): void;
};

export type UniverseDownloadDependencies = {
  document: { createElement(tagName: "a"): DownloadLink };
  Blob: typeof Blob;
  URL: { createObjectURL(blob: Blob): string; revokeObjectURL(url: string): void };
  now?: () => Date;
};

export function createUniverseExport(snapshot: UniverseSnapshot, now = new Date()) {
  return {
    ...snapshot,
    meta: {
      ...snapshot.meta,
      exportedAt: now.toISOString(),
    },
  };
}

export function universeExportFilename(now = new Date()): string {
  return `蕾蕾宇宙备份-${now.toISOString().slice(0, 10)}.json`;
}

export function downloadUniverseJson(
  snapshot: UniverseSnapshot,
  dependencies?: UniverseDownloadDependencies,
) {
  const deps: UniverseDownloadDependencies = dependencies ?? {
    document: globalThis.document as unknown as UniverseDownloadDependencies["document"],
    Blob: globalThis.Blob,
    URL: globalThis.URL,
  };
  const now = deps.now?.() ?? new Date();
  const exported = createUniverseExport(snapshot, now);
  const blob = new deps.Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
  const url = deps.URL.createObjectURL(blob);
  const link = deps.document.createElement("a");
  link.href = url;
  link.download = universeExportFilename(now);
  link.click();
  deps.URL.revokeObjectURL(url);
  return exported;
}
