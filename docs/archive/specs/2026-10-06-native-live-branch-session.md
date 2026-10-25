# 任务：将 LeileiOS Claude 从“每轮 fork 一个 session”改为“每条 branch 复用一个 session，只有 Retry/Edit 才 fork”

仓库：`nenecaramel/leilei-os`

## 背景

当前 LeileiOS 的 Claude Agent SDK session 语义有一个历史设计问题：

- 首轮消息：`new`
- 后续普通 send：从上一轮 provider session `fork`
- Retry/Edit：同样 `fork`

因此当前实际上是：

```text
turn 1 → session A
turn 2 → fork A → session B
turn 3 → fork B → session C
turn 4 → fork C → session D
```

虽然上下文没有丢失，但每一轮都会产生新的 Claude session。

目标改成：

```text
branch 1:
new → session A
resume A
resume A
resume A

Retry/Edit 某历史节点:
fork 精确历史节点 → session B
resume B
resume B

再次 Retry/Edit:
fork 精确历史节点 → session C
...
```

即：

**一个 canonical branch 对应一个持续复用的 Claude session。只有真正产生 branch 的 Retry/Edit 才创建新的 Claude session。**

不要把任务简化成“把 fork 改成 resume”。必须同时解决历史 branch point 的精确恢复，否则会破坏 Retry/Edit。

---

## 当前已确认的代码事实

当前 runtime protocol：

```ts
export type NativeLiveRuntimeMode = "new" | "fork";
```

位置：

```text
src/domains/bridge/protocol/runtime-protocol/types.ts
```

当前普通 send 最终通过 `resolveRuntimeParent()`：

```text
src/domains/bridge/turn/turn-repository/prepare.ts
```

只要存在 parent checkpoint，就返回：

```ts
runtimeMode: "fork",
parentProviderSessionId: checkpoint.providerSessionId
```

因此普通 send / retry / edit 目前统一 fork。

Claude Agent SDK transport 本身已经具有 resume 能力。

位置：

```text
tools/claude-bridge/src/agent-sdk-claude-transport.mjs
```

已有：

```ts
resume(sessionId, prompt, ...)
fork(sessionId, prompt, ...)
```

以及底层：

```ts
resume: sessionId
forkSession: true
```

当前 provider checkpoint 已经有：

```ts
providerSessionId: string
providerCheckpointId: string | null
```

位置：

```text
src/domains/conversation/native-live-conversation-types.ts
src/domains/conversation/native-live-conversation-repository.ts
```

但 Claude foreground turn 当前基本只真正使用 `providerSessionId`，`providerCheckpointId` 没承担 message-level checkpoint identity。

---

# 目标行为

## 1. 普通连续聊天

首轮：

```text
new
→ Claude session A
```

之后所有普通 `send`：

```text
resume session A
```

成功后 provider session ID 必须仍然是 A。

不能再为每个普通 turn 创建 B/C/D。

---

## 2. Retry

假设当前 branch：

```text
U1 → A1
U2 → A2
U3 → A3
```

这些都属于 Claude session A。

用户 Retry `U2` 时：

不能：

```text
fork 最新 session A 的末尾
```

必须：

```text
定位 U2 所对应 branch point 之前的 Claude provider checkpoint
→ 从该历史 checkpoint 精确 fork
→ 创建 session B
→ 使用 U2 原 prompt 重新生成
```

然后新路径继续：

```text
session B
resume B
resume B
```

---

## 3. Edit

Edit 与 Retry 相同：

```text
定位 target user message 之前的精确 provider checkpoint
→ fork 新 session
→ 使用 edited prompt
→ 后续一直 resume 新 session
```

---

# 核心设计要求

## A. 增加 `resume` runtime mode

把：

```ts
type NativeLiveRuntimeMode = "new" | "fork";
```

改成：

```ts
type NativeLiveRuntimeMode =
  | "new"
  | "resume"
  | "fork";
```

所有 parser、schema、DB type、tests、runtime command contract 一并更新。

不要用字符串 hack。

---

## B. 普通 send 与 Retry/Edit 必须明确分流

不要继续让 `resolveRuntimeParent()` 对所有操作返回同一种 mode。

推荐语义：

### 普通 `send`

无 parent：

```text
new
```

有 parent：

```text
resume
```

### `retry`

```text
fork
```

### `edit`

```text
fork
```

### external Claude session bootstrap

第一次从外部 Claude/Claude Code session 导入 LeileiOS 时：

**继续 fork 一次。**

不要直接 resume 用户原始 Claude session，否则 LeileiOS 会修改外部原 session。

完成 bootstrap fork 后，LeileiOS branch 后续改为 resume。

---

# C. 必须建立 message-level provider checkpoint

这是整个任务最重要的部分。

