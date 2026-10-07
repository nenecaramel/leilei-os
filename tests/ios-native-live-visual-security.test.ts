import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";

const surface = "ios/LeileiOS/LeileiOS/Chat/MessageSurface/";
const read = (name: string) => fs.readFileSync(surface + name, "utf8");

test("G production loader accepts only local assets and the minimal data bridge", () => {
  const host = read("NativeLiveVisualSandbox.swift");
  const shell = read("NativeLiveVisualAssets.bundle/shell.js");
  for (const source of [host, shell]) {
    assert.doesNotMatch(source, /https?:\/\/|cdn\.|loadHTMLString|allowFileAccessFromFileURLs|allowUniversalAccessFromFileURLs|evaluateJavaScript|URLSession|fetch\(/);
  }
  assert.match(host, /websiteDataStore = \.nonPersistent\(\)/);
  assert.match(host, /arguments: arguments/);
  assert.match(host, /NativeLiveAttachmentIntegrity.sha256\(data\) == manifest\[name\]/);
  assert.match(host, /owners.count < 12/);
  assert.match(shell, /trust:false/);
  assert.match(shell, /securityLevel:'strict'/);
  assert.doesNotMatch(shell, /\.bindFunctions\(/);
  const html = read("NativeLiveVisualAssets.bundle/shell.html");
  for (const directive of ["default-src 'none'", "connect-src 'none'", "img-src 'none'", "frame-src 'none'", "object-src 'none'"]) assert.ok(html.includes(directive), directive);
});

test("G keeps a single registry and consumes C verified SVG without another downloader", () => {
  const declarations = fs.readdirSync(surface).filter(n => n.endsWith(".swift"))
    .flatMap(n => read(n).match(/enum NativeLiveMessageRendererRegistry/g) ?? []);
  assert.equal(declarations.length, 1);
  const svg = read("NativeLiveSVGRenderer.swift");
  assert.match(svg, /appModel.nativeLiveAttachmentBytes\(descriptor\)/);
  assert.doesNotMatch(svg, /URLSession|Data\(contentsOf:|downloadTask|fetch\(/i);
  assert.match(svg, /state\.complete\(bytes, generation:generation\)/);
  assert.match(svg, /NativeLiveFilePreviewLease\(data:verified\.data/);
  assert.match(svg, /fullScreenCover/);
  assert.match(svg, /previewAction/);
  const controls = read("NativeLiveVisualSurface.swift");
  assert.match(controls, /input.kind != \.svg/);
  assert.match(controls, /UIPasteboard.general.string = input.source/);
  assert.match(controls, /textSelection\(\.enabled\)/);
  assert.match(controls, /onDisappear \{ controller.stop\(\) \}/);
  const model = read("NativeLiveVisualSandboxModel.swift");
  assert.match(model, /case math, mermaid, svg/);
  assert.doesNotMatch(model, /case html|case artifact|case resource|case webArtifact|case interactiveResource/);
});

test("every runtime vendor asset is pinned by the bundle allowlist and ships license provenance", () => {
  const bundle = surface + "NativeLiveVisualAssets.bundle/";
  const manifest: Record<string,string> = JSON.parse(fs.readFileSync(bundle + "assets.json", "utf8"));
  assert.ok(Object.keys(manifest).length > 20);
  for (const [name, expected] of Object.entries(manifest)) {
    assert.doesNotMatch(name, /\.\.|^\//);
    const bytes = fs.readFileSync(bundle + name);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected, name);
  }
  assert.ok(fs.statSync(bundle + "THIRD_PARTY_NOTICES.txt").size > 10_000);
  const provenance = fs.readFileSync(bundle + "dependency-provenance.json", "utf8");
  assert.ok(provenance.includes("12.1.0") && provenance.includes("0.19.0"));
});
