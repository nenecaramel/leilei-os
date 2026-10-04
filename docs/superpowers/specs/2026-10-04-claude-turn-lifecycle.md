开始 **Claude Turn Lifecycle / Message State Machine 重构**。

仓库：`nenecaramel/leilei-os`

当前已知 latest main：

`b9e0d1be1286b170a93c72f58bfd262a0b82ec98`

这是 G `#838` merge 后的 main。

开工前必须重新 fetch `origin/main`；如果 main 已移动，以实际 latest main 为 base。

建议分支：

`feat/claude-turn-lifecycle`

完成后开独立 PR，不要 merge。

# 这次不是 UI 小修

当前 Claude 消息加载/渲染存在系统性结构问题。

实际代码目前允许同一个逻辑 assistant turn 同时从多条路径出现：

```text
canonical NativeLiveMessageRow
pending NativeLiveRuntimeAssistantRow
replacement runtime row
recovered runtime assistant row
background runtime overlay
```

`NativeLiveMessageSurface` 还分别计算：

```text
replacementAssistantID
canonicalRuntimeAssistantID
pendingAssistantMessageID
```

并存在：

```text
assistantContent.hidden()
+ NativeLiveRuntimeAssistantRow overlay
```

这种 replacement hack。

这正是以下问题的结构根因：

- Edit 时旧 assistant 在原位一份，又在新生成位置瞬间出现一份。
- Retry 时旧答案和 runtime 答案短暂同时存在。
- runtime → canonical 时正文闪一下、消失再出现。
- Thinking / Activity / 正文各自刷新。
- timestamp突然出现或改变。
- Activity展开状态在 backing replacement 后重置。
- Question / Permission / Tool状态像删除旧卡再造新卡。
- runtime recovery再造一条 assistant。
- scroll因为 row插入/删除/ID变化而跳。
- user optimistic message canonical 到来时换 row identity。
- G 的 Math/Mermaid/SVG 等复杂 renderer可能因为外层 identity变化重新创建。

**本任务要删除这些结构性根因。**

# 唯一总原则

任何时刻：

> **一个逻辑 Claude turn，在当前 path 最多只能对应一个可见 assistant row。**

从开始准备、Thinking、streaming、工具调用、Question/Permission、正文生成、background task，到最终 canonical 落盘：

```text
用户眼里始终是同一条消息
```

只能更新这条消息的状态和 backing。

禁止：

```text
pending row → 删除 → runtime row → 删除 → canonical row
```

目标：

```text
pending/runtime/canonical/background
                ↓
        Turn Reconciler
                ↓
  AssistantTurnPresentation
                ↓
       ONE stable row
```

# 最终管线

本轮建立：

```text
Canonical current path
Pending send / retry / edit
Foreground runtime surface
Background runtime surface
Durable Activity
History/current branch state
        ↓
NativeLiveConversationPresentationAssembler
        ↓
NativeLiveConversationRowPresentation
        ↓
User row / AssistantTurnPresentation
        ↓
固定 SwiftUI row
```

现有 A–E + G：

```text
Canonical Identity
→ Message Presentation
→ Visual Node
→ Renderer Registry
```

仍然保留。

本任务是在它上面增加**turn lifecycle orchestration**，不是推翻 A–G。

正确关系：

```text
Turn state machine
        ↓
选择当前 backing/body/activity
        ↓
已有 Message Presentation Pipeline
        ↓
Visual Renderer
```

# 第一部分：建立 AssistantTurnPresentation

建议引入类似：

```swift
NativeLiveAssistantTurnPresentation
```

至少包含：

```text
stableID

canonicalMessageID?
prepareID?
requestID?
parentUserMessageID?

phase
timestamp

bodyPresentation
activityProjection

duration
stepCount
hasPendingInput
failure

copyText
canCopy
canRetry

backgroundState
```

UI row不能再自己拿：

```text
message
runtimeSurface
replacementRuntimeSurface
activityRuntimeSurface
pendingOperation
```

然后现场猜应该画哪个。

