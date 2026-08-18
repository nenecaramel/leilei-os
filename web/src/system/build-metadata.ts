export type SystemBuildInfo = {
  version: string;
  commit: string;
  environment:
    | "Production"
    | "Development";
};

export function normalizeSystemBuildInfo({
  version,
  commit,
  mode,
}: {
  version: string;
  commit: string;
  mode: string;
}): SystemBuildInfo {
  const normalizedVersion =
    version.trim() || "Local";
  const normalizedCommit = commit.trim();

  return {
    version: normalizedVersion,
    commit: normalizedCommit
      ? normalizedCommit.slice(0, 7)
      : "Unavailable",
    environment:
      mode === "production"
        ? "Production"
        : "Development",
  };
}
