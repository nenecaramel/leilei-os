开始 Mainline 2G：**Visual Renderer Foundation**。

**F 整阶段跳过 / deferred，不实现。**

仓库：`nenecaramel/leilei-os`

当前已知 latest main：

`dc454173a1154dad2ea5c6b66e105e10005c7ad0`

这是 E `#837` merge 后的 main。

开工前必须重新 fetch `origin/main`；如果 main 已移动，以实际 latest main 为 base。

建议分支：

`feat/visual-renderer-foundation`

完成后开独立 PR，不要 merge。

# 本轮重新定义后的 G

原路线：

```text
F Artifact + MCP Resource
G Visual Renderer
```

现在改为：

```text
F deferred

G
├ Renderer Registry 收口
├ Native / Sandboxed visual renderer infrastructure
├ Math full visual rendering
├ Mermaid rendering
├ SVG attachment rendering
├ renderer lifecycle / sizing / failure / retry
└ future visual kinds fail-visible
```

**删除所有必须依赖 F 才能成立的部分。**

本轮不做：

```text
Artifact entity/store/lifecycle
Resource entity/store/lifecycle
MCP Resource materialization
MCP App
ui:// interactive capability
Artifact WebView
Resource WebView
interactiveResource host
webArtifact host
resource bridge
Artifact/resource permission/capability negotiation
```

F 只是跳过，不算 DONE。

# 当前真实基础

截至 latest main：

B–E 已经形成：

```text
Canonical Identity
→ Presentation Projection
→ Visual Node
→ Renderer Registry
```

现有 `NativeLiveVisualNodeKind` 包含：

```text
text
markdown
attachment
artifact
resource
canonical_tool_result
unknown

structured_json
code
table
diff
math
citation
search_result

image
gallery
file
document
mermaid
svg
chart
diagram
web_artifact
interactive_resource
```

目前真正有可信 upstream producer / presentation 的复杂视觉主要是：

```text
E Markdown
├ .math
└ .mermaid

C Attachment
└ SVG attachment
```

`chart / diagram / webArtifact / interactiveResource` 当前没有 authoritative producer。

**不要为了 G 把这些 kind 人工制造出来。**

# 核心目标

G 要把当前逐渐扩大的：

```swift
NativeLiveMessageRendererRegistry
```

真正收口成唯一 rendering authority。

目标：

```text
Visual Node
    ↓
Renderer Registry
    ├ Native renderer
    ├ Sandboxed visual renderer
    └ Fail-visible fallback
```

而不是：

```text
MessageRow
→ 看 kind
→ renderer自己再猜
→ WebView自己再猜
```

# Renderer ownership

坚持三层：

```text
Presentation projector
“这是什么”

Renderer Registry
“由哪个 renderer负责”

Renderer
“怎么画”
```

renderer不能重新：

- 判断 canonical identity
- 读取 provider event type决定产品身份
- 从 raw payload猜 visual identity
- 创建 canonical content
- 创建 attachment/artifact/resource entity

# Registry

重构/扩展现有：

`NativeLiveMessageRendererRegistry`

但不要为了名字好看重新建第二个 registry。

最终所有 `NativeLiveVisualNodeKind` 必须有明确结果：

```text
supported renderer
或
fallback
```

不能存在：

```swift
default:
    EmptyView()
```

也不能因为“以后 F 会实现”就静默不显示。

至少明确：

```text
markdown → native
code → native
table → native
diff → native
math → visual renderer
mermaid → visual renderer
attachment → C media
canonicalToolResult → D renderer
structuredJSON → D renderer
searchResult → D renderer
citation → D renderer

artifact → fallback
resource → fallback
webArtifact → fallback
interactiveResource → fallback

chart → fallback
diagram → fallback

unknown → fallback
```

SVG attachment按本任务下文处理。

# Sandboxed visual host

G 可以引入一个**通用的本地 visual sandbox**，用于复杂确定性视觉。

例如：

```text
NativeLiveVisualSandbox
```

可以基于 `WKWebView`。

但它不是通用浏览器，也不是 Artifact/MCP host。

它只接受 renderer-owned、已经分类后的可信 presentation input，例如：

```text
Math LaTeX
Mermaid source
verified SVG bytes
```

绝对不能接受：

```text
arbitrary provider HTML
arbitrary URL
resource URI
ui:// URI
file:// supplied by payload
Artifact HTML
tool-result HTML
```

# Sandbox security contract

如果使用 WKWebView，必须：

