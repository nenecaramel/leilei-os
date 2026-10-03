import Foundation

var checks = 0
func expect(_ condition: @autoclosure () -> Bool, _ name: String) {
    precondition(condition(), name); checks += 1
}
func presentation(_ text: String, role: String = "assistant", payload: [String:NativeLiveJSONValue]? = nil) -> NativeLiveMessagePresentation {
    let b = NativeLiveCurrentPathBlock(id:"canonical",ordinal:7,kind:"text",rawType:"text",text:text,payload:payload,createdAt:"")
    return NativeLiveMessagePresentationProjector.project(.init(messageID:"message",role:role,blocks:[b],phase:.canonical))
}
func nodes(_ text: String) -> [NativeLiveVisualNode] { presentation(text).nodes[0].children }
func text(_ node: NativeLiveVisualNode) -> String { node.markdown.map { String($0.inline.characters) } ?? node.text ?? "" }

// Independent review regressions run separately so each failure is observed.
if CommandLine.arguments.contains("--review-budget") {
    let result = nodes(String(repeating:"$x$ ",count:30000))
    expect(result.count == 1 && result[0].markdown?.isPlainFallback == true, "inline descendants respect shared node budget")
    print("Rich Markdown PASS: review budget"); exit(0)
}
if CommandLine.arguments.contains("--review-format") {
    for source in ["**before $x$ after**", "*before $x$ after*", "~~before $x$ after~~"] {
        let result = nodes(source)[0]
        expect(String(result.markdown!.inline.characters) == "before x after", "math retains whole-paragraph inline formatting")
        let intent: InlinePresentationIntent = source.hasPrefix("**") ? .stronglyEmphasized : source.hasPrefix("~~") ? .strikethrough : .emphasized
        expect(result.markdown!.inline.runs.allSatisfy { $0.inlinePresentationIntent?.contains(intent) == true }, "format spans math")
    }
    print("Rich Markdown PASS: review format"); exit(0)
}
if CommandLine.arguments.contains("--review-spans") {
    expect(nodes("See [reference](https://example.com) for $x^2$.")[0].children.contains { $0.kind == .math }, "math coexists with link")
    expect(nodes("``$x$``")[0].children.isEmpty, "double backtick code excludes math")
    expect(nodes("``a ` $x$`` and $y$")[0].children.filter { $0.kind == .math }.map { $0.math!.latex } == ["y"], "matching backtick runs")
    expect(nodes("[x](https://example.com/$q$) and $y$")[0].children.filter { $0.kind == .math }.map { $0.math!.latex } == ["y"], "URL math-like text excluded locally")
    print("Rich Markdown PASS: review spans"); exit(0)
}
if CommandLine.arguments.contains("--review-crlf") {
    expect(nodes("before\r\n$x$")[0].children[1].sourceRangeUTF16 == 8..<11, "CRLF canonical source range")
    expect(nodes("```swift\r\n  let x = 1\r\n```\r\n")[0].code?.code == "  let x = 1", "copy excludes complete CRLF fence separator")
    print("Rich Markdown PASS: review CRLF"); exit(0)
}
if CommandLine.arguments.contains("--review-quotes") {
    let started = Date()
    let result = nodes(String(repeating:"> ",count:60000)+"quote")
    expect(result[0].markdown?.style == .quote(8) && text(result[0]) == "quote", "deep quotes visible and bounded")
    expect(Date().timeIntervalSince(started) < 5, "deep quote scan remains bounded")
    print("Rich Markdown PASS: review quotes"); exit(0)
}

