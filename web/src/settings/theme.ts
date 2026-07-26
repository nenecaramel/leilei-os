const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export const THEME_CACHE_KEY = "leilei-os.theme.v1";
export const THEME_CACHE_VERSION = 1;

export type ThemeVariables = Record<string, string>;

export type ThemeCache = {
  version: typeof THEME_CACHE_VERSION;
  accentColor: string;
  variables: ThemeVariables;
};

type RgbColor = {
  red: number;
  green: number;
  blue: number;
};

export function createThemeVariables(
  color: string,
): ThemeVariables | null {
  const accent = parseHexColor(color);
  if (!accent) return null;

  const black: RgbColor = { red: 0, green: 0, blue: 0 };
  const white: RgbColor = { red: 255, green: 255, blue: 255 };
  const basePage: RgbColor = { red: 243, green: 241, blue: 235 };
  const baseSurface: RgbColor = { red: 250, green: 248, blue: 243 };
  const baseSidebar: RgbColor = { red: 248, green: 246, blue: 240 };
  const isBright = getRelativeLuminance(accent) > 0.56;
  const strong = mixColor(accent, black, isBright ? 0.42 : 0.18);
  const deep = mixColor(accent, black, isBright ? 0.64 : 0.46);
  const soft = mixColor(accent, white, isBright ? 0.72 : 0.78);
  const pale = mixColor(accent, white, 0.9);
  const pageBackground = mixColor(basePage, accent, isBright ? 0.065 : 0.045);
  const surface = mixColor(baseSurface, accent, 0.035);
  const sidebar = mixColor(baseSidebar, accent, 0.045);
  const accentHex = toHexColor(accent);
  const strongHex = toHexColor(strong);
  const deepHex = toHexColor(deep);

  return {
    "--theme": accentHex,
    "--theme-strong": strongHex,
    "--theme-deep": deepHex,
    "--theme-soft": toHexColor(soft),
    "--theme-pale": toHexColor(pale),
    "--theme-rgb": `${accent.red}, ${accent.green}, ${accent.blue}`,
    "--theme-strong-rgb": `${strong.red}, ${strong.green}, ${strong.blue}`,
    "--theme-deep-rgb": `${deep.red}, ${deep.green}, ${deep.blue}`,
    "--theme-on-accent": isBright ? "#25302a" : "#f8f5ec",
    "--theme-on-hero": "#f8f5ec",
    "--theme-page-background": toHexColor(pageBackground),
    "--theme-surface": toHexColor(surface),
    "--theme-sidebar": toHexColor(sidebar),
    "--theme-page-glow": `rgba(${accent.red}, ${accent.green}, ${accent.blue}, 0.2)`,
    "--theme-page-glow-soft": `rgba(${accent.red}, ${accent.green}, ${accent.blue}, 0.1)`,
    "--theme-hero-start": deepHex,
    "--theme-hero-end": strongHex,
    "--theme-hero-glow": `rgba(${accent.red}, ${accent.green}, ${accent.blue}, 0.34)`,
    "--theme-hover-background": `rgba(${accent.red}, ${accent.green}, ${accent.blue}, 0.07)`,
    "--theme-border": `rgba(${deep.red}, ${deep.green}, ${deep.blue}, 0.11)`,
    "--theme-border-strong": `rgba(${deep.red}, ${deep.green}, ${deep.blue}, 0.18)`,
    "--theme-shadow-color": `rgba(${deep.red}, ${deep.green}, ${deep.blue}, 0.11)`,
    "--focus-ring": `0 0 0 4px rgba(${accent.red}, ${accent.green}, ${accent.blue}, 0.15)`,
    "--shadow-soft": `0 18px 42px rgba(${deep.red}, ${deep.green}, ${deep.blue}, 0.06)`,
    "--shadow-card": `0 22px 54px rgba(${deep.red}, ${deep.green}, ${deep.blue}, 0.09)`,
    "--green": accentHex,
    "--green-dark": strongHex,
    "--green-soft": toHexColor(soft),
  };
}

export function createThemeCache(color: string): ThemeCache | null {
  const variables = createThemeVariables(color);
  if (!variables) return null;
  return { version: THEME_CACHE_VERSION, accentColor: color, variables };
}

export function parseThemeCache(raw: string | null): ThemeCache | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isThemeCache(value)) return null;
    return value;
  } catch {
    return null;
  }
}

export function readThemeCache(storage: Storage | undefined): ThemeCache | null {
  try {
    return parseThemeCache(storage?.getItem(THEME_CACHE_KEY) ?? null);
  } catch {
    return null;
  }
}

export function writeThemeCache(storage: Storage | undefined, color: string): ThemeCache | null {
  const cache = createThemeCache(color);
  if (!cache) return null;
  try {
    storage?.setItem(THEME_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Local persistence is an enhancement; it must never block the UI.
  }
  return cache;
}

export function applyThemeVariables(
  root: Pick<CSSStyleDeclaration, "setProperty"> | undefined,
  variables: ThemeVariables,
): void {
  if (!root) return;
  for (const [name, value] of Object.entries(variables)) {
    root.setProperty(name, value);
  }
}

export function applyThemeColor(
  color: string,
  documentRef: Document | undefined = typeof document === "undefined" ? undefined : document,
): ThemeCache | null {
  const cache = createThemeCache(color);
  if (!cache) return null;
  applyThemeVariables(documentRef?.documentElement.style, cache.variables);
  return cache;
}

function isThemeCache(value: unknown): value is ThemeCache {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ThemeCache>;
  if (
    candidate.version !== THEME_CACHE_VERSION ||
    typeof candidate.accentColor !== "string" ||
    !HEX_COLOR_PATTERN.test(candidate.accentColor) ||
    !candidate.variables ||
    typeof candidate.variables !== "object" ||
    Array.isArray(candidate.variables) ||
    typeof candidate.variables["--theme"] !== "string"
  ) return false;
  return Object.entries(candidate.variables).every(
    ([name, cssValue]) => name.startsWith("--theme") || name.startsWith("--green") || name.startsWith("--line") || name.startsWith("--cream") || name.startsWith("--focus") || name.startsWith("--shadow")
      ? typeof cssValue === "string"
      : false,
  );
}

function parseHexColor(value: string): RgbColor | null {
  if (!HEX_COLOR_PATTERN.test(value)) return null;
  return {
    red: Number.parseInt(value.slice(1, 3), 16),
    green: Number.parseInt(value.slice(3, 5), 16),
    blue: Number.parseInt(value.slice(5, 7), 16),
  };
}

function mixColor(first: RgbColor, second: RgbColor, amount: number): RgbColor {
  return {
    red: Math.round(first.red + (second.red - first.red) * amount),
    green: Math.round(first.green + (second.green - first.green) * amount),
    blue: Math.round(first.blue + (second.blue - first.blue) * amount),
  };
}

function getRelativeLuminance(color: RgbColor): number {
  const [red, green, blue] = [color.red, color.green, color.blue].map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function toHexColor(color: RgbColor): string {
  return `#${[color.red, color.green, color.blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