**所有判断先在 presentation/reducer 层完成。**

# Turn生命周期

建议统一成有限状态：

```text
starting
thinking
working
needsInput
background
completed
failed
```

这是 presentation lifecycle，不要求修改 backend canonical status。

状态来源必须明确、deterministic。

例如：

```text
刚 prepare，无正文/step
→ starting

active，无 tool/task/question
→ thinking

active，有 execution step
→ working

有 pending Permission / Question
→ needsInput

foreground finished，但 background task仍 active
→ background

terminal success
→ completed

terminal failure
→ failed
```

不要让 View通过几十个 Bool重新推导状态。

# Activity header

统一输出：

| 状态 | 显示 |
|---|---|
| 刚开始，还没有可见内容 | `Thinking…` |
| 纯思考进行中 | `Thinking for 8s` |
| 纯思考完成 | `Thought for 8s` |
| 已开始工具/Task | `Working for 8s · 2 steps` |
| 工具型 turn完成 | `Worked for 8s · 2 steps` |
| Permission / Question pending | `Working for 8s · 2 steps · Needs input` |
| turn失败 | `Worked for 8s · 2 steps · Failed` |
| 前台完成、后台仍跑 | `Working in background · 2 steps` |
| 最终没有 Activity、也没有 duration | 只显示 timestamp |

不要再额外搞：

```text
typing dots row
+
Thinking row
+
timestamp row
```

Starting状态直接使用：

`Thinking…`

只有确实完全没有 assistant turn时才不存在 row。

# Duration

正在运行：

```text
start timestamp
→ elapsed
```

terminal runtime一旦拿到 provider：

`duration_ms`

立即固定。

后续：

```text
runtime → canonical
refresh
background update
```

都不能重新算出另一个 duration。

canonical `message.activity.durationMs` 与 runtime result属于同一 durable truth。

如果 runtime已经显示：

`Worked for 18s`

canonical arrival不能变：

`Worked for 17s`

或：

`19s`

# Timestamp

一条 Claude turn只有一个 timestamp。

不要：

```text
Activity timestamp
正文 timestamp
final timestamp
```

分别存在。

建立：

```text
AssistantTurnPresentation.timestamp
```

Header统一消费它。

优先从实际 durable/runtime lineage得到稳定时间：

- turn/activity的权威起始时间
- 已持久化 activity event / interaction时间
- canonical message时间作为 fallback

pending pre-runtime可以有 client start timestamp。

一旦 turn已经向用户显示时间，runtime → canonical handoff过程中不得突然更换。

刷新页面后应从 durable数据重建出同一语义 timestamp。

如果当前 durable数据确实无法保证 live/reload timestamp一致：

**先证明缺口，再添加最小必要 durable字段。**

不要靠内容/秒数 heuristic凑。

# Stable presentation identity

这是本任务最重要的部分。

需要区分：

```text
durable canonical ID
```

与：

```text
stable UI presentation ID
```

不能为了 UI稳定篡改 canonical ID。

## Existing canonical turn

普通历史/canonical assistant：

```text
stableID = canonical message lineage
```

## New send

发送按钮按下：

```text
operation UUID
```

立即创建：

```text
stable user row
stable assistant turn row
```

prepare完成后已有真实：

```text
prepareId
requestId
userMessageId
```

`NativeLivePrepareResult` 当前已经提供：

```text
prepareId
requestId
conversationId
userMessageId
```

利用这些真实 lineage。

不要靠：

- 文本相等
- 时间接近
- “最新一条 assistant”
- title
- ordinal猜

把：

```text
operation UUID
→ prepareID
→ canonical userMessageID
→ canonical assistantMessageID
```

绑定为同一个 presentation lineage。

SwiftUI visible row的 `id` 不得随着这些 backing ID变化。

## Recovered runtime

App重开时没有 pending operation，但有：

```text
prepareID
```

则：

```text
stable turn identity = prepare lineage
```

canonical assistant到达以后通过：

- `activity.prepareId`
- parent user lineage

绑定到同一 row。

