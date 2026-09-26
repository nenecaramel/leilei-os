export type McpToolSurface =
  | "core"
  | "notion"
  | "notion_advanced"
  | "device"
  | "ui";

export type McpToolProfileName =
  | "core"
  | "notion"
  | "notion_advanced"
  | "device"
  | "ui"
  | "full";

export type McpToolExposure = ReadonlySet<McpToolSurface>;

const ALL_SURFACES: readonly McpToolSurface[] = [
  "core",
  "notion",
  "notion_advanced",
  "device",
  "ui",
];

const PROFILE_SURFACES: Record<
  McpToolProfileName,
  readonly McpToolSurface[]
> = {
  core: ["core"],
  notion: ["notion"],
  notion_advanced: ["notion", "notion_advanced"],
  device: ["device"],
  ui: ["ui"],
  full: ALL_SURFACES,
};

export const DEFAULT_PUBLIC_MCP_TOOL_PROFILES:
  readonly McpToolProfileName[] = ["core", "device", "ui"];

export const DEFAULT_INTERNAL_MCP_TOOL_PROFILES:
  readonly McpToolProfileName[] = [
    "core",
    "notion_advanced",
    "device",
  ];

export function resolveMcpToolExposure(
  profiles: readonly McpToolProfileName[],
): McpToolExposure {
  if (profiles.length === 0) {
    throw new Error("At least one MCP tool profile is required.");
  }
  const surfaces = new Set<McpToolSurface>();
  for (const profile of profiles) {
    for (const surface of PROFILE_SURFACES[profile]) {
      surfaces.add(surface);
    }
  }
  return surfaces;
}

export function mcpToolSurfaceEnabled(
  exposure: McpToolExposure,
  surface: McpToolSurface,
): boolean {
  return exposure.has(surface);
}

export function parseMcpToolProfiles(
  value: string | undefined,
  fallback: readonly McpToolProfileName[],
): readonly McpToolProfileName[] {
  if (value === undefined || !value.trim()) {
    return [...fallback];
  }
  const profiles = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (profiles.length === 0) {
    return [...fallback];
  }

  const valid = new Set<McpToolProfileName>(
    Object.keys(PROFILE_SURFACES) as McpToolProfileName[],
  );
  for (const profile of profiles) {
    if (!valid.has(profile as McpToolProfileName)) {
      throw new Error(
        `Unknown MCP tool profile: ${profile}`,
      );
    }
  }
  return profiles as McpToolProfileName[];
}
