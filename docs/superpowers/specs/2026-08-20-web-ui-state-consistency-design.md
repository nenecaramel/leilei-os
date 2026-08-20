# Web UI State Consistency Design

Date: 2026-08-20
Baseline: `main` at `23ad1c66bb94428da313602d7a6a7cea529fb7ad`
Scope: Web frontend only

## 1. Goal

Make equivalent UI states and equivalent operations visually and semantically consistent across comparable modules, without flattening the whole product into one universal visual language.

The design standardizes:

- state semantics and copy where the same state exists in comparable modules;
- horizontal and vertical placement;
- typography, color, spacing, and action treatment;
- loading/error/empty/filtered-empty transitions;
- retry and clear-filter behavior;
- detail-state containment;
- long metadata overflow rules;
- permanent-delete confirmation presentation;
- accessibility behavior for state changes.

It does **not** standardize unrelated module identities. Memory / Diary / Task, Home, Day Space, Global Search, Universe, System, and Auth keep their existing visual language where their states are not equivalent.

## 2. Design principle: state families, not one global component

Do not create one universal state component and force every module through it.

Use state families:

1. **Records family** — Memory / Diary / Task list, archive, and detail states.
2. **Home family** — Todo and Calendar module-level read states.
3. **Day Space family** — page-blocking states versus partial-data warnings.
4. **Global Search family** — idle/loading versus no-results/error states.
5. **Universe family** — cosmos-contained states; Universe keeps its own visual identity.
6. **System family** — Connections / Activity / Data read states.
7. **Auth** — already a distinct centered flow; no redesign in this work.

Equivalent states inside a family must match. Different families may intentionally differ.

## 3. Responsive contract

- `<= 760px`: Mobile specifications in this document.
- `>= 761px`: Desktop/Tablet specifications in this document.
- `761–980px` uses Desktop state rules even if navigation becomes compact.
- Existing `<= 380px` page-width adjustments may remain, but must not introduce a third state typography, offset, or action system.
- No new breakpoint is introduced.

## 4. Shared Records state contract

Applies to Memory / Diary / Task mobile page-level states.

### 4.1 State typography

Primary state text:

- `13px`
- weight `500`
- color `#777777`
- line-height `1.4`

Secondary state text:

- `12px`
- weight `400`
- color `#a0a0a0`
- line-height `1.5`

State text action:

- `11px`
- weight `500`
- color `#666666`
- line-height `1.4`
- transparent background
- no border
- no persistent tile
- hover/active color `#555555`
- focus-visible may use a `1px` outline
- action text does not wrap

Spacing:

- primary → secondary: `6px`
- secondary → action: `10px`
- primary → action when there is no secondary line: `10px`

Geometry:

- outer width `100%`
- inner width `min(100%, 280px)`
- inner `margin-inline: auto`
- `text-align: center`
- primary and secondary copy may wrap normally
- no fixed container height unless a state below explicitly requires it

### 4.2 Desktop Records state contract

Desktop/Tablet Records states keep their existing page surfaces. Do not introduce a new generic white card.

For blocking empty/error/detail-state surfaces:

- existing module state surface remains;
- state content area `min-height: 300px`;
- content horizontally and vertically centered;
- title `29px / 500 / Newsreader` using existing ink color;
- description `14px`, existing muted color, line-height `1.72`, `max-width: 480px`;
- title → description `12px`;
- description → action `14px`;
- action uses the existing desktop `.secondary-button` visual system;
- existing border/radius/background/shadow of the host surface remain unchanged.

True-empty may omit the description when the design below says so.

## 5. Memory / Diary / Task main lists

### 5.1 True empty

Current inconsistency:

- mobile states differ in alignment and presentation;
- desktop/mobile use different structures;
- state positions are not consistently anchored.

Mobile final state:

- state starts `96px` below the bottom edge of the visible page header plus active search/filter controls;
- no viewport-percentage positioning;
- no fixed state height;
- horizontally centered using the shared Records state geometry;
- one line only:
  - Memory: `还没有记忆`
  - Diary: `还没有日记`
  - Task: `还没有任务`
- primary typography only;
- no description;
- no action.

Desktop/Tablet:

