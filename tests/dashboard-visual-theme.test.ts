import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createThemeVariables } from "../web/src/settings/theme.js";

const dashboardSource = readFileSync(new URL("../web/src/pages/DashboardPage.tsx", import.meta.url), "utf8");
const navigationSource = readFileSync(new URL("../web/src/layout/NavigationGroups.tsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
const heroBlock = stylesSource.slice(stylesSource.indexOf(".hero-panel {"), stylesSource.indexOf(".section-block"));

test("Home replaces the old module-card icon contract with grouped shell navigation", () => {
  assert.match(dashboardSource, /TodayPanel/);
  assert.match(dashboardSource, /StickyPreview/);
  assert.match(dashboardSource, /CalendarPreview/);
  assert.doesNotMatch(dashboardSource, /iconClass|space-icon|quickTarget/);
  assert.match(navigationSource, /label: "Home"/);
  assert.match(navigationSource, /label: "Global Search"/);
  assert.match(navigationSource, /label: "System"/);
});

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function contrast(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

function mixHex(base: string, accent: string): string {
  const channels = [1, 3, 5].map((offset) => Math.round(
    Number.parseInt(base.slice(offset, offset + 2), 16) * 0.94
      + Number.parseInt(accent.slice(offset, offset + 2), 16) * 0.06,
  ));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

test("Dashboard module icon colors remain distinct and readable under accent mixing", () => {
  const modules = [
    ["memory", "#496153", "#e3ebe4"],
    ["diary", "#625b76", "#e8e5ef"],
    ["task", "#516779", "#dfe8ef"],
  ] as const;
  const backgrounds = modules.map(([, , background]) => background);
  assert.equal(new Set(backgrounds).size, 3);
  for (const [name, foreground, background] of modules) {
    const block = stylesSource.slice(stylesSource.indexOf(`.space-icon.${name}`), stylesSource.indexOf("}", stylesSource.indexOf(`.space-icon.${name}`)) + 1);
    assert.match(block, new RegExp(`color:\\s*${foreground}`));
    assert.match(block, new RegExp(`background:\\s*color-mix\\(in srgb, ${background} 94%, var\\(--theme\\) 6%\\)`));
    assert.ok(contrast(foreground, background) >= 3);
  }
});

test("Dashboard module icon contrast remains valid for actual mixed backgrounds", () => {
  const modules = [
    ["Memory", "#496153", "#e3ebe4"],
    ["Diary", "#625b76", "#e8e5ef"],
    ["Task", "#516779", "#dfe8ef"],
  ] as const;
  const accents = ["#405f4d", "#111111", "#ffffff", "#ffd400", "#00bcd4", "#ff2d75"];

  for (const accent of accents) {
    const mixedBackgrounds = modules.map(([, , background]) => mixHex(background, accent));
    assert.equal(new Set(mixedBackgrounds).size, modules.length, `mixed module backgrounds must differ for ${accent}`);

    modules.forEach(([name, foreground], index) => {
      const mixedBackground = mixedBackgrounds[index];
      assert.match(mixedBackground, /^#[0-9a-f]{6}$/i);
      const ratio = contrast(foreground, mixedBackground);
      assert.ok(
        ratio >= 3,
        `${name} ${accent} mixed background ${mixedBackground} contrast ${ratio.toFixed(3)} must be at least 3:1`,
      );
    });
  }
});

test("brand mark and Hero consume dedicated theme variables", () => {
  assert.match(stylesSource, /\.brand-mark[\s\S]*?color:\s*var\(--theme-on-brand\)/);
  assert.match(stylesSource, /\.brand-mark[\s\S]*?background:\s*var\(--theme-brand\)/);
  assert.match(stylesSource, /\.hero-panel[\s\S]*?color:\s*var\(--theme-on-hero\)/);
  assert.match(stylesSource, /\.hero-panel p[\s\S]*?color:\s*var\(--theme-on-hero-muted\)/);
  assert.doesNotMatch(heroBlock, /rgba\(255,\s*255,\s*255/);
});

test("default CSS theme variables match the generated default accent", () => {
  const variables = createThemeVariables("#405f4d");
  assert.ok(variables);
  for (const name of [
    "--theme", "--theme-strong", "--theme-deep", "--theme-soft", "--theme-pale",
    "--theme-brand", "--theme-on-brand", "--theme-hero-start", "--theme-hero-end",
    "--theme-on-hero", "--theme-on-hero-muted", "--theme-hero-glow", "--theme-hero-overlay",
    "--theme-hero-border", "--theme-page-background", "--theme-surface", "--theme-sidebar",
  ]) {
    const match = stylesSource.match(new RegExp(`${name}:\\s*([^;]+);`));
    assert.equal(match?.[1].trim(), variables[name], `${name} must match generated defaults`);
  }
});