如果同一 branch 一直 resume session A，那么：

```text
A1 checkpoint → session A
A2 checkpoint → session A
A3 checkpoint → session A
```

光存 `providerSessionId = A` 已经无法区分三个历史位置。

因此每次成功 assistant turn 都必须额外保存一个可以唯一定位该 Claude transcript 历史位置的 provider-level checkpoint identity。

优先复用现有：

```ts
providerCheckpointId: string | null
```

不要再新造一个含义重复的字段，除非经过代码调查证明当前字段语义不能承载。

这个 ID 应该对应 Claude Agent SDK 中可用于：

```text
从 session 内指定历史 message/turn 精确 fork
```

的 provider message/session checkpoint identity。

先调查当前安装的 `@anthropic-ai/claude-agent-sdk` 版本及其真实 API，不要根据记忆猜 API 名。

需要确认并使用当前 SDK 实际支持的：

- session 内 message identity
- resume/fork 到特定历史位置
- `forkSession(...)`
- `resumeSessionAt`
- 或当前版本等价 API

以仓库当前 lockfile / node_modules / 官方 SDK 类型定义为准。

---

# D. Finalize 时保存精确 provider checkpoint

当前 finalize success 绑定：

```ts
checkpoint: {
  provider: "claude_code",
  providerSessionId
}
```

修改为同时保存：

```ts
providerSessionId
providerCheckpointId
```

其中：

```text
providerSessionId
```

表示当前 branch 所属 Claude session。

```text
providerCheckpointId
```

表示该 canonical assistant message 完成后的 Claude transcript 精确位置。

必须保证每个成功 canonical assistant checkpoint 都能独立作为未来 Retry/Edit 的 branch point。

---

# E. Retry/Edit fork 必须使用 providerCheckpointId

当前：

```text
canonical message
→ providerSessionId
→ fork whole session
```

新逻辑必须是：

```text
canonical branch point
→ providerSessionId
→ providerCheckpointId
→ fork exact historical point
```

如果历史 checkpoint 没有 `providerCheckpointId`，不能悄悄从 session 最新末尾 fork。

需要定义兼容策略。

推荐：

老数据 / legacy checkpoint：

- 如果旧 checkpoint 对应的是旧“一轮一个 session”时代，那么该 session 本身就是那个历史位置；
- 因此可以继续使用 legacy whole-session fork；
- 新 checkpoint 必须使用 message-level fork。

需要明确判断 legacy/new checkpoint，而不是破坏现有历史聊天。

---

# F. Provider session identity invariant

必须新增/强化以下约束：

### `new`

允许产生新 provider session ID。

### `resume`

返回：

```text
providerSessionId === parentProviderSessionId
```

否则视为：

```text
PROVIDER_SESSION_CONFLICT
```

### `fork`

返回：

```text
providerSessionId !== parentProviderSessionId
```

否则同样：

```text
PROVIDER_SESSION_CONFLICT
```

现在 fork 已经有这个检查。

给 resume 加对应的反向检查。

---

# G. SessionStore 语义不能破坏

当前 Agent SDK transport 有 durable SessionStore：

- prepare portability
- markIncomplete
- markComplete
- mirror health
- backfill
- durable transcript restore

特别注意当前：

```ts
mode === "resume"
```

已经有额外的 mutable-session SessionStore 处理。

说明 transport 本身实际上已经为 resume 做了部分基础设施。

需要完整审查：

```text
#prepareSessionForTurn()
#completePortability()
sessionStore.markIncomplete()
sessionStore.markComplete()
```

确保正常连续 resume：

```text
complete
→ mark incomplete before mutation
→ resume
→ mirror
→ mark complete
```

仍然正确。

不能因为 session ID 不再每轮变化而破坏 durable portability。

---

# H. Provider checkpoint cleanup 不能误删共享 session

这是高风险点。

当前旧模型：

```text
一个 checkpoint ≈ 一个 Claude session
```

新模型：

```text
多个 canonical checkpoints
→ 同一个 Claude session
```

因此现有 provider session cleanup / Retry/Edit branch purge / hard-delete session 逻辑必须全面审计。

重点检查：

```text
src/domains/bridge/provider-session/**
native live provider session cleanup
Retry/Edit purge
conversation delete
branch cleanup
```

必须保证：

如果被 purge 的历史 canonical checkpoint 和存活 checkpoint 共用同一个：

```text
providerSessionId = A
```

绝不能因为删掉一个 checkpoint 就删除整个 session A。

只有确认一个 provider session 已经没有任何 surviving canonical/checkpoint/bootstrap reference 时才能 hard-delete。

现有代码已有“protect shared provider sessions”相关逻辑，但必须为“同 branch 多 checkpoint 共享同一 session”增加测试。

这是本任务最高风险之一。

