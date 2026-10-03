# Message Surface v2: Claude output and canonical contract

This contract defines provider truth → conversation durable ledger, separating Chat product identity from Activity backing evidence. Presentation projection,
visual nodes and renderer registration belong to subsequent work.

## Sources and inventory maintenance

The bridge package pins Claude Agent SDK **0.3.286**. The installed package reports
Claude Code **2.1.286** and resolves its Anthropic SDK peer to **0.128.0**.
The root lockfile does not lock the independent bridge workspace; the bridge has
an exact package pin, not a tracked bridge lockfile. Inventory was inspected from
installed `sdk.d.ts` (`SDKMessage`, `SDKAssistantMessage`, `SDKResultSuccess`,
`SDKMcpResourceLink`) and the peer's `resources/beta/messages/messages.d.ts`
(`BetaContentBlock`, `BetaContentBlockParam`). Existing bridge fixtures also cover
provider/runtime extensions not in the exported SDKMessage union.

`tools/claude-bridge/src/output-contract.mjs` contains the executable event surface
inventory. On an SDK upgrade, inspect the exported union and Beta content unions,
update this inventory, and extend boundary tests. An unrecognized discriminator
must use the compatibility path, never an empty default renderer assumption.

### Content-producing inventory

| Provider mechanism | Meaning / normalization | Default home |
| --- | --- | --- |
| assistant text; text citations | Top-level conversation text; retain citation relations in bounded payload. Subagent text excluded. | Canonical text |
| image, document | Beta input/tool-result content, not universal assistant output variants. MIME and known size survive; binary pending materialization. | Runtime candidate |
| search_result | Beta content parameter / structured tool part; search execution is not a Chat block. | Runtime candidate |
| web_search_tool_result, web_fetch_tool_result | Server execution results, structured bounded compatibility record. | Activity |
| server_tool_use, mcp_tool_use, mcp_tool_result, mcp_tool_listing | Provider tool use/results/listing. | Activity |
| advisor_tool_result, code_execution_tool_result, bash_code_execution_tool_result, text_editor_code_execution_tool_result, tool_search_tool_result | Execution, including nested generated-file/search data. Encrypted/reasoning fields excluded. | Activity |
| tool_result text/object/array | Typed structured parts alongside the bounded legacy output field. | Durable Activity backing; additional Chat content only with backend projection |
| container_upload | Provider file candidate; no automatic delivery. | Runtime candidate |
| fallback | Provider model handoff boundary, not conversation content. | Observability |
| future content blocks | No assumed product identity; unsupported content envelope and diagnostic. | Compatibility content if top-level; Activity if subagent |
| generated file / files_persisted | Provider file candidate; preserve provenance, not automatic delivery. | Runtime |
| LeileiOS send_file / output_attachment_ids | Existing upload completion + ready/ownership-locked binding. Entity ID is attachment ID. | Canonical attachment |
| structured_output | Optional **SDKResultSuccess result-level unknown payload**, not a Beta assistant content variant. Normalize at turn result. | Durable result metadata; opt-in canonical |
| Artifact | No authoritative artifact entity store in this bridge/SDK contract. Product identity/ref reserved, no fabricated records. | Extension point |
| SDKMcpResourceLink, tool_use_result resourceLinks, task_notification.resource_links | URI candidate/reference; URI does not imply bytes or sent file. | Runtime output_resources |
| MCP embedded resource | Tool result content candidate; metadata and text bounded, blobs excluded. | Runtime candidate |
| MCP ui:// | URI alone grants no interactive capability. | reference_only |
| thinking, redacted_thinking, compaction content | Hidden reasoning/context internals are not canonical or compatibility payloads. | Excluded |

The Beta assistant union contains text, thinking, redacted_thinking, tool_use,
server_tool_use, web_search/web_fetch/advisor/code_execution/bash_code_execution/
text_editor_code_execution/tool_search results, MCP use/result/listing,
container_upload, compaction and fallback. The Beta parameter union additionally
contains image, document, search_result, tool_result and tool addition/removal.
This distinction prevents assuming every input content parameter can appear as a
normal assistant canonical block.

### Runtime and observability inventory