- nonpersistent data store
- 禁止普通 navigation
- 禁止打开外部页面
- 禁止任意 network
- 禁止 remote script/style/font/image fetch
- 禁止任意 `file://`
- 禁止跨源资源
- 禁止 window.open
- 禁止 arbitrary JS bridge
- 禁止把 provider HTML直接 `loadHTMLString`
- CSP 明确阻断网络
- renderer只生成自己的 bounded HTML shell
- dynamic content通过安全编码后的 data注入，而不是字符串拼 HTML/JS

允许的 native bridge只能是最小协议，例如：

```text
ready
contentHeight
renderError
```

不能暴露：

```text
filesystem
network proxy
attachment lookup
arbitrary native method invocation
```

# Runtime network

**0 runtime CDN。**

禁止：

```text
cdn.jsdelivr
unpkg
cdnjs
Google fonts
remote MathJax
remote KaTeX
remote Mermaid
remote image/font assets
```

任何视觉 engine都必须：

```text
bundled locally
or
implemented natively
```

离线状态下 Math / Mermaid / SVG必须和在线状态表现一致。

# Third-party assets

如果需要加入 KaTeX / Mermaid 或其他 renderer：

先审：

- 当前仓库 dependency policy
- binary/JS体积
- license
- transitive runtime behavior
- 是否需要 network

优先使用成熟、离线、可固定版本的方案。

PR 必须列：

```text
dependency/version
license
bundled size
runtime network requirement = none
```

不要随手塞 minified vendor blob 而不说明来源/version/license。

也不要改根 `package.json`，除非这是 iOS build真正必要且没有更合适的本地 asset管理方式。

# Math

E 当前：

```text
.math
NativeLiveMathPresentation
├ latex
└ isDisplay
```

E 明确只实现：

```text
bounded LaTeX source fallback
```

G 现在负责正式 visual Math rendering。

目标：

```text
.math
→ rendered equation
```

支持：

- inline Math
- display Math
- common LaTeX math syntax
- fractions
- superscript/subscript
- roots
- Greek
- sums/integrals
- matrices/alignment，如果 chosen engine支持
- long equation horizontal handling
- dark/light
- Dynamic Type合理适配
- accessibility fallback
- copy raw LaTeX

如果 visual engine render失败：

```text
render error
→ E 的 LaTeX source fallback
```

绝不能：

```text
render error
→ empty
```

Math canonical/presentation规则不改。

尤其 E 已确认：

```text
$10$ = math
unpaired currency = plain text
```

G 只负责画，不重做 Math parser。

# Inline Math

E 当前 inline Math仍属于一个 wrapping paragraph presentation。

G 如果完整 typesetting inline formula会破坏 paragraph wrapping，需要谨慎。

可以：

1. 实现可靠 native/attachment inline visual run；

或

2. 如果当前技术栈无法可靠把 WebView公式嵌进 native `Text` paragraph：

保持 E 当前 inline LaTeX fallback，只把 display Math升级为完整 visual renderer。

如果选择 2：

必须诚实写：

```text
Display Math: full visual renderer
Inline Math: native LaTeX fallback retained
```

不要为了“全支持”做一个会破坏正文换行/selection/accessibility 的 hack。

**正确性优先于形式上的 feature checkbox。**

# Mermaid

E 已经把：

````text
```mermaid
...
```
````

正式投影成：

```text
.mermaid
```

G 要实现真正 diagram renderer。

要求：

- local Mermaid runtime
- no network
- source bounded
- dark/light theme
- content自动 fit
- 可纵向自适应合理高度
- 超宽 diagram有明确 scroll/fit策略
- parse error可见
- rendering error可见
- copy Mermaid source
- accessibility至少有：
  - “Mermaid diagram”
  - source fallback / readable description入口

不要：

- 把 Mermaid变 Artifact
- 把 Mermaid变 canonical diagram identity
- 从 provider/tool result猜 Mermaid
- 执行 Mermaid click handlers / external links
- 开启任意 Mermaid securityLevel

使用最严格适用的 security configuration。

# Mermaid lifecycle

必须处理 streaming：

E streaming时可能先出现：

