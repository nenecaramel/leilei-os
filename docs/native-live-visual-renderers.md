# Mainline 2G visual renderer contract

Base: `dc454173a1154dad2ea5c6b66e105e10005c7ad0`.
Mainline 2F: **deferred / skipped**, not complete. H covers A–E + G only.

The existing canonical identity → presentation projection → visual node pipeline is
unchanged. The sole `NativeLiveMessageRendererRegistry` moved to
`NativeLiveVisualRendererRegistry.swift`; it owns dispatch. Renderers draw already
classified presentation input and never create canonical content or entities.

Native Markdown/code/table/diff, D structured/search/citation, C bitmap/gallery/file
and E inline paragraph rendering remain native. **Display Math: full visual
renderer. Inline Math: native LaTeX fallback retained** to preserve paragraph
wrapping, selection and accessibility. E's parser and message copy remain intact.
Mermaid uses the local engine. SVG remains a C attachment, not a new canonical kind.
Artifact, resource, webArtifact, interactiveResource, chart, diagram, unknown and
other producerless kinds explicitly use the existing visible fallback. G does not
materialize resources or implement Artifact, MCP App, ui:// or their capabilities.

## Sandbox and lifecycle

Typed factories accept only bounded display LaTeX (8,192 UTF-16 units), Mermaid
(20,000 units, no initialization/frontmatter/click directives), and C's verified
SVG bytes. No provider HTML, URL, file URI or resource input is accepted. Data is
passed through WebKit's structured arguments to fixed renderer functions.

The nonpersistent WKWebView loads one renderer-owned shell over `leilei-visual`.
Its custom scheme handler serves exact manifest paths and verifies SHA256 before
returning bytes. CSP denies network, images, frames, objects and form submission;
only bundled scripts, styles and fonts are enabled. Inline engine styles are
allowed, scripts are not. Navigation and popup creation are denied. The bridge
accepts only main-frame ready/contentHeight/renderError from the current view and
generation. It exposes no native filesystem/network/lookup/callback methods.

KaTeX has `trust:false`, bounded expansion/size and errors enabled. Mermaid has
strict security, disabled HTML labels, bounded edges/text and protected options;
binding callbacks are never invoked. Output SVG is checked again before insertion.
Animation and transitions are disabled regardless of Reduce Motion.

Each SwiftUI surface retains one controller; source/theme/scale updates reuse its
view, coalesce for 150 ms and invalidate older async results. An 8-second timeout
leads to visible source/retry. A maximum of three live views is allowed across the
process; exhausted capacity is visible and retryable. Disappear, background,
memory warning, process/navigation/script failure release the view. No persistent
HTML or visual cache is added. Theme changes re-render, visual scale is bounded
1–2 while native controls/source follow Dynamic Type. Heights are bounded 44–480
points, overflow scrolls, stale/nonfinite/negative/boolean heights are rejected.

SVG downloads only through `AppModel.nativeLiveAttachmentBytes`, reusing C's
scoped original-byte cache and size/SHA authority. The sanitizer rechecks integrity,
limits input to 256 KB, elements to 2,048, nesting to 32 and output to 512 KB.
It accepts a static XML subset with local fragment references; entities, scripts,
events, foreignObject, images, CSS and animation are rejected. Inline and fullscreen
use the same sanitized bytes and preserve viewBox aspect. Unsupported SVG keeps
the verified original-open/Quick Look path; integrity failures cannot render/open.
SVG copy/share remains C's file path; Math/Mermaid copy raw source. Source and
filename/LaTeX accessibility remain available if WebKit fails.

## Offline assets and provenance

Runtime network requirement: **none**, online and offline use the same assets.
Root package.json and lockfile are unchanged. Assets are in the iOS resource
`NativeLiveVisualAssets.bundle`; `assets.json` pins every runtime file by SHA256.

| Engine/assets | Version | License | Bundled bytes |
| --- | --- | --- | ---: |
| KaTeX JavaScript | 0.19.0 | MIT | 272,868 |
| KaTeX CSS + WOFF2 fonts | 0.19.0 | MIT | 282,451 |
| Mermaid browser IIFE | 12.1.0 | MIT plus bundled dependency notices | 5,251,863 |

The complete bundle is approximately 6.0 MB including shell, manifests and notices.
`dependency-provenance.json` records the 70 packages actually used by the Mermaid
bundle plus KaTeX, not the entire development installation. Full licenses are in
`THIRD_PARTY_NOTICES.txt`; esbuild's extracted comments are also retained. There
are no sourcemaps, npm installations, unused font formats or remote assets in the app.

Sources: [KaTeX options](https://katex.org/docs/options),
[Mermaid usage](https://mermaid.js.org/config/usage.html),
[Mermaid security configuration](https://mermaid.js.org/config/schema-docs/config.html).
Review pinned transitive licenses and runtime behavior before updating either engine.

To reproduce engine files in a **separate temporary directory**, install exact
`katex@0.19.0`, `mermaid@12.1.0`, `esbuild@0.25.12` with npm, record its lockfile,
and bundle this entry with esbuild:

```js
import mermaid from 'mermaid';
globalThis.LeileiMermaid = mermaid;
```

Use `--bundle --platform=browser --format=iife --minify --legal-comments=external
--metafile=meta.json --outfile=mermaid.js`. Copy KaTeX's dist/katex.min.js and
dist/katex.min.css, retaining only WOFF2 src alternatives and dist/fonts/*.woff2.
Use meta.json inputs to collect each included package's license and exact version.
After an intentional asset update regenerate assets.json SHA256 entries for all
`.js`, `.css`, `.html`, `.woff2` files. The security regression verifies every hash.
Engine files are vendored review artifacts; rebuilding is never a runtime action.

## Acceptance

Real Swift model tests cover registry, typed input, SVG XML/integrity, lifecycle,
height and navigation policies. A real macOS WebKit executable loads the production
host, shell, KaTeX, Mermaid and SVG; it verifies output DOM, CSP/navigation/popup
denial, theme, streaming reuse, failure/retry and capacity cleanup. An unsigned
Simulator build verifies iOS compilation and resource packaging.

Mainline 3 rich-surface physical acceptance: pending

C media physical acceptance: pending

Device acceptance must still cover rotation, large visuals, accessibility scale,
streaming, retry, offline, memory/reopen and A–E copy/selection/media surfaces.