禁止再造：

`recovered-runtime-assistant-*`

这种独立 UI owner。

# RuntimeSurface lineage

当前：

```swift
NativeLiveRuntimeSurfaceState
```

只有：

```text
prepareID
conversationID
events
interactions
controls
...
```

可以根据真实 prepare/active-turn response，在客户端模型中补足有用 lineage，例如：

```text
requestID?
userMessageID?
operation?
```

只做 client presentation lineage。

不要为此修改 provider协议或伪造字段。

Recovered active turn本身也已经有：

```text
prepareId
requestId
userMessageId
operation
```

应充分利用。

# Conversation assembler

`NativeLiveMessageSurface` 不再手工插 row。

建立一个明确 assembler/reconciler：

例如：

```swift
NativeLiveConversationPresentationAssembler
```

输入：

```text
snapshot
historySnapshot
pendingOperation
runtimeSurface
backgroundRuntimeSurfaces
sync state
turn identity bindings
```

输出：

```text
[NativeLiveConversationRowPresentation]
```

SwiftUI只：

```swift
ForEach(rows)
```

禁止 View内部出现：

```text
如果 replacement 就额外插 runtime row
如果 pending 就额外插 runtime row
如果 recover 就再额外插 runtime row
```

# 必须删除的现有多-owner结构

重构后以下概念不应继续作为独立 UI绘制路径存在：

```text
showPendingReplacement
replacementRuntimeSurface
activityRuntimeSurface
canonicalRuntimeAssistantID
pendingAssistantMessageID
recovered-runtime-assistant row
pending-assistant row
assistantContent.hidden() replacement ZStack
```

`NativeLiveRuntimeAssistantRow` 不得继续由 `NativeLiveMessageSurface` 独立插入。

可以删除它，或者只保留成 unified assistant row内部的低层组件。

但它不能再拥有自己的 conversation row identity。

# 正文

正文只有一个 logical body。

不要：

```text
runtime body
+
canonical body
```

同时存在。

规则：

## Streaming

partial持续更新：

```text
turn.body
```

同一个 body presentation增长。

## Final runtime

final runtime text只是确认/更新同一个 body。

## Canonical arrival

如果 canonical text与当前 body相同：

```text
只换 backing
视觉完全不变
```

如果 canonical authoritative text不同：

```text
原 row内一次 reconcile
```

禁止：

- append两遍
- 短暂同时显示 runtime + canonical
- 清空后重新画
- 新 row替代旧 row

# Presentation namespace

E/G 的 VisualNode ID目前可能由 source block namespace影响。

本轮要保证：

```text
runtime body
→ canonical body
```

时 rich children也尽量保持稳定 UI identity。

尤其：

- Markdown
- code
- table
- diff
- Math
- Mermaid

不能因为 canonical source block ID变了就无谓重建整个 visual tree。

可以增加独立：

```text
presentation namespace
```

用于 UI child identity。

但必须同时保留真实：

```text
canonical block ID
source block
provenance
citation relation
```

不要为了 UI稳定覆盖 durable source identity。

# Send

发送后立即：

```text
optimistic user row
assistant pending row
```

位置固定。

assistant从第一帧显示：

`Thinking…`

之后：

```text
Thinking…
→ Thinking for Ns
→ Working for Ns · n steps
→ Worked...
```

正文就在这一条 row里增长。

不能等 runtime出现以后再创建第二条 assistant。

# Optimistic user row

新 user message也必须稳定。

当前：

```text
pending-user-UUID
```

之后 canonical `userMessageId` 到达会变成另一 row。

本轮解决。

prepare response已有真实：

```text
userMessageId
```

bind：

```text
pending user stable row
↔ canonical userMessageId
```

canonical arrival只换 backing。

位置、voice展开状态、attachment layout不重置。

# Retry

Retry点击以后：

原 user message不复制。

目标 assistant所在 slot进入：

```text
regenerating
```

同一个 replacement slot里：

```text
Thinking…
→ runtime body
→ canonical body
```

