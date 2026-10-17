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