- use the Desktop Records state contract;
- one title line only;
- keep the module's existing placeholder icon if it already exists;
- icon geometry must be identical across Memory / Diary / Task if all three render one;
- icon → title `14px`.

### 5.2 Filtered empty

The current mobile vertical position is approved and must remain unchanged.

Mobile:

- preserve the existing `96px` filtered-empty offset;
- horizontally center the state group;
- copy:
  - `没有符合条件的记忆`
  - `没有符合条件的日记`
  - `没有符合条件的任务`
- action text: `清除条件`
- primary uses shared primary typography;
- action uses shared action typography;
- primary → action `10px`;
- no secondary line.

Remove divergent wording such as `没有匹配的记忆` and `清除筛选`.

Desktop/Tablet:

- use the Desktop Records state contract;
- same resource-specific title copy;
- existing desktop secondary action style remains.

### 5.3 Clear-filter semantics

`清除条件` clears only the current module's list filters and does not change module or active/archive space.

Memory clears:

- `q`
- `category`
- `tag`

Diary clears:

- `q`
- `tag`
- `mood`
- `dateFrom`
- `dateTo`

Task clears:

- `q`
- `status`
- `priority`
- `tag`
- `due`
- `dueFrom`
- `dueTo`

Global Search clear behavior is defined separately below.

After clear:

- the filtered-empty state exits immediately;
- the module enters its normal loading state;
- current module/route is preserved.

### 5.4 Main-list loading

Loading is content replacement, not a centered message.

Mobile:

- use skeletons at the normal list-content start position;
- no `96px` state offset;
- section top padding `4px`;
- month/group skeleton gap `6px`;
- label skeleton `72px × 12px`;
- skeleton card uses the same width, border, radius, and outer geometry as the real list card;
- skeleton card `min-height: 126px`;
- skeleton card padding `15px 13px`;
- internal skeleton-row gap `12px`;
- skeleton row height `34px`;
- Memory / Diary / Task use the same skeleton geometry.

Desktop/Tablet:

- continue existing list/card skeleton language;
- equivalent Records pages must use the same skeleton geometry.

Accessibility:

- visual skeleton nodes are `aria-hidden="true"`;
- list container uses `aria-busy="true"` while loading;
- include a visually hidden `role="status" aria-live="polite"` message such as `正在读取记忆…` / `正在读取日记…` / `正在读取任务…`;
- remove the hidden loading message and set `aria-busy="false"` when loading finishes.

### 5.5 Main-list read failure

Mobile:

- state starts `96px` below the visible header/search/filter block;
- shared Records geometry and typography;
- copy:
  - `暂时无法读取记忆`
  - `暂时无法读取日记`
  - `暂时无法读取任务`
- secondary: `请稍后重试。`
- action: `重新加载`
- primary → secondary `6px`;
- secondary → action `10px`.

Remove divergent descriptions such as `连接没有完成` or `筛选条件已保留`.

Desktop/Tablet:

- use the Desktop Records error contract.

### 5.6 Non-blocking list mutation failure

Examples: archive/update actions fail but the list remains usable.

Do not replace the list with a large module state card.

Presentation:

- place a lightweight notice after header/search/filter controls and before the real list;
- `margin-top: 8px`;
- `margin-bottom: 12px`;
- width `100%`;
- centered;
- `12px / 400 / var(--danger) / 1.5`;
- display the specific failure copy directly;
- no generic `操作没有完成` heading;
- no card/background.

Lifecycle:

- do not auto-dismiss on a timer;
- clear when the next equivalent mutation begins;
- clear on successful equivalent mutation;
- clear when leaving the current page/detail context;
- do not clear merely because the user scrolls or opens/closes a filter popover;
- stale request failures must not overwrite a newer operation state.

## 6. Memory / Diary / Task Archive

### 6.1 Archive true empty

Mobile:

- state starts `96px` below the Archive header;
- horizontally centered;
- primary typography only;
- one line:
  - `还没有归档记忆`
  - `还没有归档日记`
  - `还没有归档任务`
- no second explanatory line;
- no action;
- no duplicate `返回列表` action inside the state because Return already exists in the header.

Desktop/Tablet:

- use the Desktop Records true-empty contract;
- no duplicate Return action.

### 6.2 Archive loading

Mobile:

- skeleton starts at the normal Archive list start position;
- top padding `4px`;
- same skeleton geometry as the active Records list;
- do not apply the `96px` state offset.

Desktop/Tablet:

- use normal list skeleton geometry, not a large text-only loading state.

### 6.3 Archive read failure

Mobile:

- state starts `96px` below the Archive header;
- copy:
  - `暂时无法读取归档记忆`
  - `暂时无法读取归档日记`
  - `暂时无法读取归档任务`
- secondary: `请稍后重试。`
- action: `重新加载`
- use shared Records state typography and spacing.

Desktop/Tablet:

- use the Desktop Records error contract.

## 7. Memory / Diary / Task detail Paper states

Once a user has entered a detail Paper, loading/error/ready must remain inside that same Paper context. A failed request must not swap the Paper for a page-level state.

### 7.1 Paper detail loading

Mobile Paper:

- render an independent `paper-detail-state` inside `.paper-detail-body`;
- state top is `96px` below the top of the Paper scroll body;
- width `100%`;
- centered;
- copy:
  - `正在读取记忆…`
  - `正在读取日记…`
  - `正在读取任务…`
- `13px / 500 / #777 / 1.4`;
- no spinner;
- rule lines remain visible;
- top-right retains only safe close behavior; do not expose edit/delete actions that require loaded data;
- bottom metadata is hidden;
- signature uses the same safe placeholder `—` across all three modules.

### 7.2 Paper detail read failure

Mobile Paper:

- same `paper-detail-state` position: body top + `96px`;
- primary:
  - `无法读取记忆`
  - `无法读取日记`
  - `无法读取任务`
- secondary:
  - `该记忆不存在、无权访问或暂时不可用。`
  - `该日记不存在、无权访问或暂时不可用。`
  - `该任务不存在、无权访问或暂时不可用。`
- action: `重试`;
- primary/secondary/action use the Records `13 / 12 / 11px` hierarchy;
- centered;
- no bottom metadata;
- signature uses `—`;
- safe close remains available;
- Paper remains open during retry.

Archived detail uses the same structure with archive-specific copy:

- `无法读取归档记忆 / 日记 / 任务`
- `该归档记忆 / 日记 / 任务不存在、无权访问或暂时不可用。`

Memory archived-detail error must no longer jump to a page-level `MemoryMessage`.

### 7.3 Desktop/Tablet detail loading/error

The existing desktop detail surface remains; do not force it into the mobile Paper geometry.

Blocking detail state:

- `min-height: 300px`;
- horizontally and vertically centered;
- title `29px / 500 / Newsreader`;
- description `14px / muted / 1.72 / max-width 480px`;
- title → description `12px`;
- description → action `14px`;
- retry uses existing desktop secondary button;
- Task desktop must have an explicit read-error state and Retry; it must not render an empty detail surface after failure.

## 8. Retry contract

For every read-state Retry in this design:

- preserve current route and context;
- do not scroll to top;
- do not push or replace browser history unless the existing successful request flow already requires it;
- abort or invalidate the previous request;
- stale responses/errors must not overwrite the newest state.

State transition on Retry:

- Records list/archive → corresponding skeleton state;
- Records detail Paper → Paper loading state;
- Home Todo/Calendar → their module loading state;
- Global Search → `正在搜索…`;
- Day Space → corresponding loading placeholder;
- Universe → Universe loading state;
- System → corresponding System loading state.

Do not add a separate `正在重试` state. Retry disappears when loading begins, preventing repeated activation.

Context preservation:

- Records list retries preserve all current filters;
- Archive retries remain in Archive;
- detail retries keep Paper open and preserve `returnTo`;
- Global Search keeps current query/filters;
- Day Space keeps current date;
- Home retries only the affected Home module;
- Universe/System retry only their own current resource.

## 9. Records list-row metadata overflow

Applies to Memory / Diary / Task active and archive list rows.

Shared `.memory-row-meta` contract:

- `display: flex`;
- `align-items: center`;
- `justify-content: space-between`;
- `gap: 12px`;
- typography remains `12px / 400 / #8a8a8a / 1.3`.

Left date/deadline:

- `flex: 0 0 auto`;
- `min-width: max-content`;
- `overflow: visible`;
- `white-space: nowrap`;
- must always remain fully visible.