| SDK family / discriminator | Home |
| --- | --- |
| user/replay; tool use and execution result; tool_progress; tool_use_summary | Activity / Runtime |
| task_started, task_progress, task_updated, task_notification, background_tasks_changed | Activity / Runtime; no canonical block |
| parent_tool_use_id, subagent/team origins, worker_shutting_down | Activity / Runtime; child text excluded |
| permission_denied, elicitation_complete; canUseTool, AskUserQuestion and MCP elicitation callback paths | Interaction / Runtime; no redesign of persistence |
| hook_started, hook_progress, hook_response, control_request_progress | Activity / Runtime |
| status, session_state_changed, api_retry, notification, informational, auth_status | Runtime |
| model_refusal_fallback, model_refusal_no_fallback, local_command_output, prompt_suggestion | Runtime compatibility; no automatic Chat projection |
| stream_event partial/final lifecycle; compact_boundary; conversation_reset | Runtime |
| system/init model/cwd/MCP servers/skills/agents/plugins/SDK and Code versions | Observability; existing structural environment metadata |
| result usage/modelUsage/cost/duration/latency; context_usage and usage_report | Observability; result metadata, not Chat |
| rate_limit_event; thinking_tokens counts; plugin_install; commands_changed | Observability |
| mirror_error; session store health; adapter vcs_state_changed | Observability |
| files_persisted; memory_recall | Runtime candidates/context signals |
| adapter command_lifecycle, retry/notice extensions | Runtime |

Known but not specialized SDK events use a bounded `provider_runtime` envelope
with their inventory surface. Unknown events use `UNSUPPORTED_PROVIDER_EVENT`.
Thinking token counts may be retained; hidden thinking text/signatures may not.

## Conversation durable ledger and Chat identities

```text
Conversation durable ledger
├── Chat canonical content
│   ├── text
│   ├── attachment
│   ├── artifact
│   ├── resource
│   └── canonical_tool_result
└── Activity backing evidence
    ├── tool_use
    └── tool_result
```

Version 1 **Chat canonical product identities** are `text`, `attachment`, `artifact`, `resource`,
`canonical_tool_result`. These are Chat product identities, not provider type aliases.
`unknown` is a compatibility carrier, not a sixth rendered product concept.

Existing physical text/attachment kinds remain unchanged. Artifact/resource/
canonical_tool_result use physical `unknown` with `payload.schema_version = 1`
and `payload.identity`. Both conversation readers decode only these three extension identities from physical unknown. An unknown payload claiming text/attachment never becomes an authoritative text/file row. A future
schema version stays readable as `unknown`. No schema migration is required.
`rawType` retains the provider type; no duplicate raw-type DB column is introduced.

`tool_use` / `tool_result` are durable Activity evidence / legacy execution
ledger kinds, not sixth/seventh Chat identities. Both existing and newly finalized
ordinary tool use/results persist these rows. They preserve tool identity,
input/output, tool_use_id, parent tool/agent IDs and normalized provenance. Tool
use display_name/server_display_name/icon_url metadata is stripped exactly as in
main. Hidden tasks propagate hidden_from_transcript through all tool descendants;
ambient tasks propagate hidden_from_activity. Suppressed backing rows remain
stored, so historical Activity does not resurrect hidden work after runtime
history expires. The main iOS Activity projection reads message.blocks; assistant
Chat body already filters tool_use/tool_result. Neither behavior is changed here.

#813 AskUserQuestion resolution enrichment continues on these same backing rows:
question_activity retains the minimal answered/cancelled truth and restores one
Asked user step after operational history retention. A trusted backend projection
may additionally create a Chat identity from a tool result; it does not replace
or erase the result evidence. Ordinary execution never implicitly creates
canonical_tool_result or Chat-visible content.

Previously unsupported legacy rows now read as diagnostic compatibility content;
legacy thinking/reasoning rows expose only an exclusion diagnostic, and unknown
media payloads are bounded/redacted on read. No historical rewrite, lineage
changes or Retry/Edit/head semantics changes are required.

## Chat canonicalization predicate

1. Nonempty top-level assistant text is conversation content. Parent tool/agent
   text and structured context/usage report text are excluded.
2. Ready files enter only through existing authenticated attachment binding:
   completed upload, user ownership, ready status and transaction locks. An
   `attachment` provider candidate event cannot bypass this path.
3. Execution output defaults to Activity, retaining ordinary tool_use/tool_result
   durable backing with main's lineage/suppression semantics. AskUserQuestion
   uses the same rows and existing #813 enrichment. No default execution becomes
   a Chat product identity. The bridge never forwards a provider's
   `conversation_projection` as authority. A trusted backend projector may add a
   version 1 projection with identity, reason (`explicit_share` or
   `materialized_send`) and validated refs. This opt-in is not a UI decision.
4. Resource candidates, task/background/permission/question events and
   observability never automatically create content.
5. Unknown top-level assistant content is retained as durable compatibility
   content with a diagnostic. Unknown runtime events stay Runtime.

Extension projections are contract entry points, not new producer/storage
implementations. Future backend projectors must resolve refs against authoritative
user-owned entities before requesting projection; only validated IDs are refs.
Artifact/resource producers are intentionally not enabled by this change.

