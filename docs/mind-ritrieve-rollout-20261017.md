# Mind Hook — 本地 ritrieve 中文语义检索改造

> 实现分支：`codex/mind-ritrieve-staged-20261017` / PR #1142。实现并不等于线上验收。
> **生产默认仍是 E5 旧流程；该草稿 PR 未合并，不修改任何已有 Memory。**

## 改造后目标

每条非空用户消息进入 `UserPromptSubmit` Hook。Mac 常驻进程定时读取经 Railway 鉴权的**当前有效、全局可见且可召回**的 Mind Memory，用 `richinfoai/ritrieve_zh_v1` 预先建立本机内存向量索引。消息到达时在本机计算查询向量，从**全库**找出相关候选，再向 Railway 请求**一次**；Railway 重新按当前实时数据、版本、用户/subject、路径去重校验，仍使用原签名回执。最终可返回 0～4 条，避免为了凑够数量塞不相关记忆。只处理被授权的 Memory，不会无条件召回已删/隐藏/无效记录。

遇到“你又这样了”等依赖语境的短句，Hook 在证明当前 transcript 链有效的情况下，附带最近两条用户消息帮助检索；不把弃用的 rewind 分支内容作为语境。

## 已提交的代码阶段

| 阶段 | 已提交 | 未验收 |
|---|---|---|
| 1：模型更换 | 本机 Python SentenceTransformers worker，独立安装、模型预热、向量缓存；现有 E5 默认保留 | Mac 已安装 Python 3.12 与真实模型；96 条合成记忆 P95 165.5ms，尚欠全库量测 |
| 2：一次网络请求 + 全库索引 | 鉴权 GET `/internal/mind/snapshot`，128/页，版本一致性检测；Mac 60s 只读刷新、原子替换内存向量索引；Hook `indexed_v1` 先查 UNIX socket 再请求一次 Railway | 真实环境端到端测试、30k 条上限与长尾性能 |
| 3：相关性与安全 | 当前链短句语境、local top-48、绝对阈值 0.68 + 长列表分布阈值、服务器当前快照哈希与权限复核、无关零条、旧索引回退 | 阈值必须根据真实 Memory 标注集校准，不能把 0.68 当最终最佳值 |
| 4：回归与对照 | 新增快照、索引、Hook 网络次数、鉴权、隐藏/失效记忆及脱敏指标测试；本地离线比较脚本 `scripts/evaluate-mind-embedding.ts` | Mac `pnpm typecheck`、Mind 专项 48/48、生产门禁 355/355 已通过；GitHub CI 与真实 E5/ritrieve 质量对照尚欠 |

全库索引只在 Mac **内存中**，daemon 重启重新同步；Python worker 不上传记忆到远端模型服务，不将查询/Memory 写日志。当前缓存容量 30k 条、每条用于 embedding 的前 2000 字符，超限/同步失败会退回旧 lexical 召回（不会越权注入）。

## 安装与开启（仅在测试/验收通过后）

1. Railway 先部署新的认证只读快照 API 和当前快照验证逻辑；这一阶段没有 DB migration。
2. Mac 从经审核的 PR 更新本地 checkout，运行 `pnpm setup:runtime-breath-ritrieve`，对公开模型进行本地 smoke test。
3. 在 **Mac daemon 环境**里设置 `LEILEI_MIND_EMBEDDING_PROVIDER=ritrieve`，重启 daemon，让模型预热和私有内存索引同步；确认本机 UNIX socket `/search` 能以当前版本返回候选。
4. 更新 Mac 安装的 Claude Hook（`node tools/claude-code-mind/install.mjs leileios`）；在用户私有的 `~/.claude/leileios-mind/mind.env` 设置 `LEILEI_MIND_RECALL_MODE=indexed_v1`。可选 `LEILEI_MIND_DIAGNOSTICS=1` 仅记录固定原因码（无明文）。
5. 仅在固定用例、数据库/Hook 分支回归、真实 Mac 性能和标注集质量门槛通过后才在日常使用中开启。

**回滚**：移除 Hook `LEILEI_MIND_RECALL_MODE` / Mac daemon `LEILEI_MIND_EMBEDDING_PROVIDER` 并重启 daemon，即恢复原 E5 和原 Hook 路径。原记忆不需要迁移或恢复。

## 必须达到的验收条件

