import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function pngSize(bytes: Buffer): [number, number] {
  assert.equal(bytes.toString("ascii", 1, 4), "PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test("PWA dependency is pinned without changing the existing Web dependency ranges", async () => {
  const pkg = JSON.parse(
    await readFile("web/package.json", "utf8"),
  );
  assert.equal(
    pkg.devDependencies["vite-plugin-pwa"],
    "1.3.0",
  );
});

test("PWA manifest opens Leilei OS at Home in standalone mode", async () => {
  const source = await readFile("web/vite.config.ts", "utf8");
  assert.match(source, /VitePWA/);
  assert.match(source, /registerType:\s*["']prompt["']/);
  assert.match(source, /name:\s*["']Leilei OS["']/);
  assert.match(source, /short_name:\s*["']Leilei OS["']/);
  assert.match(source, /start_url:\s*["']\/["']/);
  assert.match(source, /scope:\s*["']\/["']/);
  assert.match(source, /display:\s*["']standalone["']/);
  assert.match(source, /pwa-192\.png/);
  assert.match(source, /pwa-512\.png/);
  assert.match(source, /pwa-maskable-512\.png/);
});

test("PWA cache policy has no private API runtime cache and excludes API navigation fallback", async () => {
  const source = await readFile("web/vite.config.ts", "utf8");
  assert.doesNotMatch(source, /runtimeCaching\s*:/);
  assert.match(source, /navigateFallbackDenylist/);
  assert.match(source, /\^\\\/api\\\//);
  assert.match(source, /cleanupOutdatedCaches:\s*true/);
});

test("iOS installation metadata points to a durable Apple touch icon", async () => {
  const html = await readFile("web/index.html", "utf8");
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg" \/>/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /apple-mobile-web-app-title/);
  assert.match(html, /apple-touch-icon\.png/);
});

test("install icon PNGs have explicit required dimensions", async () => {
  assert.deepEqual(pngSize(await readFile("web/public/pwa-192.png")), [192, 192]);
  assert.deepEqual(pngSize(await readFile("web/public/pwa-512.png")), [512, 512]);
  assert.deepEqual(pngSize(await readFile("web/public/pwa-maskable-512.png")), [512, 512]);
  assert.deepEqual(pngSize(await readFile("web/public/apple-touch-icon.png")), [180, 180]);
});

test("the icon master is a quiet single-L SVG with no decorative effects", async () => {
  const svg = await readFile("web/public/favicon.svg", "utf8");
  assert.match(svg, /viewBox="0 0 512 512"/);
  assert.match(svg, /<rect[^>]+fill="#fff"/);
  assert.match(svg, /<path[^>]+fill="#7d847f"/);
  assert.equal((svg.match(/<path\b/g) ?? []).length, 1);
  assert.doesNotMatch(svg, /gradient|filter|stroke|circle|polygon|polyline/i);
});

test("the L uses equal visual stroke thickness for stem and foot", async () => {
  const svg = await readFile("web/public/favicon.svg", "utf8");
  const match = svg.match(/d="M (\d+) (\d+) H (\d+) V (\d+) H (\d+) V (\d+) H (\d+) Z"/);
  assert.ok(match, "expected the simple geometric L path");
  const [, x, , stemRight, , , bottom, footLeft] = match.map(Number);
  const stemWidth = stemRight - x;
  const footThickness = bottom - Number(match[4]);
  assert.equal(footLeft, x);
  assert.equal(stemWidth, footThickness);
});