Right metadata:

- `flex: 1 1 auto`;
- `min-width: 0`;
- `overflow: hidden`;
- `text-overflow: ellipsis`;
- `white-space: nowrap`;
- `text-align: right`.

Remove Task-only layout exceptions; the correct protection becomes the shared Records rule.

## 10. Paper footer metadata and author signature

Normal and archived detail Papers share one footer contract.

Geometry:

- metadata container: `left: 24px; right: 68px; bottom: 14px`;
- do not use a contradictory `max-width`; the left/right anchors own the width;
- metadata `overflow: hidden`;
- `white-space: nowrap`;
- metadata typography `13px / #6d6d6d / 20px`;
- internal gap/separator spacing `6px`;
- author signature remains `right: 24px; bottom: 11px`;
- signature remains `20px / 500 / #858585 / Newsreader`.

Field shrink priority:

- Memory category: `flex: 0 0 auto`, always fully visible;
- Task status: `flex: 0 0 auto`, always fully visible;
- Diary mood: `flex: 0 1 auto`, maximum visible width `120px`, and ellipsizes itself if longer;
- separator: `flex: 0 0 auto`;
- tags: `flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`.

No user-entered metadata may cross the `right: 68px` footer boundary.

Editing state:

- preserve the existing Safari 16px real-font/no-zoom scaling approach;
- do not redesign editor controls;
- editor footer controls are still constrained by the same `left:24px/right:68px` parent safety region;
- no metadata input may overlap the author signature.

## 11. Paper mutation/save error

Mutation/save errors remain local to the Paper and do not use page-level empty/error states.

Presentation:

- independent footer error row;
- `left: 24px`;
- `right: 24px`;
- `bottom: 40px`;
- minimum line height `18px`;
- `12px / 400 / var(--danger) / 18px`;
- centered;
- may wrap to at most 2 lines;
- `max-height: 36px`;
- overflow hidden.

Scroll-body avoidance:

- without footer error: `.paper-detail-scroll` keeps bottom inset `38px`;
- with footer error: bottom inset becomes `82px`;
- footer error must not overlap body content, metadata, or signature.

`请选择作者` continues to use the existing author-control feedback path and is not duplicated into this generic footer error row.

## 12. Permanent delete confirmation

Applies to archived Memory / Diary / Task detail only.

Normal archived detail top-right actions:

- `恢复 · 删除`

First Delete click:

- local state change only;
- no API request;
- no browser confirm;
- no modal;
- no warning paragraph;
- top-right becomes `取消 · 确认永久删除`.

Pending after confirm click:

- top-right becomes `取消 · 删除中…`;
- both actions disabled;
- repeated submission prevented;
- backdrop/Escape/close/return must not close the Paper while the irreversible request is pending;
- no spinner or extra body copy.

Success:

- close archived detail;
- refresh Archive list.

Failure:

- Paper remains open;
- restore `取消 · 确认永久删除`;
- display failure in the Paper footer error area defined above.

Visual contract:

- existing top-right location remains `top:13px; right:24px`;
- text remains `13px`, `20px` line-height;
- do not add danger/red styling;
- title/body/date/metadata/signature do not move when entering confirm mode.

Remove every occurrence of `永久删除后无法恢复，确认继续吗？` from Memory / Diary / Task.

## 13. Home: Todo and Calendar module read states

Home retains its existing white iOS-like visual language and normal content geometry.

### 13.1 Shared Home state row

Equivalent Todo/Calendar read-state messaging uses:

- inserted after the module heading and before module content;
- heading → state `6px`;
- state line `min-height: 18px`;
- state → content `6px`;
- width `100%`;
- centered;
- `12px / 400 / #8a8a8a / 1.3`;
- Retry remains inline with text;
- text → Retry gap `6px`;
- Retry `#555555`, transparent, no border;
- when no state row exists, it occupies no space.

### 13.2 Todo

Ready with content:

- existing L/G cards remain unchanged.

Ready with no Todo content:

- keep the existing two empty paper/cards;
- do not add `暂无 Todo` or another empty-state message.

Loading:

- state row: `正在读取 Todo…`;
- hide the two Todo cards so loading cannot be mistaken for true empty;
- do not reserve an artificial 104px blank card area.