- 用相同的真实、经本人授权的离线测试集同时测 E5 和 ritrieve：`Recall@4`、错误注入比例、无关问题正确空结果比例。
- 将实际冷/热状态、20/100/5000 条 Memory、p50/p95 Hook 耗时与超时/降级率量化；**不得**承诺每轮 <3.8s，除非实测达成。
- Mac 本地索引版本过期、失效/隐藏记忆、当前分支已交付的 ID、写入同轮/compact/rewind、signed receipt/Stop、空结果均要正确；不能放松服务端权限和 receipt 保护。
- 编译、focused tests、full CI、孤立数据库回归成功（不可用时要说明），在 CI 失败前保持 PR 为 Draft。
- `scripts/evaluate-mind-embedding.ts` 只接受用户本地路径中的私人标注 JSON，不自动从生产数据库抓数据，不提交明文样本；控制台只输出聚合指标。

**当前状态（2026-10-18）**：Mac 已安装并使用真实 ritrieve 模型（1792 维），96 条合成记忆 warm-query P95 165.5ms；本机 `pnpm typecheck`、Mind 专项 48/48、生产运行时门禁 355/355 曾通过，后续 staging 实验脚本提交需重新检查。Railway **独立项目**部署了独立 Postgres 和测试 API，HTTP 合成快照/鉴权/服务端评分/空评分/隐藏隔离均通过；Mac 上真实模型→测试库快照→认证 Railway recall 联调可达，实测 2 个正例均命中，隐藏记忆未泄露。**相关性验收仍失败：无关的“太阳系里有哪些行星”分数 0.7487，超过当前小样本 0.68 阈值，被错误召回**。因此不能宣称零无关召回，也不能启用生产 `indexed_v1`。新增完全离线的 `scripts/mind-ritrieve-negative-calibration.ts`，用 20 个正例和 20 个负例对同样 2 条**虚构记忆**做多个阈值探索，已在用户 Mac 执行成功（详见下节）；合成结果不能代替真实已授权标注集、全库 p95 与误注入率。PR 仍 Draft，生产配置和已有记忆未改动。

## 离线合成相关性校准（用户 Mac 实测，2026-10-18）

`pnpm typecheck` 通过。运行 `pnpm exec tsx scripts/mind-ritrieve-negative-calibration.ts`，对两条人工合成记忆、20 条正例和 20 条负例分别计算本机真实 `ritrieve_zh_v1` 得分。该测试**仅在本机**运行，不使用任何真实用户 Mind、Railway 或 Token。共 40 条查询，模型预热 5353ms、两条索引 146ms、单查询 p50=26ms、p95=32ms（另有单次 351ms 尾部异常值，样本很小）。

| 绝对下限 | 正例 Top1 | 负例正确空结果 | 负例错误召回 | 正例错误附带记忆 |
|---|---:|---:|---:|---:|
| 0.68（当前） | 20/20 | 8/20 | 12 | 3 |
| 0.72 | 20/20 | 15/20 | 5 | 0 |
| 0.74 | 20/20 | 16/20 | 4 | 0 |
| 0.76 | 20/20 | 18/20 | 2 | 0 |
| 0.78 | 19/20 | 19/20 | 1 | 0 |
| 0.80 | 16/20 | 20/20 | 0 | 0 |
| 0.82 | 14/20 | 20/20 | 0 | 0 |
| 0.84 | 10/20 | 20/20 | 0 | 0 |
| 0.86 | 5/20 | 20/20 | 0 | 0 |
| 0.88 | 2/20 | 20/20 | 0 | 0 |

观察：`negative_17`（蛋糕烤箱预热）与「面包面团发酵」同属烘焙但不是同一记忆，最大分 0.7635；`negative_18`（“我们刚才讨论过的是什么”）依赖当前链语境，错误匹配到 0.7953。相关正例最低 0.7787（“老是说到做不到怎么办”）。因此在这些合成样本上不存在一个绝对阈值能同时保留全部 20 条正例并清除全部 20 条负例。**只提高阈值不满足既不漏召回也不误注入的质量目标。**

下一步：以用户授权的本地真实 Memory 标注测试集评估 E5 与 ritrieve（包括主题相近却不该召回、依赖当前链上下文的 hard negatives），量化召回/错误注入与阈值/排序策略；另测至少 20/100/5000 条规模的端到端 p95。不能从两条合成记忆外推全库质量或性能。**不自动切换生产阈值、Hook 或 daemon；PR 保持 Draft。**