旧 assistant属于旧 branch/history。

**当前 path不能同时显示旧答案和新答案。**

禁止：

```text
旧 assistant还在原位
+
下方新 pending assistant
```

也禁止用：

```text
old assistant.hidden()
+
runtime overlay
```

模拟替换。

应在 presentation assembler层直接产生一个 replacement row。

# Edit

这是明确 blocker regression。

当前已知实际 bug：

编辑一个历史 user message并确认后：

- 被编辑消息上方/下游的旧 assistant仍在原位出现一份；
- 同一个 assistant又瞬间出现在即将生成新回复的位置；
- 不到一秒后才恢复。

**本轮必须结构性消灭。**

Edit确认：

1. 目标 user bubble原地变成新文本。
2. 该 branch后续旧 current-path rows被 presentation层原子替换为新的 branch presentation。
3. 新 assistant replacement slot立即出现在正确位置。
4. 全程同一个逻辑 replacement assistant只能有一个 visible row。
5. 新 runtime在该 row原地增长。
6. canonical到达只切 backing。
7. 旧 branch仍保留 backend/history，但不能短暂混进 current path。

不要通过 `hidden()` 留一个重复 row占位。

如果删除旧 downstream branch会影响 viewport：

**解决 scroll anchoring，不要靠渲染一份隐藏旧 branch。**

# Edit viewport

编辑较早消息时可能大量 downstream row离开 current path。

要求：

```text
presentation更新 + scroll anchor preservation
```

作为一次原子 UI transition。

不能：

- 先删半屏
- viewport跳动
- 再插 pending row

目标是当前肉眼参照位置尽可能不变。

# Edit失败

如果 backend edit失败：

恢复旧 canonical branch presentation。

不能留下：

- 半个 optimistic edit
- orphan pending assistant
- duplicate branch

composer恢复现有输入语义。

# Voice Edit

保持 #812：

voice user message被键盘 Edit以后：

```text
新 canonical = ordinary text
```

不能继续携带 voice identity。

但 Edit期间 row稳定规则同样成立。

# Activity统一进 turn

`NativeLiveTurnActivityProjection`可以保留并继续拆职责。

但最终应该成为：

```text
AssistantTurnPresentation.activity
```

不能再由：

```text
canonical message自己算一份
runtime row自己算一份
background surface再覆盖一份
```

View层做选择。

Turn reconciler负责合：

```text
durable Activity
+
foreground runtime overlay
+
background runtime overlay
```

# Activity child identity

以下稳定 ID继续是 authority：

```text
tool_use_id
task_id
interaction_id
question identity
permission interaction_id
```

Running → Done不是新 item。

Question Pending → Answered不是新 item。

Permission Pending → Allowed/Denied不是新 item。

Task Running → Completed不是新 item。

重复 runtime event必须去重。

# Tool

同一个：

`tool_use_id`

从：

```text
Running
```

原地变：

```text
Done
```

或：

```text
Failed
```

不能：

```text
Running card disappear
→ new Done card appears
```

如果 tool_result重复到达：

只更新同实体。

# Permission

Permission属于对应 tool。

结构：

```text
Tool
└ Permission
```

pending：

```text
Permission · Needs input
```

resolve后：

```text
Permission Allowed
```

或：

```text
Permission Denied
```

永久保留在该 tool下面。

不能 answer后消失。

# AskUserQuestion

继续保持 #813 durable contract。

pending：

可操作卡。

answered：

原 item：

```text
Asked user · Answered
```

答案可查看。

不能：

```text
pending question
→ 删除
→ 新历史 row
```

视觉上必须是同一个实体原地状态升级。

# Task / background

Task：

```text
Running
→ Completed / Failed
```

保持 ID。

如果 foreground assistant已经完成，但后台 Task还跑：

Header：

`Working in background · n steps`

正文仍留在同一 assistant row。

background surface通过：

```text
prepareID
```

overlay到原 canonical assistant。

绝不能生成一个新的 background assistant row。

background结束以后：

同 row Activity更新。

# Activity折叠状态

