# Universe 主页深色重做设计

日期：2026-08-17

## 目标

将 Universe ready-state 主页从当前白底空间图重做为一块连续、克制、沉浸式的深色思维宇宙。只改变主页视觉层级和深色适配，不改变 Universe 的数据合同、节点/关系语义、地图手势、节点位置、筛选逻辑、创建/移动/打开流程或已验收内页。

核心观感：远看是一张安静的思维星图，近看才出现颜色、关系与层级；不要做霓虹科幻 UI，也不要做星空壁纸。

## 范围

本轮包含：
- Universe ready-state 主页背景与空间层级。
- Universe 主页标题与 `＋`、`···` 悬浮操作。
- 星系筛选与“查看全部”。
- 星球、membership 环、选中态与弱化态。
- 关系线与关系文字。
- `＋` placement popover、`···` export popover 的深色视觉适配。
- 主页操作反馈 / notice 的深色视觉适配。
- Universe 页面上的移动端全局顶部栏深色融合。
- 现有 18 个无数据含义的参考点的深色背景适配。

## 明确不做

- 不改 Universe 详情、创建/编辑、连接、Day Space 等已验收内页视觉。
- 不改导航抽屉。
- 不改桌面侧栏。
- 不改导航抽屉/侧栏的颜色、布局、结构或交互。
- 不改 Global Search 面板、导航体系或搜索行为；Universe 顶部栏只做当前页面表面的深色融合。
- 不新增箭头、粒子、流动路径、闪烁星空、随机动画或真实行星纹理。
- 不新增 Universe 功能。
- 不改数据库、domain/service contract、MCP、API、ownership、version/concurrency。
- 不借本轮重构 Universe 业务逻辑或其他页面样式。

## 1. 整体空间

Universe ready-state 整体使用连续近黑背景，建议落在 `#090a10` ~ `#101119` 范围内，由实现时选择一套固定 token 后统一使用。

要求：
- 页面、地图区域与移动端顶部栏读成一整块连续空间。
- 不使用明显渐变、星云、纹理图、玻璃蒙层或装饰性背景图片。
- 不保留当前 Universe ready-state 强制白色 surface。
- Desktop 若仍显示现有侧栏，侧栏保持现状；只让 Universe 内容 surface 进入深色，不重做桌面布局。

## 2. Universe 标题与主页悬浮操作

保留当前结构和位置关系：
- `Universe` 标题悬浮在地图上。
- 右侧 `＋` 与 `···` 悬浮在地图上。
- 不增加 toolbar 底板、胶囊、卡片或边框。

视觉：
- `Universe`：暖白，约 `#e8e7ec`。
- `＋ / ···` 默认：约 `#aaaab3`。
- active / expanded：约 `#e0dfe5`。
- 控件仍保持透明背景、无边框、无阴影。

## 3. 移动端全局顶部栏

保留现有结构和行为：左侧菜单、中间 `Leilei OS`、右侧搜索。

仅在 Universe 页面 surface 内做深色融合：
- 背景与 Universe 主页完全相同。
- 无底边线、无阴影、无玻璃模糊层。
- `Leilei OS` 约 `#aaaab3`，视觉层级低于 `Universe` 页面标题。
- 菜单与搜索图标默认约 `#898a94`，active / expanded 提亮到约 `#d6d5dc`。
- 保留现有顶部栏高度和点击区域。

导航抽屉与桌面侧栏完全不改。

## 4. 星球

### 保留现有语义

- 星球仍为圆形主体 + 标题。
- `anchor / major / normal` 三档重要度继续决定现有尺寸，不重新定义 importance 语义。
- 标题的缩放分级显示逻辑保留。
- 星球主体颜色继续来源于主星系。
- 多星系 membership 继续通过外围环表达。
- 选中节点后，当前节点与直接邻居保持清晰，其他节点弱化。

### 深色视觉

- 不做高饱和霓虹球，不做真实星球纹理。
- 主体保留星系原色，但针对深色背景适当提高可见明度/饱和度，仍保持柔和。
- 每颗星球只允许一层范围较小、透明度低的同色外晕，用于从近黑背景中浮出。
- 不使用粗描边。
- membership 环更暗、更细，像轨道，不压过主体。
- 选中态：主体轻微提亮 + 一圈极细暖白外环；不通过夸张放大表达选中。
- 普通标题约 `#b6b5bd`；选中标题约 `#ecebf0`。
- 非当前焦点节点弱化到约 25%–30% 的视觉强度，但不直接消失。

## 5. 关系线与关系文字

保留现有 relation 类型、聚焦逻辑和文本语义。

视觉：
- 默认关系线使用低存在感冷灰，约 `#343640`。
- 与当前选中节点直接相关的关系线提亮到约 `#676974`。
- 不按星系给整条关系线着彩色。
- 默认关系文字约 `#70727d`。
- 聚焦关系文字约 `#aaaab3`。
- 文字直接悬浮在线旁，不加标签底板；只允许非常轻的深色 text-shadow 保障可读性。
- 不在本轮新增关系方向箭头、粒子或流动动画。

视觉优先级始终是：星球 > 星球标题 > 聚焦关系 > 默认关系。