Error:

- state row: `Todo 暂时无法读取。  重试`;
- hide Todo cards;
- Retry reloads Todo only.

The Todo section is intentionally shorter during loading/error.

### 13.3 Calendar

Ready:

- current Calendar card remains unchanged;
- true absence of content is represented only by absence of content markers; no empty message.

Loading:

- state row: `正在读取 Calendar…`;
- retain the Calendar shell/base calendar;
- hide all content markers;
- month navigation is disabled while loading.

Error:

- state row: `Calendar 暂时无法读取。  重试`;
- remove the old error message from inside the Calendar card;
- retain the Calendar shell;
- hide all content markers;
- pure month browsing may remain available because it does not imply successful content-data loading;
- Retry reloads Calendar content only.

The different shell behavior between Todo and Calendar is intentional: Todo's empty papers represent business content, while Calendar has useful static structure even when content markers cannot load.

If Todo and Calendar both fail, each section shows its own error. Do not create a Home-wide global error banner.

## 14. Global Search states

Search idle/loading are immediate search feedback and therefore stay near the search controls. Empty/error are blocking result states and use a deeper state anchor.

### 14.1 Mobile

Idle:

- top margin `14px` below search controls;
- copy: `搜索 Memory、Diary、Task 与 Universe 中保存的内容`;
- `13px / 400 / #8d8d8d / 1.55`;
- centered.

Loading:

- same geometry as Idle;
- copy `正在搜索…`.

Empty:

- preserve current `96px` top offset;
- primary `没有找到匹配内容`;
- action `清除条件`;
- primary `13px / 500 / #777`;
- action `11px / 500 / #666`;
- vertical gap `10px`;
- centered.

Error:

- preserve current `96px` top offset;
- primary `搜索暂时失败`;
- action `重试`;
- same typography as Empty;
- vertical stack, gap `10px`;
- centered.

Load-more remains a separate list-bottom state and keeps its current centered placement with `margin-top: 20px`.

### 14.2 Desktop/Tablet

Idle/loading:

- search controls → state `28px`;
- centered;
- `13px / 400 / #8d8d8d / 1.55`.

Empty/error:

- search controls → state `64px`;
- inner `max-width: 360px`;
- centered;
- primary `13px / 500 / #777`;
- action `11px / 500 / #666`;
- vertical gap `10px`.

### 14.3 Search clear semantics

`清除条件` restores `DEFAULT_GLOBAL_SEARCH_FILTERS` and immediately starts the resulting search/idle flow defined by existing behavior. It does not navigate to another module.

## 15. Day Space

Day Space already has a dedicated mobile state anchor. Keep its `94px` value; do not force the Records `96px` value into it.

### 15.1 Blocking loading / empty

Use the existing stage state area:

- `padding-top: 94px`;
- centered;
- `12px / 400 / #aaaaaa`.

Messages:

- `正在读取 Day Space…`
- `正在读取当天内容…`
- `这一天还没有内容`

### 15.2 Discovery failure

Move the blocking discovery error out of the date-navigation area and into the central stage-state area.

- top anchor `94px`;
- primary `Day Space 暂时无法读取。`;
- action `重试`;
- primary `12px / #8a8a8a`;
- action `11px / #666`;
- gap `8px`;
- centered.

### 15.3 Todo + Diary both fail

Use the same blocking central state area:

- `当天内容暂时无法读取。`
- `重试`
- same `94px` anchor and typography.

### 15.4 Partial module failure

If only Todo or only Diary fails, usable content may remain visible, so this is not a blocking center state.

- keep the warning near date navigation;
- date navigation → warning `8px`;
- width `100%`;
- centered;
- `11px / #8a8a8a / 1.4`;
- copy `部分 Day Space 内容暂时无法读取。`;
- `重试 Todo` / `重试 Diary` stay inline as applicable;
- action gap `6px`.

### 15.5 Discovery incomplete warning

- keep near date navigation;
- top gap `8px`;
- centered;
- `11px / #8a8a8a`;
- preserve existing warning semantics;
- do not convert it into a blocking error.

## 16. Universe

Universe remains visually distinct. Do not reuse Records state typography or surfaces.