## 真实 Mind 的改前／改后离线对照（待 Mac 执行）

已添加 `scripts/mind-real-before-after.ts`，直接读取由 LeileiOS **Settings → Data → Export → Create Full Backup → Share Export** 导出、保存在用户 Mac 本地的 v4 完整备份 JSON。

```zsh
cd /tmp/leileios-mind-1142
git fetch origin codex/mind-ritrieve-staged-20261017
git switch --detach FETCH_HEAD
pnpm typecheck
pnpm exec tsx scripts/mind-real-before-after.ts "$HOME/Downloads/leileios-full-backup_替换为实际时间.json"
```

如 E5 本机旧依赖缺失：仅在用户 Mac 运行 `pnpm setup:runtime-breath-e5`，再重试。本脚本不会读取生产环境 Token、数据库或调用 Railway；E5 的运行库若已存在但模型权重未缓存，可能下载公开模型权重，**不会向模型服务上传私人文本**。绝对不要将 Full Backup、Memory 文本或包含文本的 JSON 发送给 ChatGPT/GitHub。

脚本使用后端相同的 `snapshotMemories` 合格性筛选：仅 subject `G`、全局、已提交/已呈现、已结算、有效、当前且非 `hidden_system` 的 Memory；其他记录不参加。相同的最多 96 条（可加 `--limit=128`，上限 256）候选内，直接用**原始 E5 模型**的 `score` 与**新的 ritrieve 索引**对照；两个模型在各自预热和语料编码之后统计热查询延时。输出只包含数量、弱标注命中率、对普通探针的空结果比例和 p50/p95，不输出私人正文或 ID。

自动测试问题分为三组：①从 Memory 的来源消息反向追溯到当前路径的用户消息，形成**弱标签**（最多 16 条），与生产真实相关性标签不同，可能为零；②直接使用 Memory 原文做 8 条**自引用控制**，只是管线健康检查，不是真实泛化能力；③8 个普通查询，只统计是否返回空结果，**不知道实际是否相关**，不能算准确的无关负例。不会调用云端 LLM 自动判断私人相关性。只有人工/用户确认为真实相关或无关的独立标注测试集，才能严肃衡量 `Recall@4` 和错误注入率。

**重要界限：**这是相同采样候选上的 E5 与 ritrieve *embedding 召回模型* 对照，**不是**完整旧版 Hook（旧版有 lexical 候选阶段）与新版 Hook（索引 + 一次 Railway 请求）的严格端到端 A/B 实验。大规模索引（5k/30k）、真实负例与完整 Hook 延时另行验收。PR 保持 Draft，禁止自动开启生产 `indexed_v1`。

## 用户审阅：真实历史问题的无偏模型候选盲测（待 Mac 执行）

已有备份内 135 条符合当前版本的有效全局 Memory；此前同语料 96 条 E5/ritrieve 对照在用户 Mac 运行成功。旧 E5 模型以阈值 0.80 对 8 条普通**未标注**问题均输出 4 条，ritrieve 0.78 对这些普通问题 8/8 输出空结果；两者 8/8 原文自引用 Top1 命中。此为**筛选行为对比，不能当成召回准确率**；来源消息弱标签数为 0，确认需人工审阅。

新脚本 `scripts/mind-real-blind-review.ts` 使用用户自己导出的同一份 Full Backup v4，本机读取当前路径已完成的真实用户历史提问，自动选取最多 8 题（半数倾向有关键词关联、半数分散样本），用相同最多 256 条合格 Memory 让旧 E5 和新 ritrieve 分别生成候选，把各阈值 top-4 的**合并集合**打乱，不显示候选属于哪个模型和评分。用户只在本机为每题输入真正相关的编号；如全无关输入 `0`，不确定输入 `s` 跳过。无候选的题也标成未审，不会虚假记为正确负例。脚本最终输出匿名聚合：人工标注正例 Top1/Top4 命中、给出候选的错误注入率、用户判断无关的问题正确空结果比例。此候选池仍是两个模型提议的有限并集，并非全部 135 条记忆的人工金标准标注。

```zsh
cd /tmp/leileios-mind-1142
git fetch origin codex/mind-ritrieve-staged-20261017
git switch --detach FETCH_HEAD
pnpm typecheck
BACKUP="$(find "$HOME/Downloads" -maxdepth 1 -type f -name 'leileios-full-backup_*.json' | sort | tail -n 1)"
pnpm exec tsx scripts/mind-real-blind-review.ts "$BACKUP" --count=8
```