```text
```mermaid
graph TD
```

然后不断增长。

不要每个字符变化都创建新的 WebView。

需要：

- stable node identity
- renderer update同一 view
- bounded debounce/coalescing
- cancellation
- stale render result不能覆盖新 source

final canonical replacement后：

- 不闪成空白
- 不留下旧 diagram
- identity transition合理

# SVG attachment

C 已经：

```text
NativeLiveMediaKind.svg
```

并且下载仍走 C 的：

```text
authoritative attachment
→ verified bytes
→ size/SHA check
→ original bytes cache
```

G 只能消费**C 已验证的 SVG bytes**。

不能新建下载路径。

正确：

```text
SVG attachment
→ C nativeLiveAttachmentBytes()
→ verified bytes
→ SVG visual renderer
```

禁止：

```text
SVG renderer
→ URLSession自己下载
```

# SVG安全

SVG 本质上可以包含危险能力。

因此不能直接信任原始 SVG。

至少需要防：

- `<script>`
- event handlers
- external href/src
- remote image
- `foreignObject`
- external CSS/font
- external resource reference
- navigation
- animation/event abuse如 chosen renderer认为危险
- oversized/pathological payload

如果采用 WebKit：

- CSP 断网
- 不允许 SVG触发 navigation
- 不允许 scripts
- 不允许 foreign external content

如果 chosen rendering path不能安全限制 SVG：

**fallback 到 verified file/Quick Look，而不是渲染。**

# SVG display

SVG attachment应正式变成 inline visual preview，而不再只是：

```text
SVG preview · Open
```

至少：

- inline preview
- tap进入适合的 fullscreen/preview
- 保持 aspect ratio
- long/wide SVG bounded
- loading
- failure
- retry
- open verified original
- 不重新下载 verified bytes

SVG不需要加入 bitmap gallery，除非实际 UX验证证明合理。

不要把 SVG强行塞进 bitmap ImageIO。

# C cache复用

Math/Mermaid没有 attachment bytes。

SVG必须复用 C：

```text
Original bytes cache
```

不能建立：

```text
VisualRendererSVGDownloadCache
```

可以建立 renderer-specific derived cache，例如：

```text
sanitized SVG
rendered snapshot
layout result
```

但 key必须基于：

```text
attachment identity + integrity identity
```

而不是 URL/filename。

# WebView lifecycle

如果使用 WKWebView：

不要每个 SwiftUI `body`创建新实例。

考虑：

- stable coordinator
- renderer input equality
- cancellation
- reuse
- reset
- memory warning
- view disappear
- app background
- large visual cleanup

不能出现滚一遍聊天生成几十个永久活着的 WebView。

需要明确的 resource strategy。

# Height / layout

sandbox renderer要有稳定 sizing contract。

禁止：

```text
WebView 自己无限高
```

至少：

```text
min height
natural content height
max inline height
scroll beyond max
```

height更新需：

- bounded
- ignore NaN/negative/absurd values
- avoid resize feedback loop
- avoid conversation上下跳动
- stale generation不可更新当前高度

这点要专门做 regression。

# Loading / failure

所有 complex visual surface至少有：

```text
loading
ready
failed
fallback
```

不要用白块表示 loading/error。

例如：

```text
Rendering diagram…
Could not render diagram
View source
Retry
```

Math render失败：

```text
→ raw LaTeX
```

Mermaid失败：

```text
→ source preview
```

SVG失败：

```text
→ file card / Quick Look
```

# Renderer fallback contract

G 需要建立统一 fallback policy。

例如：

```text
unsupported kind
missing renderer
invalid presentation
visual engine unavailable
render timeout/error
```

都必须：

```text
visible content or source fallback
```

不能 EmptyView。

# Renderer timeout

复杂 renderer不能无限 pending。

需要合理 render timeout / cancellation。

超时：

```text
failed
→ retry / source fallback
```

测试用 deterministic fake renderer，不要依赖 wall-clock flaky sleep。

# Chart / Diagram

当前没有 authoritative producer。

因此本轮：

```text
.chart → fail-visible fallback
.diagram → fail-visible fallback
```

不要：

- 为测试人工接 provider payload
- 用 JSON字段猜 chart
- 创建 chart schema
- 创建 diagram canonicalization

未来有 producer再接。

# Artifact / Resource / F相关内容全部剔除

这部分非常严格。

本轮禁止实现：

```text
.artifact renderer
.resource renderer
.webArtifact renderer
.interactiveResource renderer

Artifact storage
Artifact versioning
Artifact share/send
Artifact HTML

MCP embedded Resource materialization
Resource fetch
Resource storage
Resource preview authority
Resource capability upgrade

