# Global Mobile Top Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.


**Goal:** 把 Home 已验收的手机顶栏提升为所有页面共用的手机顶栏。

**Architecture:** 保留现有 AppShell 和 MobileTopBar，不改 JSX、路由或导航行为；只把 Home 专属顶栏 CSS 提升为全局 mobile top bar 样式，并删除重复的 Home 顶栏覆盖。

**Scope:** 仅手机端。桌面 Sidebar、各页面主体、Memory 重构都不在本批次。

## Task 1 — TDD 锁定全局顶栏

修改：
- tests/mobile-home-shell.test.ts
- web/src/styles.css

步骤：
- [ ] 把现有 Home 专属顶栏测试改为全局 .mobile-top-bar 测试。
- [ ] 要求 44px + safe-area 高度、纯白背景、无底线、无 blur、Apple 字体、中央 Leilei OS、左右 44px 点击区、Home 已验收的菜单与搜索图标尺寸。
- [ ] 额外断言不再依赖 body:has(.home-prototype) .mobile-top-bar。
- [ ] 运行 npx tsx --test tests/mobile-home-shell.test.ts，先确认 RED。


## Task 2 — 最小 CSS 实现

- [ ] 把 Home 已验收的顶栏参数提升到全局 mobile top bar：
   - 高度 44px + safe area
   - 白底
   - 无底线
   - 无 backdrop blur
   - Apple 系统字体
   - 标题 20px / 500
   - 左菜单、右搜索均为 44px 点击区
   - 左右位置 18px
   - 菜单图标宽 22px
   - 搜索图标 25px，stroke-width 1.8
- [ ] 删除仅针对 body:has(.home-prototype) 的顶栏覆盖。
- [ ] 不改 Home 其他页面样式。
- [ ] 不改 MobileTopBar JSX、路由或 drawer 行为。
- [ ] 再跑 npx tsx --test tests/mobile-home-shell.test.ts，确认 GREEN。


## Task 3 — 验证与交付

- [ ] 运行 npx tsx --test tests/mobile-home-shell.test.ts。
- [ ] 运行 npm --prefix web run typecheck。
- [ ] 运行 npm test，要求 0 failures。
- [ ] 运行 git diff --check，要求无输出。
- [ ] 本地手机预览逐页检查 Home、Memory、Diary、Task、Global Search、Settings、Universe、Chat Archive 的顶栏完全一致。
- [ ] git status --short 只允许本批次文件，以及两个既有未跟踪 preview 文件。
- [ ] 实现文件只提交 tests/mobile-home-shell.test.ts 和 web/src/styles.css。
- [ ] 用户验收后再 fast-forward 回 codex/phase-6-web-ui-foundation 并 push。
- [ ] 更新 Notion 当前状态后，才开始 Memory 批次。

## Global Constraints

- web/preview.html 不提交。
- web/src/preview-main.tsx 不提交。
- 桌面端不改。
- 页面主体不改。
- 不新增路由、不改业务逻辑。
- 不在验证完成前宣称本批次完成。