**绝不要把交互过程输出的私人对话或 Memory 明文发到聊天或提交 GitHub。** 只复制 `AGGREGATE_RESULT_JSON_START` 之后的 JSON；评审不上传任何用户内容，不改动真实 Mind/daemon/Hook/Railway。E5 仅在本机运行，若没有公开模型权重可能首次下载模型文件。生产 PR 仍为 Draft，不能据此直接启用新 Hook。

### 真实备份缺少历史提问时的本机输入模式

2026-10-18 用户实际 Full Backup v4 有 135 条当前有效 Mind Memory，但 `mind-real-blind-review.ts` 的历史提问筛选结果为 0，先前版本因此在测试前报错。备份的 `listConversations` 实现只导出 `origin=native_live` 对话，因此独立 Claude Code/SDK 对话不一定存在于备份中。新脚本优先使用已完成的当前分支用户提问，若没有则接受已完成的其他分支提问作为**离线测试问题**；若仍无问题，自动进入本机交互模式，请用户最多输入 8 条要测试的问题（或以 `--count=N` 指定，空行提前结束）。也可使用 `--manual` 强制自己输入。测试集的输入来源在最终匿名 JSON 以 `prompt_origin` 标明，`exported_message_count` 与 `completed_user_message_count` 只记录数量。

```zsh
pnpm exec tsx scripts/mind-real-blind-review.ts "$BACKUP" --count=8
# 如希望忽略已导出的历史问题，始终自己输入：
pnpm exec tsx scripts/mind-real-blind-review.ts "$BACKUP" --count=8 --manual
```

用户应在本机输入部分**应该相关**的改写问题，部分**应该无关**或语义相近但无确切对应记忆的问题，然后对匿名打乱候选按编号人工判断。最终只能发送 `AGGREGATE_RESULT_JSON_START` 后的统计 JSON，不要粘贴屏幕中私人的测试问题及记忆正文。两模型均未提名候选的试题属于**未标注**，不虚构正确空结果；本轮仍不是生产完整旧 Hook 对新版 Hook 的端到端 A/B。

## 真实 Mind 人工盲测结果与激活阻断（2026-10-18）

用户在 Mac 本地 Full Backup 上运行 `scripts/mind-real-blind-review.ts --count=8 --manual` 并亲自判断候选。输入总共 135 条合格全局 Memory、135 条全部参与模型对照；备份含 804 条消息，其中 411 条完成状态的用户消息，但当前筛选没有自动产生历史问题，因此采用用户自己输入的 8 个测试问题。人工确认其中 4 个存在相关候选、4 个在候选并集内无相关记忆；无跳过、无未审项目。**仅匿名聚合值被复制出来，没有任何明文。**

| 模型（embedding 层） | 有相关候选的提问 Top1/Top4 命中 | 人工无关问题的正确空结果 | 返回中错误记忆数 | 错误注入比例 | 平均返回条数 |
|---|---:|---:|---:|---:|---:|
| 旧 E5 0.80 | 4/4 | 0/4 | 26 | 0.813 | 4.00 |
| 新 ritrieve 0.68 | 3/4 | 2/4 | 8 | 0.667 | 1.50 |
| 新 ritrieve 0.76 | 1/4 | 4/4 | 0 | 0.000 | 0.13 |
| 新 ritrieve 0.78 | 0/4 | 4/4 | 0 | 0.000 | 0 |
| 新 ritrieve 0.80 | 0/4 | 4/4 | 0 | 0.000 | 0 |

这组人工审阅的候选并集共包含至少 6 次已确认的相关记忆（旧 E5 找齐 6、ritrieve 0.68 找回 4、0.76 找回 1），**在同一批语料和人工提问上，新模型明显减轻无关输出，但当前阈值/排序没有守住旧模型的召回能力**。`0.78` 的合成数据好结果不适用于此真实数据。作者模型卡指出 `ritrieve_zh_v1` *无需专门 instructions*，当前 `SentenceTransformer.encode(...normalize_embeddings=True)` + 内积的方式与官方示例一致；未发现由缺少查询/段落前缀直接导致的明显配置错误，不能凭此断言已找到根因。

