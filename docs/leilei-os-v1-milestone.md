# Leilei OS v1 里程碑

记录日期：2026-07-22
状态：生产可用，v1 核心链路验收完成

## 1. 当前生产状态

Leilei OS v1 已作为远程 MCP Server 部署在 Railway，并已通过 ChatGPT
Developer Mode 的正式 OAuth 流程连接。

- 生产 MCP Endpoint：`https://leilei-os-production.up.railway.app/mcp`
- 运行环境：Railway + Docker + Node.js + TypeScript + Express
- MCP Transport：Streamable HTTP over HTTPS
- 数据库：PostgreSQL，使用 Drizzle ORM 和版本化 migration
- ChatGPT 集成：Developer Mode / Custom App
- 认证状态：公网 MCP 强制 OAuth；未认证请求返回 `401`
- 测试旁路：`MCP_DEV_ALLOW_UNAUTHENTICATED=false`
- 健康检查：`/health`
- OAuth Protected Resource Metadata：
  `/.well-known/oauth-protected-resource` 和
  `/.well-known/oauth-protected-resource/mcp`

生产回归已确认：ChatGPT 可通过 OAuth 发现并调用 v1 的四个 MCP Tools，
`hello`、Memory、Diary、Task 现有能力保持正常。

## 2. 已完成功能

### MCP 基础设施

- 远程 MCP HTTP Server 与 HTTPS 公网部署
- MCP `tools/list` 和工具调用链路
- Zod 输入校验与结构化输出
- 安全错误转换，不向客户端暴露内部异常、密钥或数据库信息
- Docker 构建与 Railway 部署

### Memory

- 按认证用户读取核心记忆
- 支持按 `categories` 和 `keys` 过滤
- 仅返回 `active` 且 `visibility=assistant` 的记忆
- 支持分类白名单、稳定排序、数量限制和内容长度限制
- 不向工具输入开放 `user_id`、visibility、status 或 SQL 条件

### Diary

- 创建个人日记
- 保存标题、正文、日期、标签和可选心情
- `source` 固定为 `chatgpt_mcp`
- 使用 `idempotency_key` 和 `request_hash` 防止重复写入及键冲突复用
- 写入 `tool_calls` 审计摘要

### Task

- 创建个人任务
- 保存标题、描述、优先级、到期时间、时区和标签
- 到期时间必须是带 `Z` 或显式 UTC offset 的 ISO 8601 时间
- 时区使用明确的 IANA timezone；不接受模糊时间
- 新任务由服务端固定初始化为 `pending`
- 用户身份、状态和完成时间不能由工具输入指定

## 3. 当前认证架构

```text
ChatGPT Developer Mode
        │
        │ OAuth 2.1 Authorization Code + PKCE
        ▼
Auth0 Authorization Server
        │
        │ JWT access token
        │ audience = production /mcp
        │ scope = leilei:access
        ▼
Leilei OS OAuth Middleware
        │
        ├─ 验证 issuer / audience / signature / scope
        ├─ 限制允许的 Auth0 subject
        └─ subject → MCP_USER_ID 单用户映射
        │
        ▼
MCP Tools → Domain Services → Repositories → PostgreSQL
```

当前认证规则：

- ChatGPT 使用正式 CIMD OAuth Client；客户端元数据由 ChatGPT 托管。
- Auth0 执行登录、用户同意、Authorization Code + PKCE 和令牌签发。
- 公网 `/mcp` 只接受符合 Auth0 配置的 Bearer access token。
- 必须具有 `leilei:access` scope。
- `AUTH0_ALLOWED_SUBJECT` 将访问限制为当前获准的 Auth0 用户。
- `MCP_USER_ID` 由服务端完成单用户身份映射；客户端不能传入或选择用户。
- `MCP_AUTH_TOKEN` 仅保留给 `/internal/mcp` 内部凭证路径，不用于
  ChatGPT 公网 OAuth。
- 开发期无 Token 测试旁路已关闭，生产默认安全行为已恢复。

## 4. MCP Tool 列表

| Tool | 类型 | v1 能力 |
| --- | --- | --- |
| `hello` | READ_ONLY | 验证 MCP 连接及基础响应。 |
| `read_memory` | READ_ONLY | 读取获授权的核心记忆、稳定偏好、长期目标和当前项目。 |
| `write_diary` | WRITE | 创建日记；支持幂等、防冲突和审计记录。 |
| `create_task` | WRITE | 创建初始状态为 `pending` 的任务；当前为非幂等写操作。 |

## 5. 数据模型列表

### `users`

单用户身份及状态。主要字段包括 email、display_name、status 和时间戳。

### `core_memories`

长期核心记忆。包含 category、key、content、visibility、source、status、
sort_order 和时间戳，并通过 user_id 实现用户隔离。

### `diary_entries`

日记记录。包含 title、content、date、tags、mood、固定 source、
idempotency_key、request_hash 和时间戳。

### `tool_calls`

MCP 写操作审计摘要。包含工具名、操作、资源类型与资源 ID、幂等键、
请求摘要、结果摘要、耗时、状态、错误码和创建时间。日志设计不保存 Token、
密钥或敏感认证信息。

### `tasks`

任务记录。包含 title、description、status、priority、due_time、timezone、
tags、创建/更新时间和 completed_at。状态预留 `pending`、`in_progress`、
`completed`、`cancelled`。

所有业务表通过 `user_id` 关联 `users`，外键删除策略为 `RESTRICT`。

## 6. 已知未实现功能

以下能力不属于 Leilei OS v1 当前生产范围：

- 核心记忆写入、修改、删除和记忆候选审批
- 向量数据库、Embedding、语义检索和 RAG
- 日记列表、日记读取、搜索、编辑、删除及评论/回复
- 任务查询、状态更新、完成、取消、删除和倒计时状态查看
- `create_task` 幂等键与任务写入审计
- 多用户注册、租户管理和动态 `sub → user_id` 映射
- 管理后台、Web UI 和自建聊天界面
- 自建 OAuth Authorization Server；当前依赖 Auth0
- OpenAI API 调用、自建 Agent 编排和自建对话历史
- Calendar、知识库、文档导入、自动化工作流和“思维宇宙”集成
- 完整的运维告警、备份恢复演练和管理级审计查询界面

## 7. v1 边界

Leilei OS v1 的定位保持不变：

```text
ChatGPT = 对话、理解、工具选择和自然语言回复
Leilei OS = 认证、权限、可靠业务操作和长期状态
PostgreSQL = 记忆、日记、任务和审计数据
```

v1 不开发第二套聊天产品。后续版本应继续沿用 MCP Tool → Domain Service →
Repository → PostgreSQL 的分层，并以最小权限、明确用户意图、结构化校验和
可审计写操作为扩展原则。