expect(nodes("plain").count == 1 && text(nodes("plain")[0]) == "plain", "paragraph")
expect(text(nodes("one\ntwo")[0]) == "one\ntwo", "multiline")
expect(nodes("one\n\ntwo").count == 2, "blank line paragraphs")
for level in 1...6 {
    expect(nodes(String(repeating:"#",count:level)+" heading")[0].markdown?.style == .heading(level), "heading \(level)")
}
for (source, intent) in [("**bold**", InlinePresentationIntent.stronglyEmphasized), ("*italic*", .emphasized), ("`code`", .code), ("~~deleted~~", .strikethrough)] {
    expect(nodes(source)[0].markdown!.inline.runs.contains { $0.inlinePresentationIntent?.contains(intent) == true }, "inline \(source)")
}
expect(nodes("[safe](https://example.com)")[0].markdown!.inline.runs.contains { $0.link?.host == "example.com" }, "safe link")
for scheme in ["javascript:", "file:///tmp/a", "data:text/plain,x", "custom://host", "ui://app", "https://u:p@example.com"] {
    expect(nodes("[unsafe](\(scheme))")[0].markdown!.inline.runs.allSatisfy { $0.link == nil }, "unsafe link \(scheme)")
}
expect(nodes("- item")[0].markdown?.style == .list(marker:"•",depth:0), "unordered")
expect(nodes("12. item")[0].markdown?.style == .list(marker:"12.",depth:0), "ordered")
expect(nodes("- outer\n  - inner")[1].markdown?.style == .list(marker:"•",depth:1), "nested list")
expect(nodes(String(repeating:" ",count:200)+"- deep")[0].markdown?.style == .list(marker:"•",depth:8), "bounded list nesting")
expect(nodes("> quote")[0].markdown?.style == .quote(1), "quote")
expect(nodes("> > quote")[0].markdown?.style == .quote(2), "nested quote")
expect(nodes("---")[0].markdown?.style == .divider, "divider")
let code = nodes("```swift linenos\n  let x = 1\n```\n")[0]
expect(code.kind == .code && code.code?.language == "swift", "typed language fence")
expect(code.code?.info == "swift linenos", "full info retained; no filename invented")
expect(code.code?.code == "  let x = 1", "code copy and indentation")
expect(code.code?.closed == true, "closed fence")
expect(nodes("~~~alien\nx\n~~~")[0].code?.language == "alien", "unknown tilde fence visible")
expect(nodes("```\nx\n```")[0].code?.language == nil, "unlabelled fence")
expect(nodes("```swift\n"+String(repeating:"x",count:20000)+"\n```")[0].code?.code.count == 20000, "long code line")
expect(nodes("```swift\n+1\n-2\n```")[0].kind == .code, "ordinary plus minus not diff")
let diff = nodes("```diff\n--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n same\n```")[0]
expect(diff.kind == .diff, "diff fence")
expect(nodes("```patch\n+x\n```")[0].kind == .diff, "patch fence")
expect(diff.diff?.lines.map(\.kind) == [.header,.header,.hunk,.removed,.added,.context], "unified line classification")
expect(diff.diff?.rawSource == "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new\n same", "copy full diff")
expect(diff.diff?.lines[4].accessibilityText == "added: +new", "diff accessibility addition")
expect(diff.diff?.lines[3].accessibilityText == "removed: -old", "diff accessibility removal")
let tableRaw = "| A | B |\n|:---|---:|\n| one\\|two | |\n"
let table = nodes(tableRaw)[0].table!
expect(nodes(tableRaw)[0].kind == .table, "GFM typed table")
expect(table.headers == ["A","B"] && table.rows == [["one|two",""]], "escaped pipe and empty cell")
expect(table.alignments == [.leading,.trailing], "table alignment")
expect(table.columnWidth == 180 && table.cells.count == 2, "bounded horizontal layout")
expect(table.rawSource == tableRaw, "table copy original raw")
expect(nodes("|A|B|\n|---|---|\n|one|").allSatisfy { $0.kind != .table }, "uneven table fallback")
expect(nodes("|A|B|\n|xx|---|\n|1|2|").allSatisfy { $0.kind != .table }, "invalid separator visible")
expect(nodes("|A|B|\n|---|---|\n|`a|b`|c|")[0].table?.rows[0][0] == "`a|b`", "inline code pipe")
expect(nodes("|**A**|\n|---|\n|*B*|")[0].table?.cells[0][0].runs.contains { $0.inlinePresentationIntent?.contains(.stronglyEmphasized) == true } == true, "table inline formatting")
let inlineParagraph = nodes("before $x^2$ after")
expect(inlineParagraph.count == 1 && inlineParagraph[0].kind == .markdown, "inline math must preserve one wrapping paragraph")
let inline = inlineParagraph[0].children
expect(inline.map(\.kind) == [.markdown,.math,.markdown], "inline math")
expect(inline[1].math == .init(latex:"x^2",isDisplay:false), "math copy LaTeX and mode")
expect(inline[1].sourceRangeUTF16 == 7..<12, "inline math source range includes delimiters")
expect(nodes("# 标题 $x$")[0].children[1].sourceRangeUTF16 == 5..<8, "heading math canonical source range")
expect(nodes("$$\nx^2\n$$")[0].math == .init(latex:"x^2",isDisplay:true), "display math")
expect(nodes("$$x+y$$")[0].math?.isDisplay == true, "single line display math")
expect(nodes("$5 and USD $10").allSatisfy { $0.kind != .math }, "currency")
expect(nodes("$unclosed").allSatisfy { $0.kind != .math }, "unclosed inline math")
expect(nodes("$$\nunclosed").allSatisfy { $0.kind != .math }, "unclosed display math")
expect(nodes(#"\$literal$ and `$code$`"#).allSatisfy { $0.kind != .math }, "escaped math and code")
let mermaid = nodes("```mermaid\ngraph TD\nA-->B\n```")[0]
expect(mermaid.kind == .mermaid && mermaid.code?.code == "graph TD\nA-->B", "Mermaid typed and visible source")
expect(NativeLiveMessageRendererRegistry.renderer(for:mermaid) == .mermaid, "Mermaid native source renderer")
expect(nodes("```swi")[0].code?.closed == false, "stream partial fence")
let partial = nodes("```swift\nlet x =")
expect(partial[0].code?.code == "let x =", "unclosed code keeps data")
expect(partial[0].id == nodes("```swift\nlet x = 1\n```")[0].id, "append-stable fence identity")
expect(nodes("***unmatched")[0].text == "***unmatched", "malformed emphasis visible")
expect(text(nodes(#"\*literal\*"#)[0]) == "*literal*", "escaped inline")
expect(text(nodes("你好 👩🏽‍💻 é")[0]) == "你好 👩🏽‍💻 é", "Unicode preserved")
expect(text(nodes("<script>alert(1)</script>")[0]) == "<script>alert(1)</script>", "HTML literal")
let huge = String(repeating:"x",count:NativeLiveRichTextProjector.maximumUTF16+1)
expect(nodes(huge).count == 1 && nodes(huge)[0].markdown?.isPlainFallback == true && nodes(huge)[0].text == huge, "oversized visible raw fallback")
expect(presentation(huge).copyText == huge, "oversized copy preserved")
expect(nodes(String(repeating:"- x\n",count:3000)).count == 1, "node budget fallback")
let raw = " before\n\n```swift\n  let x = 1\n```\n"
expect(nodes(raw).map(\.id) == nodes(raw).map(\.id), "deterministic projection")
let citation: NativeLiveJSONValue = .object(["url":.string("https://example.com"),"encrypted_index":.string("opaque"),"start_char_index":.number(8),"end_char_index":.number(12)])
let provenance: NativeLiveJSONValue = .object(["provider":.string("claude_code"),"parent_id":.string("parent")])
let rich = presentation(raw,payload:["provenance":provenance,"citations":.array([citation])])
expect(rich.copyText == raw, "copy raw canonical including whitespace")
expect(rich.nodes[0].children.allSatisfy { $0.sourceBlock.id == "canonical" && $0.ordinal == 7 && $0.canonicalIdentity == "text" }, "canonical source identity and ordinal")
expect(rich.nodes[0].children.allSatisfy { $0.provenance == provenance }, "provenance retained")
expect(rich.nodes[0].children.allSatisfy { $0.citations == rich.nodes[0].citations }, "citation relationship retained on children")
expect(rich.citationSources.count == 1 && rich.citationSources[0].relations.count == 1, "source aggregation no split duplication")
expect(rich.citationSources[0].relations[0].fields["start_char_index"] == .number(8) && rich.citationSources[0].relations[0].providerID == .string("opaque"), "provider indices and identity unchanged")
let voice = presentation(raw,role:"user",payload:["input_mode":.string("voice")])
expect(voice.isVoiceInput && voice.nodes[0].children.allSatisfy { $0.inputMode == "voice" }, "voice preserved")
expect(voice.textNodes.count == 1 && voice.copyText == raw, "single user bubble and edit raw text")
let b = NativeLiveCurrentPathBlock(id:"structured",ordinal:1,kind:"canonical_tool_result",rawType:"tool_result",text:nil,payload:["schema_version":.number(1),"identity":.string("canonical_tool_result"),"structured":.object(["schema_version":.number(1),"parts":.array([.object(["type":.string("text"),"text":.string(raw)])])])],createdAt:"")
let structured = NativeLiveMessagePresentationProjector.project(.init(messageID:"s",role:"assistant",blocks:[b],phase:.canonical))
expect(structured.nodes[0].children[0].children.contains { $0.kind == .code && $0.canonicalIdentity == "canonical_tool_result" }, "structured text reuses rich projection")
expect(structured.nodes[0].children[0].children[0].id.hasPrefix("structured:part:0:rich:"), "structured part identity namespace")
let execution = NativeLiveCurrentPathBlock(id:"exec",ordinal:0,kind:"tool_result",rawType:"tool_result",text:raw,payload:nil,createdAt:"")
expect(NativeLiveMessagePresentationProjector.project(.init(messageID:"exec",role:"assistant",blocks:[execution],phase:.canonical)).nodes.isEmpty, "ordinary tools excluded from Chat")
let future = NativeLiveCurrentPathBlock(id:"future",ordinal:0,kind:"future",rawType:"future",text:nil,payload:nil,createdAt:"")
expect(NativeLiveMessagePresentationProjector.project(.init(messageID:"f",role:"assistant",blocks:[future],phase:.canonical)).nodes[0].fallback.title == "Unsupported content", "future fail visible")
for kind in [NativeLiveVisualNodeKind.code,.table,.diff,.math] {
    expect(NativeLiveMessageRendererRegistry.renderer(for:kind) != .fallback, "rich registry \(kind)")
}
let streaming = NativeLiveMessagePresentationProjector.project(.streaming("```swi"))
let finalStream = NativeLiveMessagePresentationProjector.project(.streaming("```swift\nlet x = 1\n```"))
expect(streaming.nodes[0].children[0].id == finalStream.nodes[0].children[0].id, "runtime streaming append stable")
expect(finalStream.nodes[0].children[0].code?.language == "swift", "runtime streaming final language")
expect(NativeLiveMessagePresentationProjector.project(.streaming("")).nodes.isEmpty, "empty stream no orphan")
print("Rich Markdown PASS: \(checks) real Swift assertions")
