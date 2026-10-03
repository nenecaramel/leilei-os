# Structured Tool Results + Search / Citation v2

D extends B's canonical → presentation → visual node → shared registry pipeline. It adds no Chat canonical identities. Structured children retain their canonical_tool_result parent block, provenance and normalized part order; their IDs are local presentation keys, not provider citation/entity IDs. Ordinary tool_use/tool_result remains durable Activity evidence and is filtered from Chat/copy. AskUserQuestion and hidden/ambient descendants remain on the same backing ledger.

## Backend authority

Provider/runtime JSON cannot grant conversation_projection authority, including directly forged normalized payloads and future projection versions. Backend authorization uses a non-serializable, in-memory token associated with the exact event objects. Only separately supplied backend share decisions with explicit_share/materialized_send can authorize canonical_tool_result. Ready/bound attachment refs are resolved against authoritative user-owned entities; invalid/foreign/pending refs reject authorization. Artifact/Resource entity authority remains F.

No current SDK event gives a reliable explicit share signal, so production execution/result-level structured_output continues as Activity/result metadata. There is no heuristic producer, endpoint or automatic opt-in. Future backend producers must create decisions and resolve ownership inside their canonical write transaction; tokens must not be transported or recovered from provider JSON. The infrastructure tests intentionally invoke this backend-only authorization. An authorized projection adds a separate canonical row and never replaces execution backing. Parent/hidden/ambient/question suppression still wins over authorization.

The existing v1 envelope and StructuredToolResult parts schema are reused. Final storage bounding compensates for the one/two known structured transport wrappers while retaining the same text/node limits, so wrapper nesting does not consume semantic depth or erase small snippets/quotes/JSON. Canonical projection preserves reason, refs, bounded structured content and provenance. materialized_attachments carries resolved canonical descriptors indexed by existing attachment IDs, not new file entities. A child ref must match both a canonical ref and a resolved descriptor before using C. C still obtains fresh owned download slots and verifies bytes; no media/cache/gallery/Quick Look code is duplicated.

## Typed presentation

Structured v1 parts support text, json, structured_output, search_result, citation, image/document/generated_file, resource_link/resource and unsupported. Parser handles A's bounded envelope and direct v1 contract fixtures; unsupported schema/empty/future/malformed content stays visible. provider_output is never parsed or dumped by UI. Text children reuse Markdown without creating canonical text rows. JSON object keys are stable/sorted; arrays preserve order; scalar/null are explicit. Semantic JSON values retain all bounded fields, including business type/value/label keys; UI never guesses that such keys mean a wrapper. Native disclosure/copy uses separately bounded JSON (depth 6, 256 nodes, 48 keys, 32 items, 8000 characters), with a visible incomplete marker. Result truncated/redacted states remain visible; clipped data is not treated as fully validated semantic output.

Pending media with no authoritative ref displays a stable pending/unavailable fallback with real MIME/known length. Materialized refs reuse NativeLiveAttachmentPresentationInput and C's registry primitive. Generated provenance keeps parent provider/tool/task lineage and available generation origin/raw type. Resources display bounded title/name/URI/description and reference_only capability; ui:// never upgrades to interactive and is not opened.

## Search and citations

Installed Agent SDK 0.3.286, Claude Code 2.1.286 and Anthropic peer 0.128.0 remain unchanged. Actual Beta text relations include web_search_result_location, char/page/content-block document locations and search_result_location. Fields such as encrypted_index, cited_text, URL/title, document/search-result indices, file IDs and start/end coordinates remain in the typed relation. No missing titles/quotes/offsets/provider IDs are synthesized.

Canonical assistant text citations are projected independently of tool results. Sources aggregate by authoritative URL relation or known provider/document identity and retain every occurrence/coordinate in their relation list. Text nodes keep those same relations for E. Search-local citation relations participate in the same source aggregation and survive associations with standalone citations. Structured citation sources aggregate without changing parts order; subsequent occurrences remain references, and search cards associate citations only when their authoritative source URL matches. No index is inferred from normalized part position. Search consumes existing title/source/URL/content snippet and no webpage/metadata/favicon fetch. The actual search_result input parameter is not falsely described as universal assistant output; bridge fixtures mark generated/resource/future/citation tool parts as compatibility contract cases.

HTTP(S) URLs require an explicit safe scheme/host capability, with credentials rejected. Unsafe or unknown schemes stay visible with Link unavailable; file/javascript/data/custom/resource URIs are never executed by these surfaces.

## Acceptance

No backend schema, package/workflow/template, Markdown engine, Composer, Activity UI or C media redesign. E–H rich Markdown/code/table/diff/math, Artifact/Resource lifecycle, interactive hosts and general web rendering remain out of scope. No production operation or merge is part of this work.

Mainline 3 rich-surface physical acceptance: pending. Later D/E/F/G device acceptance covers citations/source links, search/results, JSON disclosure/copy, media refs, long/malformed/fallback surfaces. C's separate media physical acceptance remains pending.