当前：

```swift
@State private var isExpanded
@State private var expandedForPendingInteraction
```

绑在 `NativeLiveTurnActivityView`生命周期上。

runtime/canonical row replacement就可能重置。

改成按：

```text
stable turn ID
```

管理 UI state。

例如：

```swift
NativeLiveMessageUIStateStore
```

至少保存：

```text
activityExpansion
voiceTranscriptExpansion
```

## Permission / Question auto-expand

pending input到达：

自动展开到需要操作的位置。

但需要区分：

```text
autoExpanded
userExpanded
userCollapsed
```

如果用户手动展开过：

后续：

- 正文 streaming
- tool result到达
- pending解决
- runtime → canonical
- background更新

都不得偷偷折叠。

只有纯自动展开、用户从未干预时，pending解决后才可以按既定策略恢复。

# Voice展开状态

voice transcript展开状态必须按 stable user row identity保存。

optimistic → canonical不能收起。

refresh不能因为 body backing换了突然收起。

# Question / Permission sheet

打开详情 sheet后：

- runtime继续更新
- interaction resolve
- canonical handoff

回来不能造成 message row重新创建或 scroll跳动。

# Copy

Copy只复制：

```text
Claude正文 canonical/logical body
```

不复制：

- timestamp
- Thought / Worked
- tool
- task
- Permission
- Question
- buttons
- status labels

没有正文：

不要显示假的 Copy。

runtime body存在时可以复制当前可见正文。

canonical arrival后 copy target无重复。

`Message copied` feedback继续可以是 overlay。

但：

- 不改变 row高度
- 不改变 activity expansion
- 不改变 scroll position

copy feedback按 stable turn ID，而不是只绑 transient canonical ID。

# Retry button

只有逻辑 assistant turn有可重试 parent user时显示。

runtime pending assistant尚无可重试语义时不要造一个假的 Retry。

canonical handoff不能让按钮闪现两次。

# Error

runtime error：

已经生成的：

- body
- tool
- task
- question history

全部保留。

同 row Header变：

`... · Failed`

禁止整条 message消失。

网络 runtime polling失败属于 fail-soft：

现有内容继续显示。

不要把 observation fetch failure理解为 turn failure。

真正 terminal provider/backend failure才标 failed。

# Cancellation / interruption

Interrupt/cancel以后：

保留已有正文和 Activity。

同 row进入 terminal/cancelled-compatible presentation。

不要删 message再依赖 refresh恢复。

如果当前产品没有独立 Cancelled header，可以沿用现有最终状态设计，但必须 fail-visible且不丢内容。

# Runtime recovery

App切前后台 / reopen conversation：

如果 backend还有 active prepare：

```text
recoverActiveNativeLiveTurn()
```

只能重新建立同一个：

```text
prepareID turn overlay
```

不能再 append：

`recovered-runtime-assistant-*`

UI row。

canonical已经存在时：

runtime recovery只 overlay Activity/body需要的增量。

# Refresh

已有：

```text
nativeLiveCurrentPath
```

时 refresh必须 stale-while-revalidate：

```text
旧 snapshot继续显示
→ 后台取新数据
→ reconcile
```

不能：

```text
snapshot=nil
→ blank/loading
→ snapshot回来
```

当前 `refreshNativeLiveCurrentPath` 已经多数情况下保留 existing snapshot。

不要倒退。

Transient refresh failure：

已有 snapshot继续显示。

只有：

```text
完全没有任何可用数据
+
明确加载失败
```

才显示 Retry/error surface。

# Initial load

进入已有 conversation：

如果 AppModel已有 snapshot：

第一帧直接显示。

不要先：

`Nothing here`

再跳消息。

如果真正首次获取：

安静 loading。

`Nothing here`只能在：

```text
ready
+
确认 canonical/history 都为空
```

时出现。

# Current path与History

Fork divider保持唯一。

Edit / Retry branch切换不能：

- 重复 divider
- 把旧 branch瞬间混进新 current path
- history/current row IDs冲突