## 6. 星系筛选与“查看全部”

保留现有位置与行为：
- 左侧星系筛选。
- 右侧“查看全部”。
- 两者直接悬浮在地图上，无 toolbar 背景、无胶囊、无边框。

视觉：
- 默认文字约 `#898a94`。
- 当前选中星系 / active 状态约 `#d6d5dc`。
- 星系色点继续使用真实星系颜色，active 时可轻微提亮。
- “查看全部”沿用相同默认/active 文字层级。

筛选逻辑保持现状：不属于当前星系的节点继续隐藏，不改成半透明残留，避免与“选中节点聚焦弱化”混淆。

### 星系菜单

统一使用深色 popover 语言：
- 背景约 `#171820`。
- 1px 细边框约 `#343640`。
- 轻量深色阴影。
- 文字使用灰白层级。
- 当前选中行只用极轻 `#23242d` 背景 + 更亮文字，不使用大块高亮色。
- 星系色点仍是主要分类识别。

## 7. `＋` 与 `···` 弹窗

保留刚验收完成的几何合同，不重新调整宽高、内边距或锚定方式。

### `＋`

保留现有流程：打开 placement popover → 显示“点击地图选择新星球的位置” → 用户点击地图位置 → 进入创建页面。

### `···`

当前只保留“导出”，不借本轮新增操作。

### 深色 popover 语言

两个弹窗完全统一：
- 背景约 `#171820`。
- 边框约 `#343640`，1px。
- 10px 圆角。
- 默认文字约 `#b0aeb7`。
- hover / active 文字约 `#ecebf0`。
- hover 行只给极轻 `#22232b` 背景。
- 阴影仅用于从近黑主页中分层，不做发光。
- placement 提示继续居中，不加图标或箭头。

## 8. 操作反馈 / Notice

保留现有 notice 文案、位置逻辑与约 3 秒自动消失行为。

视觉：
- 继续使用无底板悬浮文字。
- 普通成功/完成反馈约 `#8f909b`，不变绿色。
- 错误状态允许使用低饱和暗红。
- 不新增 Toast 卡片、图标或动画。

## 9. 背景参考点

保留当前 18 个无数据语义的 reference dots，但只作为极弱空间参照：
- 数量不增加。
- 深色背景下使用极暗灰白，基准约 `#292a32`。
- 可允许少量点比其他点略亮，但整体必须明显弱于任何数据节点。
- 不闪烁、不漂移、不随机运动。
- 不赋予任何 Universe 数据含义。

## 10. 行为与状态必须保持

本轮视觉重做不得破坏：
- 地图单指平移、双指缩放。
- `查看全部` fit viewport。
- 星球单击选择 / 再次打开详情的现有合同。
- 长按移动星球及移动提示。
- placement 模式及取消。
- Global Search deep-link reveal node。
- active galaxy filtering。
- selection / direct-neighbor emphasis。
- viewport preference persistence。
- 现有 create/edit/delete/relation/move notice 行为。
- 现有 export 行为。

## 11. 实现边界

优先通过 Universe ready-state 专属样式边界完成，避免把深色规则扩散到已验收 Paper/detail/edit/relation/Day Space。

如果必须改组件结构：
- 只允许为明确的样式隔离、状态 class 或当前视觉合同提供最小必要结构。
- 不改变业务事件流与数据 shape。
- 不重写 `UniverseMobileMap` 交互状态机。

当前 Universe home 已有多轮 polish/geometry override，实施时必须先梳理 cascade，避免继续用无法解释优先级的大量 `!important` 堆叠；可以增加一个清晰的 final dark-home surface 层，但必须让适用范围可读、可测试。

## 12. 测试与回归

实现阶段至少验证：
- ready-state home 深色 surface 不泄漏到 Universe 内页。
- Universe mobile top bar 在 ready-state 为深色，但导航抽屉/桌面侧栏未被改色。
- `＋ / ··· / galaxy menu` 的几何保持现有已验收值，只变视觉。
- active galaxy filter 行为不变。
- selected node / neighbor / muted node 的 class 与行为不变。
- relation 默认/强调状态仍正确。
- placement、move、fit-all、deep-link reveal 不回归。
- existing focused Universe tests。
- Web typecheck / build。
- `git diff --check`。

## 13. Production 验收

merge + production deployment 后，用真实移动端至少检查：
1. 从系统顶部栏下方到 Universe 星图为连续近黑，没有残余白带。
2. 导航抽屉/桌面侧栏仍保持原设计。
3. `Universe`、`＋`、`···`、星系筛选、“查看全部”的层级清楚但不抢星图。
4. 星球颜色柔和可辨，选中态清楚，未选中弱化合理。
5. 默认关系存在但安静，选中关系明显提升。
6. 三类深色 popover（placement / export / galaxy）统一，没有白盒闪现。
7. notice 在深色背景上可读且不呈现系统 Toast 感。
8. 18 个背景点只提供非常弱的空间感。
9. 平移、缩放、选择、打开、移动、创建、筛选、查看全部、导出均正常。

满足以上视觉与行为检查后，Universe 主页深色重做才算 production accepted。