**冻结要求：不得因零误注入而把 `0.76` / `0.78` / `0.80` 写入新索引生产默认；不得让 0.68 的现有试验设置进入线上自动召回；更不能据此宣布新模型优于旧模型。**后续优先在离线真实人工标签上试验上下文、混合候选（词法/E5/ritrieve）及拒绝策略，要求同时复测漏召回与误注入。只有完整旧 Hook 和完整新 Hook 在同批问题/身份/链状态上的端到端对照，才能定论实际用户体验。所有生产 Hook、daemon 和原生产 Railway 保持不变；PR 保持 Draft。

**统计约束：**人工标签只覆盖两个模型提出的最多 top-4 并集，而非 135 条 Memory 全库逐条人工判断。样本仅 8 题（4 正 / 4 负），可提示当前质量风险，不能当最终置信区间或普适模型排名。

## 新的混合候选试验（未上线；待同批真人标注验证）

新增只在**离线试验脚本**调用的 `src/domains/runtime/mind/mind-hybrid-candidates.ts`：

- `hybrid_agreement`：旧 E5 分数至少 0.80、旧模型排名前 6、ritrieve 分数至少 0.68、ritrieve 排名前 12，双方同时同意才留候选；按加权倒数排名融合，最多 4 条。
- `hybrid_anchored_rescue`：上述规则外，允许旧 E5 前 4、ritrieve 前 48 且分数至少 0.58 的候选**仅在真实提问与记忆正文有连续 3 字中文片段直接匹配时**补入。目的是试着减少漏召回，同时避免任意用 E5 的高分塞满 4 条。这些数值仅为待测实验参数，没有人工标签证明其正确。
- 完全相同的用户 Mac 已导出的 `data.mind` 当前全局合法快照，是所有算法对照唯一候选来源；不读取生产数据库、运行 Hook、调用 Railway、修改任何 Memory。
- **这不是已经完成的混合检索上线实现。**要在真实标注集验证召回率、误注入比例、无关空结果比例，再决定是否值得设计 E5+ritrieve 双模型常驻索引及真正上线 Hook 改造。现有 `indexed_v1` 和生产 E5 路由完全不调用此实验模块。
- 新增 `tests/mind-hybrid-candidates.test.ts`：双方共识、无关分数阻断、中文片段补救、缺失/不可见条目阻断、限流/确定性等 6 个单元用例；需要用户 Mac 运行 `pnpm exec tsx --test tests/mind-hybrid-candidates.test.ts` 和 `pnpm typecheck`。

原来的 `scripts/mind-real-blind-review.ts` 现在会在同一轮真人盲测中对比 **旧 E5、新 ritrieve（不同阈值）以及两种 hybrid 筛选结果**，混合打乱全部候选，不向人工标注者展示算法归属，最终 JSON 新增 `hybrid_agreement` 与 `hybrid_anchored_rescue` 两项匿名聚合。之前的 8 条真人标签只保留在旧脚本运行的内存里，没有记录到文件，不能自动重用；需再在 Mac 本地标注一次新一轮问题。

```zsh
cd /tmp/leileios-mind-1142
git fetch origin codex/mind-ritrieve-staged-20261017
git switch --detach FETCH_HEAD
pnpm typecheck
pnpm exec tsx --test tests/mind-hybrid-candidates.test.ts
BACKUP="$(find "$HOME/Downloads" -maxdepth 1 -type f -name 'leileios-full-backup_*.json' | sort | tail -n 1)"
pnpm exec tsx scripts/mind-real-blind-review.ts "$BACKUP" --count=8 --manual
```

仅可向协作方复制 `AGGREGATE_RESULT_JSON_START` 之后的匿名统计。仍必须保持 PR Draft；不能根据合成逻辑测试宣布质量提升或开启生产环境。

## 第二轮真人盲测：混合算法及 Top1 保守输出（2026-10-18）

用户使用全部 **135 条当前有效 G Memory**，在 Mac 本机手动输入并判定 8 个查询（4 个存在相关候选，4 个在候选并集中无关），所有 8 题均标注完毕。备份共 804 条消息、411 条已完成用户消息，但当时自动历史问题数为 0。输入材料和人工标签没有导出到仓库或聊天，仅匿名统计由用户提供。