## Entity and reference rule

References are `{type: attachment_ref | artifact_ref | resource_ref, entity_id}`.
Use stable authoritative IDs, never duplicate whole entities into tool output.
Entity identities require a matching ref. Projection refs are bounded to 32.
The existing attachment store remains authoritative; canonical descriptors are
metadata, not a second file store. Ready binding records schema, identity, refs
and structural source provenance. User sends have origin user_send/raw_type user_attachment without a model provider; only provider_send has provider claude_code/raw_type send_file. Generated-file provenance must survive future
materialization; a generated path or URI alone is not an entity ID.

Provenance can carry provider, raw type/subtype, provider schema, tool use/task
IDs, parent tool/agent IDs, origin, and source_ref. Source/materialization
relations use refs. No invented artifact table is introduced.

## Structured tool result and structured output

Tool results retain a version 1 `structured.parts` contract for text, JSON,
image, document, search_result, citation, generated_file, resource_link/resource,
structured_output and unsupported parts. No whole-result JSON.stringify renderer
is part of the contract. Each structured result reports its own truncation/redaction flags. The SDK's
full `tool_use_result` is retained under `structured.provider_output`, separately
from model-directed content, only when a tool ID matches or one result makes the
association unambiguous. Otherwise `UNATTRIBUTED_TOOL_OUTPUT` retains a bounded
runtime envelope without inventing attribution. The old bounded `output` field
remains a runtime compatibility field. Its binary_omitted markers are transport evidence, not a
product identity. Image/document parts expose `materialization: pending`, MIME
and known byte length until C/D can create authoritative entities.

Result-level structured output is preserved as a bounded payload envelope in
normalized result and `runtime_metadata.result.structured_output`. The existing
provider checkpoint persists this metadata independently of 30-day runtime
history. A truncation flag means the payload is incomplete and cannot be treated
as a full validated result. Presence boolean remains compatible with older
runtimes. Turn normalization does not automatically create a canonical block;
a future backend projector must apply the predicate and define the user-visible
meaning before projection.

## Unknown/future compatibility and bounds

Unknown content/events retain provider, raw type/subtype, SDK schema version,
provenance and JSON-safe payload. `UNSUPPORTED_PROVIDER_CONTENT` and
`UNSUPPORTED_PROVIDER_EVENT` are explicit runtime diagnostics exposed through
Activity/readback. Unsupported top-level content also has durable canonical
unknown storage; missing presentation support never licenses data deletion.

Compatibility envelope limits: 24,000 total text/key characters, 8,000 per string,
32 array items, 48 object keys (128 characters each), depth 6, 512 visited nodes.
Truncation/cycle markers are explicit. Binary bytes, declared/large encoded data, blobs and data URLs are
excluded; ordinary JSON `data` text remains text. Pending metadata preserves known MIME/size. Nonfinite numbers and
non-JSON values normalize safely. Thinking/redacted thinking, reasoning keys,
signatures and encrypted reasoning content are excluded. Bounds apply in the
bridge and again for new Chat compatibility/projection envelopes at the canonical writer. Legacy tool backing retains the normalized execution payload contract; it is not converted into a Chat envelope.

Existing legacy tool-output limits remain 48,000 text characters, 24,000 per
string, 32 items, 48 keys (128 characters each), depth 6 and 512 nodes; the new structured projection is separately
bounded. A compatibility snapshot is a partial source for migration/reprojection,
not an unbounded archive of provider internals.

## Resource / Artifact capabilities

Resource capability concepts are `reference_only`, `previewable`,
`interactive_mcp_app`. Current candidates use reference_only. Previewable
requires a verified materialization/share; interactive_mcp_app additionally
requires real MCP App capability/resource metadata and a trusted host contract.
Do not infer either from `ui://`, MIME or a filename. Artifact is an independent
identity with a reserved stable ref contract; F owns authoritative artifact
storage and capability integration.

## Dependencies for subsequent B–H

- B uses identity/ref/provenance/compatibility envelopes for presentation models.
- C materializes pending attachment/media bytes through verified entity storage.
- D consumes structured parts and adds deliberate tool/search/citation projection.
- E renders text/Markdown/code/table/diff/math without guessing identity.
- F supplies Artifact/resource authority and MCP App capability checks.
- G registers visual renderers against presentation nodes, including fail-visible fallbacks.
- H verifies mixed old/new data and unsupported future types end to end.

Local tests establish contract boundaries, not deployed Mac/Railway/iPhone
acceptance. After merge, refresh the Mac bridge and verify authenticated result
metadata/current-path readback. No daemon restart, production mutation or merge
is part of A's local verification.