Equivalent cosmos-contained loading/empty/fatal-error states use the actual cosmos geometry:

- state wrapper `position:absolute; inset:0` within cosmos;
- `display:grid; place-items:center`;
- inner `max-width:360px`;
- centered;
- desktop cosmos min-height remains `560px`;
- mobile cosmos min-height remains `480px`;
- state text `14px / 400 / var(--muted) / 1.6`;
- text → action `12px`;
- Retry uses the existing Universe secondary-button visual language.

Loading:

- `正在读取 Universe…` with the existing loading dots;
- dots remain inline with the text;
- entire group is centered.

Empty:

- retain Universe's existing empty-state copy and theme;
- center it within cosmos.

Fatal read error:

- `Universe 暂时无法读取，请稍后重试。`
- action `重新加载`;
- same cosmos center.

The existing **not-initialized/import flow is unique and is not flattened into the generic cosmos error state**. Keep `UniverseImportFlow` and its current workflow semantics. Mutation notices remain in the Universe header and are not moved into the cosmos center.

## 17. System

Applies to equivalent read states in Connections / Activity / Data.

Keep System's English language and current card/button visual language.

### 17.1 Loading / empty

Inside the existing System section/card:

- padding `18px 13px`;
- `min-height: 52px`;
- `display:grid; place-items:center`;
- `12px / 400 / #8a8a8a / 1.3`;
- centered.

Activity true empty remains `No activity yet.`

Do not invent empty states for Connections/Data where the domain does not have one.

### 17.2 Read error

Inside existing System section/card:

- padding `18px 13px`;
- centered;
- error text `12px / #8a8a8a / 1.3`;
- Retry top margin `12px`;
- Retry keeps existing System button geometry:
  - `min-height:35px`
  - padding `6px 12px`
  - radius `10px`
  - `14px / 500`
- button centered.

Copy remains module-specific English, e.g. `Unable to read connection status.` / `Unable to read activity.` / `Unable to read data summary.`

Connections distinction:

- if `/system/connections` itself fails, show the page read-error state;
- if the request succeeds and an individual service is Offline/Unavailable/Not enabled, that is a normal ready-state row and must not become a page error.

Data Export / Import / Restore process-specific errors remain local to those workflows and are not converted to the shared System read-state pattern.

## 18. Auth

Auth/login/loading/error is already a separate centered product flow. This work does not redesign it or route session/authentication failures through ordinary module empty/error states.

## 19. Accessibility and live-region contract

- loading textual state: `role="status" aria-live="polite"`;
- true empty / filtered empty: normal state content; `role="status"` may be used, but not `alert`;
- blocking read failure: `role="alert"`;
- non-blocking informational warning: `role="status"`;
- actual partial read failure may use `role="alert"`, but should only announce when the failure first appears;
- Retry and Clear are native `<button type="button">` controls;
- state changes must not steal focus;
- do not auto-focus Retry/Clear buttons;
- existing Paper focus trap and focus restoration remain unchanged.

## 20. Animation contract

- do not add new fade, slide, pulse, spinner, or transition animations to empty/error/state messages;
- list skeletons retain the existing shimmer;
- Universe loading dots remain;
- state replacement is immediate to avoid visual drift or unnecessary layout animation.

## 21. No new global offline layer

Do not add `navigator.onLine` logic, a global offline banner, or a global all-modules error state.

Request failures remain scoped to the resource that failed.

Multiple simultaneous failures:

- Home Todo + Calendar: each section shows its own state;
- Day Space: both domain sources failing uses its explicit central fatal state because that is already a defined Day Space domain condition;
- System pages are independent;
- Memory / Diary / Task pages are independent;
- authentication/session failures continue through existing Auth behavior.

## 22. Implementation architecture

Prefer small shared primitives inside each state family rather than one universal component.

Recommended structure:

- Records: one shared state-message primitive/style contract for Memory / Diary / Task list/archive/mobile detail state copy and action layout;
- Records skeleton: one geometry contract reused by the three modules;
- Home: one lightweight Home module-state row used by Todo and Calendar;
- Paper: one `paper-detail-state` treatment plus one footer-error layout contract;
- System: share/normalize the existing `system-state-*` classes rather than introduce another component layer;
- Day Space, Search, Universe: keep module-specific state components/classes, but bring their equivalent internal states into the exact geometry defined above.