| 模型（embedding 层） | 有相关候选的问题命中 Top1 / Top4 | 无关问题正确空结果 | 错误返回记忆数 | 错误占返回比例 | 平均返回条数 |
|---|---:|---:|---:|---:|---:|
| 旧 E5 0.80 | 4/4 | 0/4 | 27 | 84.4% | 4.00 |
| ritrieve 0.68 | 3/4 | 2/4 | 11 | 68.8% | 2.00 |
| ritrieve 0.76 | 1/4 | 4/4 | 0 | 0% | 0.13 |
| ritrieve 0.78 / 0.80 | 0/4 | 4/4 | 0 | 0% | 0 |
| hybrid_agreement | 4/4 | 3/4 | 10 | 66.7% | 1.88 |
| hybrid_anchored_rescue | 4/4 | 3/4 | 10 | 66.7% | 1.88 |

两个混合分支在本轮**完全相同**，`anchored_rescue` 没有额外有效增益。与旧 E5 相比，混合候选改善了无关空结果（从 0/4 到 3/4）并把错误注入从 27 降为 10；但仍有 10 条误注入，占 66.7%，**不得宣称达到上线质量**。本轮每种模型只找回人工候选并集中 6 条相关记忆中的 5 条（在 4 个相关问题上都是第一名正确），仍不是全库客观 Recall@4。

**无需复跑也可推导的保守策略：**现有 `hybrid_agreement` 在 4 个有相关记忆的问题中 Top1 为正确，且 4 个无关问题中 3 个空、1 个非空。若*只截断返回前 1 条，保持同一候选排序不变*，在此轮数据上会是：相关问题 Top1 命中 4/4、无关问题空结果 3/4、错误记忆 1/5（20%），每轮平均 5/8=0.625 条。代价是已标注的 6 条相关记忆中只能恢复其中 4 条（4/6），即牺牲多记忆覆盖。**这是对已有用户聚合统计的逻辑推算，不是新的实际跑测或可外推的准确率。**

为单独验证输出上限，离线盲测脚本添加第八个算法名称 `hybrid_agreement_top1`，共用同一候选选择器，显式 `maxItems:1`；新增对应单元测试。**现有生产 Hook、索引默认与 Railway 生产部署均未改动；PR 继续 Draft**。下一次进行质量提升，先保存用户 Mac 本地（绝不上传）标注数据，避免每改一个阈值都让用户重新回答一遍；再用独立测试集验证是否能安全给第二条相关记忆。


## 第三轮本机人工测试：混合 Top1 的真实结果（2026-10-18）

用户又一次在自己 Mac 的完整备份上运行新盲测，数据仍为 **135 条合法 G Memory、8 道用户自拟问题**。与上一轮不同，本轮人工评定 **5 道有相关候选、3 道无相关候选**；8 道全部审阅且无跳过。备份记录 804 条消息 / 411 条已完成用户消息，未用到历史问题自动生成。只收到了无个人正文的聚合统计，无法认为本轮和上一轮是相同 8 道题。

| 检索方式（仅模型层） | 有相关候选问题 hit@4 | 有关问题 Top1 | 人工无关问题正确空结果 | 错误记忆数量 | 错误记忆比例 | 平均每题记忆 |
|---|---:|---:|---:|---:|---:|---:|
| 旧 E5 0.80 | 5/5 | 4/5 | 0/3 | 25 | 78.1% | 4.00 |
| ritrieve 0.68 | 3/5 | 3/5 | 2/3 | 9 | 64.3% | 1.75 |
| ritrieve 0.76 | 1/5 | 1/5 | 3/3 | 0 | 0% | 0.13 |
| ritrieve 0.78 / 0.80 | 0/5 | 0/5 | 3/3 | 0 | 0% | 0 |
| hybrid_agreement | 5/5 | 4/5 | 2/3 | 11 | 64.7% | 2.13 |
| hybrid_anchored_rescue | 5/5 | 4/5 | 2/3 | 11 | 64.7% | 2.13 |
| **hybrid_agreement_top1** | **4/5** | **4/5** | **2/3** | **2** | **33.3%** | **0.75** |

以候选并集的人工相关记忆为分母，`recall_among_union_labeled_relevant` 分别为旧 E5 0.875、混合多条 0.75、混合 Top1 0.50（候选并集中共计 8 次相关标记）。Top1 共返回 6 条，其中 4 条正确、2 条错误；与上一轮理论推算的 1 条错不同，因为本轮题集由 4/4 正负变为 5/3，不能混为同一组验证。两套混合算法本轮仍输出同样结果，`anchored_rescue` 没有实证收益。