旧 branch只属于 History。

# Pagination / prepend

加载更早消息：

```text
olderMessages + latest.messages
```

数据层可以继续。

UI必须做 viewport anchor preservation。

开始分页前记录：

```text
top visible stable row
+ relative offset
```

prepend以后恢复。

肉眼位置不变。

禁止加载一页以后页面突然向上/向下跳几十条。

# Scroll state machine

当前 scroll逻辑有一个结构问题：

`isAwayFromBottom`

只在 user interaction active时真正更新。

content自己增长时：

```text
latestAwayFromBottom
```

可能变了，但按钮状态没有同步。

这会造成“回到底部”按钮异常消失/不出现。

本轮一起收口。

建议明确拆：

```text
isNearBottom     // geometry truth
followLatest     // 是否自动跟随
userIsInteracting
```

Geometry永远更新 `isNearBottom`。

不能只有拖动时才更新。

# Auto-follow

用户在底部：

new body / tool / row height增长可以继续跟随。

用户已经向上看：

任何：

- partial
- tool event
- canonical arrival
- background update
- refresh

都不能抢 scroll。

只显示：

“回到底部”按钮。

点击按钮：

恢复 followLatest。

点击页面空白：

**不得让按钮消失。**

Context menu开关：

不得让按钮消失。

sheet回来：

不得改变 follow state。

# Send初始scroll

用户主动发送新消息：

可以主动滚到底部一次。

之后如果用户手动向上滑：

runtime events不能继续强制拉回底部。

当前：

```swift
.onChange(runtimeSurface.events.count)
→ pendingOperation != nil
→ scrollToBottom
```

这种逻辑必须删除/替换。

# Row layout stability

禁止为了 canonical handoff做：

- `.transition` 整 row
- `.id(canonicalMessageID)` 切换
- hidden duplicate row
- remove+insert同逻辑 turn

同 turn内容更新应该是：

```text
same row
same stable ID
field update
```

# Rich/G renderer稳定

A–G所有 presentation仍要工作。

尤其 G：

- Display Math
- Mermaid
- SVG

runtime → canonical时不能因为外层 row identity替换而无谓重建。

Mermaid streaming source本身变化时可以 rerender。

但：

```text
final runtime source == canonical source
```

时不要因为 canonical backing改变而重新生成一套 visual row。

# Attachment

User message attachment：

optimistic → canonical：

同 user row。

不要附件先显示一份，canonical后重新生成另一份。

保留 C：

- attachment entity
- verified cache
- media state
- gallery
- SVG
- file preview

本轮不重构 C downloader。

Attachment state更新不得改变 message row identity。

# MindWrite / Album indicators

这些属于 assistant row附属 presentation。

canonical稳定以后正常刷新。

它们的异步 arrival：

- 不得替换 assistant row
- 不得重置 Activity expansion
- 不得抢 scroll

# Architecture建议

可以按实际实现调整，例如：

```text
Chat/
├ NativeLiveMessageSurface.swift
├ NativeLiveConversationPresentation.swift
├ NativeLiveConversationPresentationAssembler.swift
├ NativeLiveTurnIdentityCoordinator.swift
├ NativeLiveMessageUIStateStore.swift
└ MessageSurface/
   ├ NativeLiveAssistantTurnPresentation.swift
   ├ NativeLiveAssistantTurnRow.swift
   ├ NativeLiveTurnActivityProjection...
   └ existing renderers
```

重点是职责，不要求照抄文件名。

# View层应明显变简单

重构后 `NativeLiveMessageSurface` 应该接近：

```text
let presentation = assembler.project(...)
ScrollView {
    ForEach(presentation.rows) { row in
        rowView(row)
    }
}
```

而不是当前几十个：

```text
if pending
if replacement
if recovered
if canonical runtime
if pending assistant missing
```

这也是 review的重要判断标准。

# 不要改的东西

除非真实 blocker：

不要修改：

- A canonical identity contract
- D trusted tool-result projection authority
- E Markdown parser semantics
- G sandbox security
- attachment backend schema
- Claude bridge normalization
- Postgres schema
- provider behavior