MCP App
ui:// host
postMessage MCP bridge
tool callback bridge
MCP app state
MCP app permissions
```

Registry里这些 kind只允许：

```text
fallback
```

并有 tests 锁住：

```text
artifact/resource/ui:// cannot accidentally become sandbox visual input
```

# arbitrary HTML

G 的 sandbox不是 HTML renderer。

不要增加：

```text
.html
rawHTML
web_content
```

之类的新 visual identity。

Markdown raw HTML仍按 E 的 literal行为。

# Navigation

sandbox必须禁止导航。

即使 renderer output里出现：

```text
<a href="https://...">
```

也不能在 WebView内部加载。

如未来确实需要安全 link：

必须交给现有 native URL policy。

但 G 的 Math/Mermaid/SVG默认应该完全禁掉 rendered-content interaction/navigation。

# Process / crash isolation

要处理 WebKit：

- process terminated
- content process crash
- navigation failure
- JS evaluation failure

不能因为一次 Mermaid crash导致 message永久空白。

至少进入 failure/source fallback。

# Accessibility

Math：

- accessibility label至少包含 raw LaTeX
- rendered visual不是唯一信息源

Mermaid：

- 有 “Mermaid diagram”
- source可访问/copy

SVG：

- filename作为 fallback label
- 如果没有真实 alt metadata，不要自己生成描述

不要调用 AI生成 alt text。

# Copy

保持：

```text
Math → copy raw LaTeX
Mermaid → copy source
SVG → file share/open沿用 C
Message → canonical raw text
```

renderer不能修改 message copy。

# Visual engine cache

如果增加 derived rendering cache：

必须：

- bounded
- deterministic key
- source hash / visual input identity
- theme/scale等真正影响输出的参数才进 key
- 不保存无限 HTML
- 不保存 renderer runtime state跨 message泄漏

不要让不同 conversation/message共享 mutable JS state。

# Theme

必须覆盖：

- light
- dark
- system切换

Theme变化应重新 render视觉或更新 renderer theme。

不能要求重新打开 conversation。

# Dynamic Type

至少验证：

- default
- large accessibility size下不会 crash/遮挡

复杂 visual本身不要求所有图形按 Dynamic Type放大，但：

- controls
- source fallback
- labels

必须正常。

# Reduce Motion

如果 Mermaid/SVG含 animation：

默认不依赖动画表达语义。

Respect Reduce Motion，或直接禁 renderer animation。

# Suggested files

可以按职责调整，例如：

```text
MessageSurface/
├ NativeLiveVisualRendererRegistry.swift
├ NativeLiveVisualSandbox.swift
├ NativeLiveVisualSandboxModel.swift
├ NativeLiveMathVisualRenderer.swift
├ NativeLiveMermaidRenderer.swift
├ NativeLiveSVGRenderer.swift
└ NativeLiveVisualFallback.swift
```

不要把 WebKit host、Math、Mermaid、SVG全部堆进一个文件。

当前 `NativeLiveMessageRendererRegistry` 是 authority；如果拆 registry 文件，必须是**移动 authority**，不是再套一层竞争 registry。

# Backend

G 原则上是 iOS/presentation/rendering工作。

不要改：

- canonical backend
- conversation projection
- D trusted share
- bridge normalization
- attachment storage schema

如果发现 blocker，写在 PR里，不要借 G重构 backend。

# Tests

至少覆盖真实 Swift / iOS contract：

## Registry

1. 每个 `NativeLiveVisualNodeKind`都有确定 renderer/fallback
2. no `default: EmptyView`
3. renderer registry唯一 authority
4. MessageRow不重新按 provider/canonical type dispatch
5. artifact → fallback
6. resource → fallback
7. webArtifact → fallback
8. interactiveResource → fallback
9. chart → fallback
10. diagram → fallback

## Math

11. display Math进入 full visual renderer
12. valid LaTeX render success
13. invalid LaTeX → raw fallback
14. raw LaTeX仍可 copy
15. dark/light
16. long equation bounded
17. renderer failure visible
18. renderer retry
19. no network
20. no arbitrary navigation

如果 inline Math也 full render，再增加相应 wrapping regression。

如果 inline Math保持 E fallback，tests明确锁定这一事实。

## Mermaid

21. `.mermaid` → Mermaid renderer
22. basic graph
23. sequence diagram
24. malformed syntax → source fallback
25. source可 copy
26. no network
27. no external navigation
28. no event/script escape
29. stable streaming node identity
30. stale async render不能覆盖新 source
31. bounded height
32. huge source fallback/bounds
33. light/dark
34. renderer process failure fallback

## SVG

35. C SVG attachment进入 SVG renderer
36. verified bytes复用 C fetch/cache
37. renderer不自行下载
38. valid simple SVG
39. aspect ratio
40. huge/wide SVG bounded
41. script-containing SVG不可执行
42. event handler不可执行
43. external href/resource不可 fetch
44. `foreignObject`安全策略明确
45. malformed SVG fallback到 file
46. retry
47. Quick Look/open original仍可用
48. size/SHA失败时绝不能进入 renderer
49. same SVG preview/fullscreen不重新下载 original

## Sandbox

50. nonpersistent
51. network blocked
52. file access blocked
53. arbitrary navigation blocked
54. arbitrary provider HTML不可进入 sandbox
55. bounded JS/native bridge
56. invalid height ignored
57. absurd height clamped
58. stale height ignored
59. content process termination → fallback
60. cancellation
61. view reuse / lifecycle
62. cache bounded

## Regressions

63. A canonical contract
64. B presentation model
65. C media
66. D structured/search/citation
67. E Markdown/code/table/diff/math parsing
68. #812 voice
69. #813 question
70. ordinary Tool Activity
71. hidden/ambient Tool Activity
72. copy message
73. streaming/final replacement
74. unknown/future content fail-visible

# Security test

增加明确 source / runtime regression，确保 sandbox实现里没有：

```text
http://
https://
cdn.
load(URLRequest(providerURL))
allowFileAccessFromFileURLs
allowUniversalAccessFromFileURLs
arbitrary evaluateJavaScript(payload)
```

如果 bundled engine source内部包含字符串 URL，测试不能简单误杀 vendor bundle；应检查 runtime loader / host code，而不是 grep整个 third-party asset。

# Real sandbox test

不要只有 source regex。

至少要有真实 iOS/WebKit executable/UI integration fixture验证：

```text
renderer loads local shell
→ content renders
→ height回传
→ network/navigation被拒绝
→ malformed content进入fallback
```

如果 CI环境无法完整启动 WKWebView：

至少：

- Simulator build
- host/model真实 Swift tests
- navigation policy unit tests
- message handler validation tests

并把物理 visual acceptance留给真机门。

# Existing renderer regressions

必须确保 G 不倒退：

- Markdown
- code
- table
- diff
- D citations
- Search Result
- Structured JSON
- Structured Tool Result
- attachment/image gallery
- Quick Look
- voice
- Activity

# Verification

跑：

- G focused tests
- E rich Markdown
- D structured/search/citation
- C media
- B presentation
- A canonical contract
- current-path
- #812 voice
- #813 question
- historical Tool Activity
- relevant Postgres regressions
- production runtime gate
- complete Claude bridge
- typecheck
- check:generated
- build
- git diff --check
- unsigned iOS Simulator build

最后：

```text
pnpm test
```

与 **exact latest-main baseline** 同环境、同顺序比较：

```text
added failure names
removed failure names
```

不能只报数量。

# 真机

G 合并前不要求完整 physical gate作为 code blocker。

但 PR 必须写：

```text
Mainline 3 rich-surface physical acceptance: pending
C media physical acceptance: pending
```

G merge后，H前/最终真机需要实际验：

```text
Math
Mermaid
SVG
dark/light
rotation
large visual
streaming Mermaid
render error/retry
memory/reopen conversation
offline mode
```

以及 D/E已有：

```text
citations
search
structured results
Markdown
code
table
diff
copy/selection
```

# F状态

PR 必须明确：

```text
Mainline 2F: deferred / skipped
```

不是：

```text
done
not applicable
implicitly covered by G
```

G 不能声称实现：

- Artifact
- Resource
- MCP App

# H影响

完成本 G 后，H 只验：

```text
A–E + G
```

F相关 acceptance全部从当前 H gate剔除，直到未来单独恢复 F。

也就是说这条支线现在是：

```text
A ✅
B ✅
C ✅ code / physical pending
D ✅
E ✅
F deferred
G ← current
H = A–E + G compatibility / mixed / device closure
```

# PR

PR标题：

`feat: add sandboxed visual renderers`

PR body必须写清：

- exact base SHA
- exact head SHA
- F explicitly deferred
- changed files
- renderer registry ownership
- native vs sandbox responsibilities
- sandbox security model
- runtime network = none
- third-party renderer/version/license/size
- Math实际支持层级
- Mermaid renderer
- SVG verified-bytes path
- C cache复用
- WebView lifecycle
- sizing contract
- theme
- cancellation/stale render protection
- failure/source fallback
- chart/diagram fallback
- artifact/resource/webArtifact/interactiveResource fallback
- out-of-scope F
- focused tests
- security tests
- Simulator结果
- full-suite exact baseline delta
- physical acceptance pending

不要 merge。

完成后停在 PR 等待 review。