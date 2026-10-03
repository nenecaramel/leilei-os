# Rich Markdown presentation v2 (Mainline 2E)

Base: `6b65436641ccbd9ec18c14b44e25db1a94599c54` (D #836 merge), explicitly supplied by the user.

## Ownership

Canonical Identity → Presentation Projection → Visual Node → Renderer Registry remains the sole path. The canonical text parent holds the original raw text, source block, ordinal, provenance, input mode and citation relations. `NativeLiveRichTextProjector` produces presentation-only `.markdown`, `.code`, `.table`, `.diff`, `.math` and `.mermaid` children. Structured-result text parts use the same projector under their existing part ID namespace. No new canonical identities, rows or backend authorization are introduced.

Parents own citation source aggregation, so projecting multiple children cannot multiply relations. Children retain original provider relations and offsets verbatim; their separate `sourceRangeUTF16` describes their Markdown source. Message copy reads the raw parent text, including whitespace. Edit/Retry remain canonical operations. User media remains above one user text bubble; voice still collapses to a waveform and expands the same projected transcript. The ephemeral runtime streaming adapter also uses this projection without persistence.

## Projection and rendering

The iterative Foundation projector handles paragraphs and blank lines, H1–H6, ordered/unordered lists with bounded nesting, nested quotes, dividers, native inline emphasis/strong/strike/code/escapes and safe links. HTML remains literal text. Inline links are sanitized through D's HTTP/HTTPS policy and native openURL actions enforce it again.

Child IDs combine parent/part namespace, UTF-16 source start and type, excluding the changing end offset. Append-only fence streaming retains identity while payloads update. Inline math children are retained within a single wrapping native paragraph; their LaTeX fallback is monospace and has independent copy actions.

Code retains the full info string, actual language, whitespace and indentation. No filename is inferred. Syntax highlighting level: language-aware labels with plain selectable monospace fallback, including unknown languages. Native source panels scroll horizontally/vertically within a 360-point height and adapt to light/dark colors; copy returns code only.

Only explicit `diff`/`patch` fences produce `.diff`. Unified header/hunk/context/add/remove lines have native visual styling and distinguishable accessibility labels; copy preserves the entire diff body. Ordinary code containing +/- stays code.

GFM tables preserve headers, rectangular rows, declared alignment and original Markdown. Escaped pipes, empty cells and inline formatting are supported. Native grids use fixed 180-point column widths in a scrolling panel; malformed/uneven/oversized tables fall back visibly. Copy returns raw Markdown. Sorting/export and JSON reinterpretation are absent.

**Math rendering level: bounded LaTeX fallback.** Paired `$…$` and display `$$…$$` produce `.math`, preserving raw LaTeX and mode. The conservative inline delimiter rule rejects numeric/currency starts, whitespace, escapes, code and link-containing spans. Ambiguous or unclosed formulas remain raw text. Full typesetting is deferred to G. No WebView, network MathJax or dependency is added.

Mermaid fences produce `.mermaid` and a selectable source preview. They are not executed and never become Artifact diagram identities. General HTML/SVG/Web/Artifact/Resource/MCP App/visual engines remain F–H scope.

## Bounds and fallback

Rich parsing is capped at 131,072 UTF-16 source units, 2,048 presentation nodes and 512 table cells (32 columns maximum). Exceeding bounds shows original source through a plain native text fallback and leaves raw message copy intact. List/quote depth is capped at 8; inline math lookahead at 2,048 characters. No recursive parsing or regex is used. Native inline attributed text and diff/table models are prepared before rendering.

An exact-input, locked cache stores at most 8 inputs / 262,144 source UTF-16 units. Equality covers text, provenance, citations and part namespaces; it never reuses an old relation for updated canonical payloads. This avoids full rich parsing on repeated SwiftUI body evaluations while keeping memory bounded.

Unclosed fences retain source, info and streaming status; malformed Markdown and future identities remain visible. Headings, selectable text, labeled copy buttons, table cells, added/removed diff lines and raw LaTeX have native accessibility semantics.

## Acceptance

Real Swift projection/model fixtures are primary functional evidence; source-contract checks supplement them. See the implementation plan for exact validation and full-suite baseline failure names.

Mainline 3 rich-surface physical acceptance: pending. It must cover long Markdown, links/code/diff/table/math, citations/structured text, streaming/final replacement, light/dark, selection/copy and long-content layout across D/E/F/G. C media physical acceptance remains independently pending.