---

# I. Mind / context lineage 不能绑定 provider session ID

当前 `docs/mind.md` 已明确：

context lineage 应按 canonical checkpoint lineage 工作，而不是依赖 provider session ID。

保持这个原则。

普通 send 改成 resume 后：

```text
多个 canonical checkpoint
→ 同一个 provider session
```

Mind lineage 必须仍然：

- 每轮独立 checkpoint
- Retry/Edit 回滚到正确 canonical lineage
- Thought alias / seen IDs / cumulative lineage 正常
- compact epoch 正常

不要为了 session 重构重新把 Mind 绑回 provider session。

---

# J. Manual compact

当前 `/compact` 是对 provider session 做 resume。

改完后：

- compact 不应创建新 session
- compact 后 providerSessionId 保持不变
- canonical context lineage compact epoch 行为保持现状
- providerCheckpointId 如何在 compact 后更新必须明确

如果 compact 会改变 transcript 的可寻址历史结构，需要写测试确认 Retry/Edit 老 checkpoint 是否仍可 fork。

不要假设。

---

# K. Silence wake / routines / background turn

审计所有使用：

```text
runtimeMode
parentProviderSessionId
fork
resume
```

的非 foreground send 路径。

重点：

```text
silence wake
native schedule/routines
manual compact
external bootstrap
```

不要机械地全部改 resume。

原则：

- 对当前 branch 的正常线性延续：resume
- 真正需要隔离/branch：fork
- 不应污染用户 foreground session 的后台流程：按现有产品语义决定，先调查再改

如果 silence wake 的可见 assistant message属于当前 canonical branch 的正常延续，可以 resume；如果它需要 speculative isolation，则先证明再保留 fork。

---

# L. 不要改变 canonical product truth

LeileiOS canonical conversation/message tree 仍然是产品真相。

Claude session 只是 provider execution state。

不要把 UI/history 改成读取 Claude transcript。

不要因为复用 session 删除：

- canonical messages
- canonical checkpoints
- branch structure
- Retry/Edit purge semantics
- Mind lineage
- attachments/activity

---

# 建议重点检查文件

至少覆盖：

```text
src/domains/bridge/protocol/runtime-protocol/types.ts

src/domains/bridge/turn/turn-repository/prepare.ts
src/domains/bridge/turn/turn-repository/finalize-success.ts

src/domains/bridge/mac/native-live-mac-runtime-executor.ts
src/domains/bridge/mac/native-live-mac-claude-transport.ts

tools/claude-bridge/src/agent-sdk-claude-transport.mjs

src/domains/conversation/native-live-conversation-types.ts
src/domains/conversation/native-live-conversation-repository.ts

src/domains/bridge/provider-session/**

src/domains/bridge/turn/native-live-replacement-purge.ts
src/domains/bridge/turn/turn-repository/cleanup.ts

src/domains/bridge/turn/native-live-manual-compact.ts

src/domains/bridge/turn/native-live-silence-wake.ts

tests/**
tools/claude-bridge/test/**
```

以及所有：

```bash
rg '"new" \| "fork"|runtimeMode|runtime_mode|parentProviderSessionId|providerCheckpointId|forkSession|resume\('
```

匹配。

---

# 必须补的测试

至少证明以下行为。

## Test 1 — first send

```text
no parent checkpoint
→ runtime_mode = new
```

---

## Test 2 — ordinary second send

第一轮返回：

```text
session A
checkpoint cp1
```

第二条普通 send：

```text
runtime_mode = resume
parent_provider_session_id = A
```

执行后：

```text
provider_session_id = A
```

不得产生 session B。

---

## Test 3 — many ordinary sends

连续 5 个 send：

```text
A → A → A → A → A
```

所有 canonical assistant message：

```text
providerSessionId = A
```

但必须拥有不同/正确的：

```text
providerCheckpointId
```

---

## Test 4 — Retry exact historical point

```text
A:
turn1 cp1
turn2 cp2
turn3 cp3
```

Retry turn2：

必须：

```text
fork session A at correct historical provider checkpoint
→ session B
```

不能包含 turn3 的 provider history。

---

## Test 5 — Edit exact historical point

与 Retry 同样验证。

---

## Test 6 — continuation after Retry

Retry 创建：

```text
session B
```

之后普通 send：

```text
resume B
```

不得：

```text
fork B → C
```

---

## Test 7 — legacy checkpoint compatibility

旧 checkpoint：

```text
providerSessionId = legacy-X
providerCheckpointId = null
```

Retry/Edit 仍能按旧语义 fork whole legacy session。

不能让旧聊天失效。

---

## Test 8 — cleanup shared session safety

多个 canonical checkpoints：

```text
cp1 → session A
cp2 → session A
cp3 → session A
```