**结论：**混合 Top1 可大量抑制错误注入，但 5 道正例中 1 道未正确命中，且 8 条人工相关记忆只返回 4 条。因此不能把它称作与旧 E5 同等召回，更不能替换生产。接下来应尝试经过审查的**条件式第 2 条输出/置信差距拒绝策略**，并在本地离线生成可重用、用户自己保管的盲测标签，以便同一批 query/label 的可重复 A/B；验证不应将私人文本/记忆上传到 GitHub、第三方模型或聊天。

本次只补录结果：**没有更改生产 Hook、daemon、Railway 或真实 Memory**；PR #1142 继续 Draft。试验不等于旧/新完整 Hook 的线上端到端对照。

## 条件式第二条 + 可重复本地盲测（Draft 实验，2026-10-18）

在 `src/domains/runtime/mind/mind-hybrid-candidates.ts` 新增**独立的离线实验入口** `selectHybridMindCandidatesConditional`，并接入 `scripts/mind-real-blind-review.ts` 的第九种检索方式 `hybrid_conditional_second`。对相同 E5/ritrieve 候选：

- 仍使用 `hybrid_agreement` 已有的双模型筛选、融合排序，**先保留排序第一的 1 条**（如果找不到则 0 条）。
- 只在第二条的 E5 排名前 3 / 分数 ≥0.86、ritrieve 排名前 5 / 分数 ≥0.70，并且分别与第一条的原始 E5、ritrieve 得分相差不超过 0.035 / 0.05 时，才补入**第二条**。
- **最多 2 条**；不会返回第三、第四条；原模型分数阈值与相对差距都是需要真实独立标签验证的试验参数，不代表已校准概率。
- 该新入口没有接线到 daemon、Mind Socket、Hook、Railway 生产 API，也不会修改 Mind。旧模式保持不变。

为避免每轮更换问题造成 A/B 不可比，盲测脚本支持 **`--review-file=绝对路径`** 保存/读取本机固定题目及人工判断。仅当用户显式传入该参数才写文件，且要求文件在**仓库外**、父目录私有（0700）、文件私有（0600），原子写入；以后重新运行同一命令会复用原题和已评过的候选 ID，**新策略额外提议的候选才会再次让用户人工标注**。存档包含私人的用户提问、Memory UUID、已核实候选 ID、快照文本的 SHA-256 指纹，**没有 Memory 原文**；绝对不能把它贴给 ChatGPT 或推送到 GitHub。Memory 变更或样本不同会触发指纹不匹配并拒绝复用旧标签，避免跨版本误计质量。

在 Mac 执行（先拉取试验分支、跑 TypeScript 及逻辑测试）：

```zsh
cd /tmp/leileios-mind-1142
git fetch origin codex/mind-ritrieve-staged-20261017
git switch --detach FETCH_HEAD
pnpm typecheck
pnpm exec tsx --test tests/mind-hybrid-candidates.test.ts
BACKUP="$(find "$HOME/Downloads" -maxdepth 1 -type f -name 'leileios-full-backup_*.json' | sort | tail -n 1)"
pnpm exec tsx scripts/mind-real-blind-review.ts "$BACKUP" --count=8 --manual --review-file="$HOME/.leileios/mind-eval/fixed-review.json"
```

同一备份再复测，**直接重跑最后一行**；不会重新输入已保存的 8 道题或重新判定已审候选。终端仍会显示私人问题，只允许复制 `AGGREGATE_RESULT_JSON_START` 后的匿名统计 JSON。首次创建本机保存文件需要用户明确传 `--review-file`，不触碰现有的真实 Mind 记录。脚本还排除无候选且缺乏有效相关性标注的题目；不把未判断的候选当成负例。

### 验收限制

- 之前的 3 轮匿名汇总没有逐题标签文件，**不能复用**，本轮需要一次重新标注，随后才可重复对照。
- 本地独立小型 TypeScript/Node 测试包含条件第二条的具体分数/rank案例与 300 轮伪随机不变量，已通过；仓库自身的 `pnpm typecheck` 和新测试仍需在用户 Mac 执行。
- 此实验只比较 embedding 层的新旧/混合候选；尚未证明改善完整生产旧 Hook 的实际体验。PR **继续 Draft**，不得合并/启用 `indexed_v1`、更改生产 Hook 或阈值。