Do not perform unrelated component extraction or page refactoring.

## 23. Likely implementation surface

Expected files include, but are not limited to:

- `web/src/pages/MemoryPage.tsx`
- `web/src/pages/DiaryPage.tsx`
- `web/src/pages/TaskPage.tsx`
- `web/src/pages/TaskPaperEditor.tsx`
- `web/src/pages/PaperDetailDialog.tsx`
- `web/src/pages/DashboardPage.tsx`
- `web/src/pages/CalendarPreview.tsx`
- `web/src/pages/DaySpacePage.tsx`
- `web/src/pages/GlobalSearchPage.tsx`
- `web/src/pages/UniversePage.tsx`
- `web/src/pages/SystemConnectionsPageContent.tsx`
- `web/src/pages/SystemActivityPageContent.tsx`
- `web/src/pages/SystemDataPageContent.tsx`
- `web/src/styles.css`
- related tests.

Do not change backend endpoints, database behavior, MCP behavior, auth behavior, or production data.

## 24. Test and acceptance contract

Automated tests must cover at least:

1. Memory / Diary / Task true-empty and filtered-empty copy parity.
2. `清除条件` clears each module's complete filter set and preserves module/active-archive context.
3. Records read errors expose resource-specific primary copy, common secondary copy, and Retry.
4. Archive empty/error parity across Memory / Diary / Task.
5. Detail loading/error remains inside Paper on mobile; Memory archived error must not escape to a page-level state.
6. Task mobile and desktop detail read failures expose error copy and Retry.
7. Retry preserves filters/date/query/return context and transitions immediately to loading.
8. Stale requests cannot overwrite a newer request state.
9. List metadata left date/deadline does not shrink; right metadata ellipsizes.
10. Paper footer category/status stays visible and long mood/tags ellipsize before the signature safety boundary.
11. Paper footer mutation error does not overlap body content, metadata, or signature.
12. Permanent-delete warning copy is absent everywhere while confirmation actions remain.
13. Permanent-delete pending prevents duplicate submission and closing; success/failed transitions match this spec.
14. Home Todo and Calendar loading/error appear in equivalent state-row positions; Calendar's old in-card error is removed.
15. Global Search mobile and desktop state offsets/alignments follow this spec.
16. Day Space blocking versus partial-failure placement remains semantically distinct.
17. System read states center without changing individual connection-row semantics.
18. Skeleton accessibility (`aria-hidden`, `aria-busy`, hidden polite status) is correct.
19. Error/status live-region roles follow the accessibility contract.

Visual/manual acceptance must include mobile and desktop screenshots for:

- Memory / Diary / Task: true empty, filtered empty, read error, Archive empty, Archive error;
- one active list row and one archive row with intentionally overlong right-side metadata;
- each module detail with intentionally overlong metadata/tags;
- active and archived detail loading/error;
- permanent-delete confirm and pending states;
- Home Todo and Calendar loading/error;
- Global Search idle/loading/empty/error;
- Day Space empty/blocking error/partial error;
- Universe loading/error/empty without changing not-initialized flow;
- System Connections/Activity/Data loading/error and Activity empty.

Acceptance is about exact geometry, not just presence of copy: horizontal center, specified top offsets, typography, spacing, ellipsis behavior, and preserved module surfaces must be visually verified.

## 25. Explicit non-goals

Do not change:

- page-title visual system;
- normal Memory / Diary / Task row height or title typography;
- header tool positioning;
- normal filters/search controls;
- normal Todo card design;
- normal Calendar geometry;
- normal Paper body typography/date position;
- author-signature position/font;
- Universe nodes, relations, galaxy/map design;
- System normal data rows;
- module language choices;
- Auth flow;
- Import/Export workflow semantics;
- backend API contracts;
- database schema/data;
- MCP surface.

## 26. Definition of done

This design is complete when implementation produces the exact state-family behavior above with no remaining module-specific drift for equivalent states, while preserving intentionally different module identities and non-equivalent workflows.

Codex must not invent alternate copy, offsets, breakpoints, warning text, retry behavior, or state surfaces outside this specification. Any required deviation discovered during implementation must stop the change and return for design review before implementation continues.