本轮目标是：

```text
client turn lifecycle + presentation + rendering orchestration
```

不是再重建 backend。

# F继续 deferred

F仍：

`deferred`

不要借这轮实现：

- Artifact
- MCP Resource
- MCP App
- ui://

# Protected files

不要碰：

`AGENTS.md / package.json / scripts/agent-* / native-live-mac-daemon-fresh.sh / .agent/* / PR template`

除非 latest main出现不可避免冲突。

# 明确 regression：Edit重复助手消息

必须写真实 Swift / presentation regression：

给出 current path：

```text
User A
Assistant A
User B
Assistant B
```

编辑 `User B`。

在整个：

```text
pending edit
prepare received
runtime begins
partial text
tool event
canonical new branch
```

每一个 snapshot里断言：

```text
logical replacement assistant visible row count == 1
```

并断言：

```text
old Assistant B
```

绝不能同时：

```text
原位 visible
+
replacement position visible
```

**即使一个 intermediate reducer frame也不允许。**

不要做只测最终状态的测试。

# Retry重复row regression

同样逐阶段测试：

```text
canonical old assistant
→ Retry
→ pending
→ runtime
→ canonical replacement
```

始终：

```text
visible replacement assistant rows == 1
```

旧答案和新答案永不同时属于 current path。

# Send row identity regression

测试：

```text
pending operation UUID
→ prepareID
→ userMessageID
→ runtime
→ assistant canonical ID
```

visible stable IDs：

```text
user row不变
assistant row不变
```

backing IDs可以增加，但 presentation IDs不能切换。

# Runtime recovery regression

输入：

```text
canonical prefix
active turn prepareID
no pendingOperation
```

只得到一个 active assistant row。

随后 canonical assistant出现：

仍同 stable row。

不得同时得到：

```text
recovered runtime row
+
canonical row
```

# Body regression

覆盖：

1. partial `Hel`
2. partial `Hello`
3. runtime final `Hello`
4. canonical `Hello`

UI body每一步只是一份。

最终不能：

`HelloHello`

也不能：

```text
Hello
Hello
```

# Canonical mismatch

runtime final：

`Hello...`

canonical authoritative：

`Hello.`

允许一次原 row reconcile。

row stableID不变。

# Activity tests

至少覆盖：

- `Thinking…`
- `Thinking for Ns`
- `Thought for Ns`
- `Working for Ns · 1 step`
- plural steps
- `Worked`
- Needs input
- Failed
- Working in background
- no Activity/no duration = timestamp only

# Activity state tests

覆盖：

- tool Running→Done same ID
- tool Running→Failed same ID
- duplicate tool_result no duplicate
- Task Running→Completed same ID
- Permission Pending→Allowed same ID
- Permission Pending→Denied same ID
- Question Pending→Answered same ID
- answer detail retained
- background task overlay durable row
- background completion no second row

# Expansion tests

覆盖：

- default collapsed
- pending interaction auto expands
- automatically-expanded interaction resolve可按策略收回
- user manually expands后runtime update不收
- user manually expands后canonical handoff不收
- user manually expands后Question resolve不收
- tool result arrival不收
- background update不收

# Timestamp tests

覆盖：

- live row从开始只有一个 timestamp slot
- Activity + timestamp同 header
- no Activity只 timestamp
- canonical handoff timestamp不变
- refresh stable
- background update stable
- no duplicate timestamp

# Duration tests

覆盖：

- running tick
- result `duration_ms`固定
- canonical duration相同
- canonical arrival不重新计时
- refresh不重新计时
- background task不继续增加 foreground duration

# Failure tests

覆盖：

- partial body + runtime failure → body仍在 + Failed
- tool result + failure → tool仍在
- observation fetch failure不清空 row
- refresh failure有旧 snapshot继续显示
- full no-data load failure才 error

# Edit tests

覆盖：

- user text optimistic原位
- attachment retained
- attachment remove/add
- voice edit→ordinary text
- failure rollback
- downstream old branch不混入 current path
- viewport anchor stable

