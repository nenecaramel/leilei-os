const MOBILE_MEDIA = /@media\s*\(\s*max-width\s*:\s*760px\s*\)\s*\{/g;

const ROUTE_MARKERS = [
  ".memory-",
  ".diary-",
  ".task-",
  ".day-space-",
  ".global-search-",
  ".universe-",
  "[id^=\"memory-\"]",
  "[id^=\"diary-\"]",
  "[id^=\"task-\"]",
  "[id^=\"universe-\"]",
] as const;

const SHARED_PRESENTATION_MARKERS = [
  ".paper-detail-",
  ".paper-author-",
  ".todo-paper-",
  ".native-date-",
] as const;

const TARGET_ROUTE_SCOPE =
  "body:has(:is(.memory-page, .day-space-page, .global-search-page, .universe-page))";

function containsAny(value: string, markers: readonly string[]): boolean {
  return markers.some((marker) => value.includes(marker));
}

function findMatchingBrace(source: string, openBrace: number): number {
  let depth = 0;
  let quote: "\"" | "'" | null = null;
  let escaped = false;
  let inComment = false;

  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inComment) {
      if (char === "*" && next === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === "/" && next === "*") {
      inComment = true;
      index += 1;
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  throw new Error("Unbalanced CSS block while deriving desktop presentation");
}

function splitSelectorList(prelude: string): string[] {
  const selectors: string[] = [];
  let start = 0;
  let round = 0;
  let square = 0;
  let quote: "\"" | "'" | null = null;
  let escaped = false;

  for (let index = 0; index < prelude.length; index += 1) {
    const char = prelude[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") round += 1;
    else if (char === ")") round = Math.max(0, round - 1);
    else if (char === "[") square += 1;
    else if (char === "]") square = Math.max(0, square - 1);
    else if (char === "," && round === 0 && square === 0) {
      selectors.push(prelude.slice(start, index).trim());
      start = index + 1;
    }
  }

  selectors.push(prelude.slice(start).trim());
  return selectors.filter(Boolean);
}

function mirrorSelector(selector: string): string | null {
  if (containsAny(selector, ROUTE_MARKERS)) return selector;
  if (containsAny(selector, SHARED_PRESENTATION_MARKERS)) {
    return `${TARGET_ROUTE_SCOPE} ${selector}`;
  }
  return null;
}

function findPreludeBoundary(source: string, start: number): {
  kind: "block" | "statement" | "end";
  index: number;
} {
  let quote: "\"" | "'" | null = null;
  let escaped = false;
  let inComment = false;
  let round = 0;
  let square = 0;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inComment) {
      if (char === "*" && next === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "*") {
      inComment = true;
      index += 1;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") round += 1;
    else if (char === ")") round = Math.max(0, round - 1);
    else if (char === "[") square += 1;
    else if (char === "]") square = Math.max(0, square - 1);
    else if (round === 0 && square === 0 && char === "{") {
      return { kind: "block", index };
    } else if (round === 0 && square === 0 && char === ";") {
      return { kind: "statement", index };
    }
  }

  return { kind: "end", index: source.length };
}

function skipWhitespaceAndComments(source: string, start: number): number {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
      continue;
    }
    if (source[index] === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      return end === -1 ? source.length : skipWhitespaceAndComments(source, end + 2);
    }
    break;
  }
  return index;
}

function filterCssItems(source: string): string {
  const mirrored: string[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const start = skipWhitespaceAndComments(source, cursor);
    if (start >= source.length) break;

    const boundary = findPreludeBoundary(source, start);
    if (boundary.kind === "end") break;

    if (boundary.kind === "statement") {
      cursor = boundary.index + 1;
      continue;
    }

    const openBrace = boundary.index;
    const closeBrace = findMatchingBrace(source, openBrace);
    const prelude = source.slice(start, openBrace).trim();
    const body = source.slice(openBrace + 1, closeBrace);

    if (prelude.startsWith("@")) {
      if (/^@(supports|container|layer)\b/.test(prelude)) {
        const nested = filterCssItems(body);
        if (nested.trim()) mirrored.push(`${prelude} {\n${nested}\n}`);
      }
    } else {
      const selectors = splitSelectorList(prelude)
        .map(mirrorSelector)
        .filter((selector): selector is string => Boolean(selector));
      if (selectors.length > 0) mirrored.push(`${selectors.join(",\n")} {${body}}`);
    }

    cursor = closeBrace + 1;
  }

  return mirrored.join("\n\n");
}

export function extractNativeMobileDesktopCss(source: string): string {
  const blocks: string[] = [];
  const mediaPattern = new RegExp(MOBILE_MEDIA.source, "g");
  let cursor = 0;

  for (;;) {
    mediaPattern.lastIndex = cursor;
    const match = mediaPattern.exec(source);
    if (!match) break;

    const openBrace = source.indexOf("{", match.index);
    if (openBrace === -1) break;
    const closeBrace = findMatchingBrace(source, openBrace);
    const mobileBlock = source.slice(openBrace + 1, closeBrace);
    const desktopBlock = filterCssItems(mobileBlock);
    if (desktopBlock.trim()) blocks.push(desktopBlock);
    cursor = closeBrace + 1;
  }

  if (blocks.length === 0) return "";
  return `/* generated from accepted mobile presentation; do not hand-style */\n@media (min-width: 761px) {\n${blocks.join("\n\n")}\n}\n`;
}

export function mirrorNativeMobilePageCss(source: string): string {
  const desktop = extractNativeMobileDesktopCss(source);
  return desktop ? `${source}\n\n${desktop}` : source;
}

