# Leilei OS Web

Leilei OS 的 Auth0 保护 React Web 应用。它通过已认证的 `/api/v1` API
读取和修改用户数据，不是只展示页面壳的静态原型。正式集成与发布统一跟随
仓库 `main` 分支。

## 当前功能

- Dashboard 与 Day Space：真实 Todo/Diary 数据和日期导航；
- Memory、Diary、Task：列表、筛选、编辑、详情和生命周期操作；
- Todo：每日纸张、版本、条目编辑与状态操作；
- Shared Paper：单一 canonical 正文、revision-aware 编辑、历史和生命周期操作；
- Universe：空间画布、节点/关系、加权星系、导入导出与搜索深链；
- Global Search：Memory、Diary、Task、Todo、Universe、Shared Paper 六个 domain 的统一发现与精确详情深链；
- Settings：Account、Status、Data（Summary / Export / Restore）和 About；
- PWA：安装清单、service worker 更新提示以及在线/离线状态提示。

后端服务仍是持久化数据的权威来源；Web 不使用本地 IndexedDB 或隐式双写来替代
服务端数据。

## 本地运行

```bash
cd web
npm install
cp .env.example .env
npm run dev
```

在 `.env` 中配置一个独立的 Auth0 **Single Page Application**：

```dotenv
VITE_AUTH0_DOMAIN=your-tenant.us.auth0.com
VITE_AUTH0_CLIENT_ID=your-web-application-client-id
VITE_AUTH0_AUDIENCE=https://your-api.example.com/api
VITE_AUTH0_SCOPE=leilei:web
VITE_AUTH0_REDIRECT_URI=http://localhost:5173
VITE_API_BASE_URL=https://your-api.example.com/api/v1
```

Auth0 Application 需要配置：

- Allowed Callback URLs：`http://localhost:5173`
- Allowed Logout URLs：`http://localhost:5173`
- Allowed Web Origins：`http://localhost:5173`
- Grant Types：Authorization Code

不要复用 ChatGPT 的 CIMD Client。Web 应用使用独立 Client ID，但可以启用同一个
Auth0 Database Connection，从而保持用户 `sub` 与现有身份一致。Web 使用独立的
API audience 与 `leilei:web` scope，不申请 MCP audience。

## 构建

```bash
npm run typecheck
npm run build
```

构建产物位于 `web/dist/`，可作为独立静态站点部署。部署时必须为 SPA 配置
history fallback，并将生产站点 URL 加入 Auth0 的 Callback、Logout 和 Web
Origins 白名单。

## 部署

- Web 使用独立的 Vercel 项目，Root Directory 指向 `web/`。
- Vercel Production 已部署当前 `main`，并使用 `web/vercel.json` 的 SPA
  history fallback。
- Railway 继续使用仓库根目录的 `Dockerfile` 运行 API/MCP 服务；Web 不改变
  Railway 的后端启动或迁移配置。
- 预览和本地部署必须保持独立的 Auth0 callback/logout/origin 配置；生产凭据
  不写入仓库。