# Scroll tests

真实 model/UI tests至少覆盖：

- at bottom + partial → follow
- user scroll away + partial → 不scroll
- user scroll away + tool → 不scroll
- user scroll away + canonical → 不scroll
- button出现
- 点击空白按钮不消失
- context menu不改变 away state
- sheet回来不改变
- tap return-to-bottom恢复 follow
- pagination prepend viewport anchor保持
- edit/retry replacement viewport保持

不要只 grep source。

至少做 deterministic scroll-state model测试。

# Initial load tests

覆盖：

- existing snapshot + `.loading` → 仍显示 snapshot
- existing snapshot + transient `.unavailable` → 仍显示 snapshot
- nil snapshot + `.loading` → quiet loading
- ready confirmed empty → Nothing here
- failure + nil data → Retry error
- refresh不把 snapshot先设 nil

# UI state identity

覆盖：

- voice expanded pending→canonical仍 expanded
- Activity expanded runtime→canonical仍 expanded
- Copy feedback不改变高度/state
- detail sheet dismiss后state保留

# A–G regressions

必须继续跑：

- A canonical contract
- B Presentation Model
- C media
- D structured/search/citation
- E rich Markdown/code/table/diff/math parsing
- G Display Math/Mermaid/SVG sandbox
- #812 voice
- #813 Question
- #815 Activity duration
- ordinary/hidden/ambient tool activity
- background task
- current-path branch
- edit/retry
- attachment
- history/fork

# Tests要测 reducer每一个中间frame

这是本轮重点。

不要只测试：

```text
初始
最终
```

要测：

```text
pending
prepared
runtime first event
partial
tool use
tool result
interaction pending
interaction resolved
result
canonical refresh
background update
```

每一帧都检查：

```text
stable IDs
row count
visible body
activity child IDs
```

因为现有 Edit重影就是一个不到一秒的 intermediate frame bug。

# Full suite

照旧：

- focused lifecycle tests
- real Swift projection tests
- current path
- Postgres relevant regressions
- runtime gate
- complete bridge
- typecheck
- check:generated
- build
- git diff --check
- unsigned Simulator

最后：

```text
pnpm test
```

与 **exact latest-main baseline**：

同环境、同顺序比较。

PR必须报告：

```text
baseline totals
PR totals
added failure names
removed failure names
```

不能只报数量。

# 真机

本轮建议在 merge前至少做一次 targeted physical smoke，如果已有签名设备环境方便：

- Send
- Retry
- Edit
- tool call
- AskUserQuestion
- scroll up during streaming

但如果当前环境不便，code merge gate仍可以以 Simulator + real Swift state-machine tests为主。

最终 Mainline 3 physical acceptance仍：

`pending`

C media physical acceptance仍：

`pending`

G visual physical acceptance仍：

`pending`

不要误标完成。

# PR标题

`refactor: unify Claude turn lifecycle rendering`

# PR body必须明确

- exact base SHA
- exact head SHA
- root cause of previous multi-row architecture
- removed old multi-owner render paths
- new turn presentation state machine
- stable identity rules
- pending→prepare→runtime→canonical mapping
- optimistic user mapping
- Edit replacement design
- Retry replacement design
- runtime recovery
- body reconciliation
- Activity overlay/reconciliation
- timestamp authority
- duration authority
- expansion state ownership
- scroll follow model
- prepend anchor preservation
- loading/stale snapshot behavior
- failure/recovery behavior
- A–G compatibility
- test intermediate frames
- exact full-suite delta
- physical acceptance status

不要 merge。

完成后停在 PR 等待 review。

# 最终验收一句话

这轮是否成功，不看文件拆得漂不漂亮。

只看：

> **从用户点击发送 / Retry / Edit开始，到最终 canonical落盘，在屏幕上始终只有一套稳定的消息树；任何 runtime、tool、interaction、refresh、background、canonical变化都只能更新这棵树，不能再创建第二套临时消息。**