purge cp2/cp3 某条 branch 时，只要仍有 surviving reference 指向 A：

```text
deleteSession(A)
```

绝不能被调用。

---

## Test 9 — branch session cleanup

当 session B 所属整条 replacement branch 被彻底 purge 且无 surviving reference：

```text
session B
```

最终应该仍可进入现有 cleanup queue 并被安全删除。

---

## Test 10 — SessionStore resume health

证明：

```text
complete
→ resume
→ incomplete during mutation
→ complete after successful mirror
```

健康状态正常。

---

## Test 11 — resume session identity conflict

如果 SDK resume 意外返回：

```text
B != parent A
```

必须失败：

```text
PROVIDER_SESSION_CONFLICT
```

---

## Test 12 — fork identity conflict

保留现有：

```text
fork returns same session
→ PROVIDER_SESSION_CONFLICT
```

---

## Test 13 — compact

compact 前后：

```text
session ID unchanged
```

且 compact 后下一条普通消息继续：

```text
resume same session
```

---

## Test 14 — external Claude bootstrap

从外部 session：

```text
external X
```

首次进入 LeileiOS：

```text
fork X → A
```

之后：

```text
resume A
resume A
```

绝不能直接修改 X。

---

# 验证要求

严格按仓库 `AGENTS.md`。

先：

```bash
git fetch origin
pnpm agent:status
pnpm agent:verify --plan
```

先写 targeted failing tests，记录 RED。

实现后记录 GREEN。

至少运行：

```text
runtime protocol tests
backend turn repository tests
backend turn coordinator tests
Agent SDK Claude transport tests
provider session cleanup tests
Retry/Edit replacement purge tests
Mind lineage relevant tests
manual compact tests
silence wake tests
```

然后按 `agent:verify --plan` 给出的相关 gates 执行。

如果本机无法执行某些测试，要明确写“未执行”，不能假装通过。

---

# 交付格式

完成后报告：

1. 当前旧行为为什么是一轮一 session。
2. 新 session lifecycle。
3. providerCheckpointId 具体存的是什么。
4. Retry/Edit 如何精确 fork 历史位置。
5. legacy checkpoint 如何兼容。
6. cleanup 如何避免误删共享 session。
7. compact / external bootstrap / silence wake 如何处理。
8. 修改文件列表。
9. RED → GREEN 测试证据。
10. 尚未执行的验证。
11. commit SHA。
12. PR 链接。

---

# 禁止事项

- 不要只把普通 `fork` 改成 `resume` 就结束。
- 不要破坏 Retry/Edit 历史 branch accuracy。
- 不要删除旧聊天兼容能力。
- 不要把 canonical history 改成 Claude transcript。
- 不要让多个 checkpoint 共用 session 后触发错误 hard delete。
- 不要顺手重构无关代码。
- 不要修改 UI，除非 protocol 类型变化导致必要适配。
- 不要改变用户可见聊天行为。
- 不要自动 merge。
- 不要自动部署。
- 不要运行 production migration。
- 不要修改生产环境。
- 不要创建长期额外 clone/worktree。
- 不要猜 Agent SDK API；先读当前安装版本的类型/源码。

---

## 最终验收标准

在一个全新的 LeileiOS Claude conversation 中连续发送多条消息后，Claude provider session 应始终只有一个 active branch session：

```text
A → resume A → resume A → resume A
```

只有用户执行 Retry/Edit 时才产生：

```text
fork historical checkpoint → B
```

之后新 branch：

```text
B → resume B → resume B
```

并且旧 branch point、Retry/Edit、Mind lineage、SessionStore、compact、external bootstrap、provider cleanup 全部保持正确。
## 已确认的补充与调查

- 用户已明确接受：legacy checkpoint 的首次普通续聊 fork 一次，之后 resume；不得 mutate 旧的 whole-session branch point。
- 调查基线：`41bf880f24a5d42dd48fb39603c47080b3ec75bd`。
- 当前实际安装的 SDK：`0.3.286`，有 `resumeSessionAt` 和 `forkSession(sessionId, { dir, upToMessageId, sessionStore })`。
- 实际 SDK 内存 SessionStore 实验已证实：指定第一轮 UUID fork 会排除后续轮；源 session 不变；缺失 UUID 报错。该实验不调用模型，不代表真实 compact 已验证。
- silence wake 当前在 finalize 时检查源 head，并允许 stale wake 被丢弃：这是 speculative isolation，保留 fork，成功后 canonical 新 head 的普通 send resume 新 session。
- DB 仍有只允许 new/fork 的 CHECK；只能新增兼容 migration，不改已发布 migration，不执行 production migration。
- canonical checkpoint 和 provider transcript UUID 是不同 identity，Mind lineage 仍使用前者。
