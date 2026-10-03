# Message Presentation Model v2

The only Chat presentation pipeline is canonical/draft source → message projector → presentation/visual nodes → renderer registry. Presentation is a value projection; it cannot mutate or manufacture backend authority.

The source carries message identity/role and ordered canonical-compatible block descriptors. Draft attachment inputs contain entity or local draft identity and upload/materialization state, never media bytes. Canonical readback replaces a draft source and uses the same projector and renderer structure.

The projector preserves source ordinal (ties use original input order), canonical identity, raw type, provenance, entity refs, materialization state, role and voice input_mode. Chat product identities are text, attachment, artifact, resource and canonical_tool_result. Ledger tool_use/tool_result rows remain available to unchanged historical Activity projection and are excluded from Chat nodes and copy text.

Text projects to Markdown using the existing renderer. Attachment uses the existing attachment renderer when ready. Unknown, unsupported identities and reserved future visual kinds have a visible fallback with raw type, diagnostic and selected bounded metadata; the renderer never dumps raw payload. Reserved kinds cover code, table, diff, math, citation, search_result, image, gallery, file, document, mermaid, svg, chart, diagram, web_artifact and interactive_resource. Their rich renderers belong to C–G.

Canonical, external text history, pending send and pending Edit use the same value structure. Edit retains message identity and selected attachment descriptors, matches the resulting canonical text/attachment ordinals, replaces text, and removes voice input_mode because keyboard Edit is ordinary text. Retry uses unchanged canonical input. Composer draft attachments map to the same presentation input without putting Composer UI into canonical models.

Copy text is assembled only from projected canonical text in stable order. Attachment-only messages do not acquire synthetic text. Voice remains canonical text; waveform/transcript is a presentation specialization. #813 questions, ordinary historical Activity and #815 timing use original canonical ledger data independently of Chat nodes.

Out of scope: C media transport/materialization/gallery/cache, D structured tool/search/citation UI, E rich Markdown/code/table/diff/math, F Artifact/MCP stores/viewers, G visual renderers/registry expansion and H mixed device acceptance. Existing download/integrity/Quick Look behavior remains in the existing renderer.
