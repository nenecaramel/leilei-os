import Foundation

enum NativeLiveToolCallState: Equatable { case running, completed, failed, unknown }
let conversation = "12345678-1234-1234-1234-123456789abc"
let start = "2026-10-04T00:00:00.000Z"
let now = ISO8601DateFormatter().date(from:"2026-10-04T00:00:08Z")!
var checks = 0
func expect(_ value: @autoclosure () -> Bool, _ label: String) { precondition(value(),label); checks += 1 }
func message(_ id: String, _ role: String, parent: String? = nil, text: String = "", prepare: String? = nil) -> NativeLiveCurrentPathMessage {
    .init(id:id,conversationId:conversation,parentMessageId:parent,role:role,status:"completed",createdAt:start,completedAt:start,
          blocks:text.isEmpty ? [] : [.init(id:id+":block",ordinal:0,kind:"text",rawType:"text",text:text,payload:nil,createdAt:start)],
          activity:prepare.map { .init(prepareId:$0,events:[],interactions:[],durationMs:18_000) })
}
func snapshot(_ messages: [NativeLiveCurrentPathMessage]) -> NativeLiveCurrentPathSnapshot {
    .init(conversationId:conversation,title:nil,currentHeadMessageId:messages.last?.id,updatedAt:start,syncToken:messages.last?.id ?? "empty",truncated:false,olderCursor:nil,resetRequired:false,messages:messages)
}
func prepared(_ id: String, user: String) -> NativeLivePrepareResult {
    .init(outcome:"created",semanticPending:false,prepareId:id,requestId:"request-"+id,conversationId:conversation,userMessageId:user,workspaceId:nil,expectedWorkspaceRoot:nil)
}
func surface(_ prepare: String, user: String, text: String = "", terminal: Bool = false) -> NativeLiveRuntimeSurfaceState {
    var value = NativeLiveRuntimeSurfaceState(prepareID:prepare,conversationID:UUID(uuidString:conversation)!,events:[],interactions:[],controls:[],nextAfterSequence:0)
    value.userMessageID = user
    value.startedAt = start
    if !text.isEmpty { value.events.append(.init(sequence:1,event:.init(type:"partial_text",providerSessionID:nil,payload:["delta":.string(text)]),createdAt:start)) }
    if terminal { value.events.append(.init(sequence:2,event:.init(type:"result",providerSessionID:nil,payload:["duration_ms":.number(18_000)]),createdAt:start)); value.foregroundTurnCompleted = true }
    return value
}
let prefix = [message("uA","user",text:"A"),message("aA","assistant",parent:"uA",text:"Answer A")]
let old = snapshot(prefix+[message("uB","user",text:"B"),message("aB","assistant",parent:"uB",text:"Old answer B")])
var assembler = NativeLiveConversationPresentationAssembler()
var identities = NativeLiveTurnIdentityCoordinator()
func rows(_ snapshot: NativeLiveCurrentPathSnapshot?, _ pending: NativeLivePendingOperation? = nil, _ runtime: NativeLiveRuntimeSurfaceState? = nil) -> [NativeLiveConversationRowPresentation] {
    assembler.project(snapshot:snapshot,pendingOperation:pending,runtimeSurface:runtime,backgroundRuntimeSurfaces:[:],identities:identities,now:now)
}
let send = NativeLivePendingOperation(kind:.send(text:"New"),baselineSyncToken:nil)
let initial = rows(snapshot(prefix),send)
expect(initial.count == 4,"Send first frame immediately has one user and one assistant")
let userID = initial[2].id, assistantID = initial[3].id
expect(initial[3].assistant?.header == "Thinking…","first frame Thinking")
identities.bind(send,prepared:prepared("pSend",user:"uNew"),snapshot:snapshot(prefix))
for frame in [surface("pSend",user:"uNew"),surface("pSend",user:"uNew",text:"Hel"),surface("pSend",user:"uNew",text:"Hello"),surface("pSend",user:"uNew",text:"Hello",terminal:true)] {
    let projected = rows(snapshot(prefix+[message("uNew","user",text:"New")]),send,frame)
    expect(projected.count == 4 && projected[2].id == userID && projected[3].id == assistantID,"Send prepared/runtime stable rows")
}
let canonical = snapshot(prefix+[message("uNew","user",text:"New"),message("aNew","assistant",parent:"uNew",text:"Hello",prepare:"pSend")])
let finalRows = rows(canonical,nil,surface("pSend",user:"uNew",text:"Hello",terminal:true))
expect(finalRows[2].id == userID && finalRows[3].id == assistantID,"canonical backing preserves user and assistant IDs")
expect(finalRows[3].assistant?.copyText == "Hello","body appears once, not HelloHello")
let richIDs = finalRows[3].assistant!.bodyPresentation.nodes.flatMap(\.children).map(\.id)
expect(!richIDs.isEmpty,"body uses E rich presentation")
for kind in [NativeLivePendingOperation.Kind.edit(targetUserMessageID:"uB",text:"Edited"),.retry(targetUserMessageID:"uB")] {
    assembler = .init(); identities = .init()
    _ = rows(old)
    let operation = NativeLivePendingOperation(kind:kind,baselineSyncToken:nil)
    let pending = rows(old,operation)
    expect(pending.count == 4 && pending[3].assistant?.copyText == nil,"old branch atomically replaced in first pending frame")
    let slot = pending[3].id
    expect(pending[3].assistant?.header == "Thinking…","replacement first frame Thinking")
    identities.bind(operation,prepared:prepared("pReplace",user:operation.editedText == nil ? "uB" : "uEdited"),snapshot:old)
    for frame in [surface("pReplace",user:operation.editedText == nil ? "uB" : "uEdited"),surface("pReplace",user:operation.editedText == nil ? "uB" : "uEdited",text:"Replacement")] {
        let next = rows(old,operation,frame)
        expect(next.count == 4 && next[3].id == slot,"Edit/Retry intermediate row count and slot stable")
        expect(next.filter { $0.assistant?.copyText == "Old answer B" }.isEmpty,"old answer never leaks into replacement branch")
    }
    let newUser = operation.editedText == nil ? "uB" : "uEdited"
    let next = rows(snapshot(prefix+[message(newUser,"user",text:operation.editedText ?? "B"),message("aReplacement","assistant",parent:newUser,text:"Replacement.",prepare:"pReplace")]),nil,surface("pReplace",user:newUser,text:"Replacement",terminal:true))
    expect(next.count == 4 && next[3].id == slot && next[3].assistant?.copyText == "Replacement.","authoritative mismatch reconciles once in same replacement slot")
}
assembler = .init(); identities = .init()
let recovered = surface("pRecovered",user:"uRecovered",text:"Hello")
let recoveryPrefix = snapshot(prefix+[message("uRecovered","user",text:"Q")])
let before = rows(recoveryPrefix,nil,recovered)
let after = rows(snapshot(prefix+[message("uRecovered","user",text:"Q"),message("aRecovered","assistant",parent:"uRecovered",text:"Hello",prepare:"pRecovered")]),nil,recovered)
expect(before.count == after.count && before.last!.id == after.last!.id,"recovery binds prepare lineage without a second assistant")
expect(before.last!.assistant!.bodyPresentation.nodes.flatMap(\.children).map(\.id) == after.last!.assistant!.bodyPresentation.nodes.flatMap(\.children).map(\.id),"rich IDs stable while canonical block provenance changes")
expect(before.last!.assistant!.timestamp == after.last!.assistant!.timestamp,"handoff timestamp stable")
expect(after.last!.assistant!.bodyPresentation.nodes[0].sourceBlock.id == "aRecovered:block","canonical source identity remains true")
// Execution and interaction frames share provider entity IDs throughout status upgrades.
func event(_ type: String,_ payload: [String:NativeLiveJSONValue],_ sequence: Int) -> NativeLiveRuntimeEventSnapshot {
    .init(sequence:sequence,event:.init(type:type,providerSessionID:nil,payload:payload),createdAt:start)
}
func permission(_ status: String) -> NativeLiveRuntimeInteractionSnapshot {
    .init(interactionID:"permission",prepareID:"pActivity",kind:"permission",request:["toolUseId":.string("tool"),"toolName":.string("Read")],status:status,
        response:status == "resolved" ? ["decision":.string("allow")] : nil,createdAt:start,updatedAt:start,resolvedAt:nil,cancelledAt:nil)
}
assembler = .init(); identities = .init()
var operation = NativeLivePendingOperation(kind:.send(text:"Use tools"),baselineSyncToken:nil); operation.startedAt = start
_ = rows(snapshot(prefix),operation)
identities.bind(operation,prepared:prepared("pActivity",user:"uActivity"),snapshot:snapshot(prefix))
let activityPath = snapshot(prefix+[message("uActivity","user",text:"Use tools")])
var active = surface("pActivity",user:"uActivity",text:"Partial")
var turn = rows(activityPath,operation,active).last!.assistant!
expect(turn.header == "Thinking for 8s","running tick uses start")
active.events.append(event("tool_use",["tool_use_id":.string("tool"),"tool_name":.string("Read"),"input":.object([:])],2))
turn = rows(activityPath,operation,active).last!.assistant!
expect(turn.header == "Working for 8s · 1 step" && turn.activityProjection.tools[0].id == "tool","tool Running has stable ID")
active.interactions = [permission("pending")]
turn = rows(activityPath,operation,active).last!.assistant!
expect(turn.header == "Working for 8s · 1 step · Needs input","Needs input header ordering")
expect(turn.activityProjection.permissionInteractions(for:turn.activityProjection.tools[0]).first?.id == "permission","Permission nested in its tool")
active.interactions = [permission("resolved")]
active.events.append(event("tool_result",["tool_use_id":.string("tool"),"output":.string("Done")],3))
active.events.append(event("tool_result",["tool_use_id":.string("tool"),"output":.string("Done")],4))
turn = rows(activityPath,operation,active).last!.assistant!
expect(turn.activityProjection.tools.count == 1 && turn.activityProjection.tools[0].state == .completed,"duplicate result updates same tool")
expect(turn.activityProjection.interactions[0].id == "permission" && !turn.hasPendingInput,"Permission resolve retains item")
active.events.append(event("result",["duration_ms":.number(18_000)],5)); active.foregroundTurnCompleted = true
turn = rows(activityPath,operation,active).last!.assistant!
expect(turn.header == "Worked for 18s · 1 step" && turn.copyText == "Partial","terminal fixes duration and preserves body")
active.events.append(event("task",["phase":.string("started"),"task_id":.string("task"),"is_backgrounded":.bool(true),"status":.string("running")],6))
turn = rows(activityPath,operation,active).last!.assistant!
expect(turn.duration == 18,"background updates never extend foreground duration")
expect(turn.header == "Working in background · 2 steps","foreground finished background task overlays same row")
active.events.append(event("error",["message":.string("failed")],7))
turn = rows(activityPath,operation,active).last!.assistant!
expect(turn.phase == .failed && turn.copyText == "Partial" && turn.activityProjection.tools.count == 1,"failure preserves body and evidence")
// Question resolution upgrades the same AskUserQuestion item and retains answer details.
assembler = .init(); identities = .init()
identities.bind(operation,prepared:prepared("pActivity",user:"uActivity"),snapshot:snapshot(prefix))
var questionSurface = surface("pActivity",user:"uActivity")
questionSurface.events = [event("tool_use",["tool_use_id":.string("q"),"tool_name":.string("AskUserQuestion"),"input":.object(["questions":.array([.object(["question":.string("Theme?")])])])],1)]
questionSurface.interactions = [.init(interactionID:"question",prepareID:"pActivity",kind:"question",request:["toolUseId":.string("q"),"questions":.array([.object(["question":.string("Theme?")])])],status:"pending",response:nil,createdAt:start,updatedAt:start,resolvedAt:nil,cancelledAt:nil)]
let pendingQuestion = rows(activityPath,operation,questionSurface).last!.assistant!
questionSurface.interactions = [.init(interactionID:"question",prepareID:"pActivity",kind:"question",request:questionSurface.interactions[0].request,status:"resolved",response:["answers":.object(["Theme?":.string("Dark")])],createdAt:start,updatedAt:start,resolvedAt:start,cancelledAt:nil)]
let resolvedQuestion = rows(activityPath,operation,questionSurface).last!.assistant!
expect(pendingQuestion.activityProjection.questionActivities[0].id == resolvedQuestion.activityProjection.questionActivities[0].id,"Question Pending to Answered keeps item identity")
expect(resolvedQuestion.activityProjection.questionActivities[0].responseDetail?.contains("Dark") == true && resolvedQuestion.activityProjection.questionActivities[0].statusLabel == "Answered","answered question retains details")
expect(resolvedQuestion.stepCount == 1,"question evidence counted once")
// Live/final/reload duration and a single semantic timestamp slot.
let finalMessage = message("aDuration","assistant",parent:"uActivity",text:"Final",prepare:"pActivity")
let durationPath = snapshot(prefix+[message("uActivity","user",text:"Use tools"),finalMessage])
var completedSurface = surface("pActivity",user:"uActivity",text:"Final",terminal:true)
let finalTurn = rows(durationPath,nil,completedSurface).last!.assistant!
completedSurface.events.append(event("runtime",["kind":.string("session_state_changed"),"state":.string("idle")],9))
let refreshedTurn = rows(durationPath,nil,completedSurface).last!.assistant!
expect(finalTurn.id == refreshedTurn.id && finalTurn.duration == 18 && refreshedTurn.duration == 18 && finalTurn.timestamp == refreshedTurn.timestamp,"canonical refresh cannot retime or re-own turn")
var reload = NativeLiveConversationPresentationAssembler()
let reloadedTurn = reload.project(snapshot:durationPath,pendingOperation:nil,runtimeSurface:nil,backgroundRuntimeSurfaces:[:],identities:.init(),now:now.addingTimeInterval(1000)).last!.assistant!
expect(reloadedTurn.duration == 18 && reloadedTurn.header == "Thought for 18s","reload pure thought fixed duration")
let noActivity = rows(snapshot([message("noActivity","assistant",text:"Only body")])).last!.assistant!
expect(noActivity.header.isEmpty,"no duration or activity shows timestamp only")
// A replacement starts fresh despite using the same UI slot as a completed turn.
assembler = .init(); identities = .init()
_ = rows(old)
let retry = NativeLivePendingOperation(kind:.retry(targetUserMessageID:"uB"),baselineSyncToken:nil)
expect(rows(old,retry).last!.assistant!.activityProjection.tools.isEmpty,"regeneration does not inherit old execution state")
// Draft send cannot leak a previously open conversation into the first frame.
var draftSend = NativeLivePendingOperation(kind:.send(text:"Draft"),baselineSyncToken:nil); draftSend.isDraftConversation = true
expect(rows(old,draftSend).count == 2,"draft first frame contains only new optimistic pair")
// Final text confirms/updates the logical body instead of duplicating deltas.
assembler = .init(); identities = .init()
let recoveringPath = snapshot(prefix+[message("uRecovered","user",text:"Q")])
var accumulated = surface("pRecovered",user:"uRecovered",text:"Hel")
expect(rows(recoveringPath,nil,accumulated).last!.assistant!.copyText == "Hel","first delta body")
accumulated.events.append(event("partial_text",["delta":.string("lo")],2))
expect(rows(recoveringPath,nil,accumulated).last!.assistant!.copyText == "Hello","deltas grow one body")
accumulated.events.append(event("text",["text":.string("Hello.")],3))
accumulated.events.append(event("result",["duration_ms":.number(18_000)],4))
expect(rows(recoveringPath,nil,accumulated).last!.assistant!.copyText == "Hello.","final runtime confirms logical body")
// A stale overlay cannot downgrade a known terminal tool/interaction.
let doneProjection = resolvedQuestion.activityProjection
let pendingProjection = pendingQuestion.activityProjection
let monotonic = NativeLiveTurnActivityProjection(durable:doneProjection,overlay:pendingProjection,active:false,elapsed:18)
expect(monotonic.questionActivities[0].statusLabel == "Answered" && !monotonic.hasPendingInteraction,"late pending question cannot resurrect input")
// Edit backend failure rolls back the canonical tree without an orphan optimistic row.
assembler = .init(); identities = .init()
let edit = NativeLivePendingOperation(kind:.edit(targetUserMessageID:"uB",text:"Edited"),baselineSyncToken:nil)
_ = rows(old,edit)
let rollback = rows(old)
expect(rollback.count == 4 && rollback[2].user?.copyText == "B" && rollback[3].assistant?.copyText == "Old answer B","failed edit rolls back entire original branch")
var ui = NativeLiveMessageUIStateStore()
expect(!ui["turn"].isActivityExpanded,"default collapsed")
ui["turn"].pendingInputChanged(true)
expect(ui["turn"].activityExpansion == .autoExpanded,"pending input automatically expands")
ui["turn"].pendingInputChanged(false)
expect(!ui["turn"].isActivityExpanded,"pure automatic expansion may resolve")
ui["turn"].toggleActivity()
for pending in [true,false,true,false] { ui["turn"].pendingInputChanged(pending); expect(ui["turn"].isActivityExpanded,"manual expansion survives runtime/canonical/resolve") }
ui["turn"].toggleActivity(); ui["turn"].pendingInputChanged(true)
expect(ui["turn"].activityExpansion == .userCollapsed,"manual collapse is explicit intent")
ui[userID].voiceTranscriptExpansion = true
expect(ui[userID].voiceTranscriptExpansion,"stable user voice state survives backing")
var scroll = NativeLiveConversationScrollState()
expect(scroll.shouldFollowContent,"initial bottom follows")
scroll.geometryChanged(isNearBottom:false)
expect(scroll.shouldShowReturnToBottom,"geometry always updates return button")
scroll.interactionChanged(true); scroll.geometryChanged(isNearBottom:false); scroll.interactionChanged(false)
for _ in 0..<6 { scroll.geometryChanged(isNearBottom:false); expect(!scroll.shouldFollowContent && scroll.shouldShowReturnToBottom,"partial/tool/canonical/menu/sheet/tap cannot steal scroll") }
scroll.returnToBottom(); expect(scroll.shouldFollowContent && !scroll.shouldShowReturnToBottom,"explicit return resumes following")
let anchor = NativeLiveConversationScrollState.Anchor(stableID:"uB",relativeOffset:-31)
expect(scroll.preservedAnchor(before:anchor,survivingIDs:["uA","uB","replacement"]) == anchor,"prepend/edit preserves stable row and exact offset")
expect(NativeLiveConversationLoadPresentation.project(hasSnapshot:true,hasRows:true,ready:false,failed:true) == .content,"stale refresh failure keeps content")
expect(NativeLiveConversationLoadPresentation.project(hasSnapshot:false,hasRows:false,ready:false,failed:false) == .quietLoading,"initial load is quiet")
expect(NativeLiveConversationLoadPresentation.project(hasSnapshot:true,hasRows:false,ready:true,failed:false) == .empty,"confirmed ready empty only")
expect(NativeLiveConversationLoadPresentation.project(hasSnapshot:false,hasRows:false,ready:false,failed:true) == .unavailable,"no data failure offers retry")
// Recovery of an older Retry owns the entire replacement branch, not just its assistant.
assembler = .init(); identities = .init()
var olderRetry = surface("pOlder",user:"uA",text:"Recovered replacement")
olderRetry.operation = "retry"
let olderRows = rows(old,nil,olderRetry)
expect(olderRows.count == 2 && olderRows[0].user?.copyText == "A","recovered older retry atomically truncates downstream path")
let recoveredCanonical = snapshot([message("uA","user",text:"A"),message("aRecoveredOlder","assistant",parent:"uA",text:"Recovered replacement",prepare:"pOlder")])
let recoveredSlot = rows(recoveredCanonical,nil,olderRetry).last!.id
let retryAgain = NativeLivePendingOperation(kind:.retry(targetUserMessageID:"uA"),baselineSyncToken:nil)
expect(rows(recoveredCanonical,retryAgain).last!.id == recoveredSlot,"Retry of recovered canonical keeps existing visible slot")
// An early empty canonical backing must never blank the streaming body.
assembler = .init(); identities = .init()
_ = rows(recoveryPrefix,nil,recovered)
let emptyCanonical = snapshot(prefix+[message("uRecovered","user",text:"Q"),message("aRecovered","assistant",parent:"uRecovered",prepare:"pRecovered")])
expect(rows(emptyCanonical,nil,recovered).last!.assistant!.copyText == "Hello","empty canonical backing retains logical body")
// History belongs to this assembled tree and has exactly one distinct fork boundary.
let history = NativeLiveConversationHistorySnapshot(conversationId:conversation,sourceProvider:"claude_code",sourceProviderSessionId:"history",sourceLabel:nil,timeZone:"UTC",messageCount:1,firstMessageAt:start,lastMessageAt:start,createdAt:start,messages:[.init(ordinal:0,role:"assistant",time:start,content:"Imported")])
let forkRows = assembler.project(snapshot:old,historySnapshot:history,pendingOperation:nil,runtimeSurface:nil,backgroundRuntimeSurfaces:[:],identities:identities,now:now)
expect(forkRows.count == 6 && forkRows.filter(\.isHistoryDivider).count == 1,"history and current branch share one assembler with one divider")
expect(Set(forkRows.map(\.id)).count == forkRows.count,"history and current IDs cannot collide")
// Provider entities keep identity through failure, denial and background completion.
assembler = .init(); identities = .init()
var taskSurface = surface("pActivity",user:"uActivity",text:"Body",terminal:true)
taskSurface.events.append(event("tool_use",["tool_use_id":.string("failedTool"),"tool_name":.string("Read")],3))
let runningTool = rows(activityPath,nil,taskSurface).last!.assistant!
taskSurface.events.append(event("tool_result",["tool_use_id":.string("failedTool"),"is_error":.bool(true),"output":.string("denied")],4))
taskSurface.interactions = [.init(interactionID:"deny",prepareID:"pActivity",kind:"permission",request:["toolUseId":.string("failedTool")],status:"resolved",response:["decision":.string("deny")],createdAt:start,updatedAt:start,resolvedAt:start,cancelledAt:nil)]
let failedTool = rows(activityPath,nil,taskSurface).last!.assistant!
expect(runningTool.activityProjection.tools[0].id == failedTool.activityProjection.tools[0].id && failedTool.activityProjection.tools[0].state == .failed,"tool Running to Failed keeps ID")
expect(failedTool.activityProjection.interactions[0].response?["decision"]?.stringValue == "deny","denied Permission evidence remains attached")
taskSurface.events.append(event("task",["phase":.string("started"),"task_id":.string("bg"),"is_backgrounded":.bool(true)],5))
let runningTask = rows(activityPath,nil,taskSurface).last!.assistant!
taskSurface.events.append(event("task",["phase":.string("notification"),"task_id":.string("bg"),"status":.string("completed")],6))
let doneTask = rows(activityPath,nil,taskSurface).last!.assistant!
expect(runningTask.activityProjection.tasks[0].id == doneTask.activityProjection.tasks[0].id && doneTask.activityProjection.tasks[0].isTerminal,"Task completion updates same entity")
expect(runningTask.id == doneTask.id && doneTask.phase == .completed && doneTask.duration == 18,"background completion never creates row or retimes foreground")
let staleTask = NativeLiveTurnActivityProjection(durable:doneTask.activityProjection,overlay:runningTask.activityProjection,active:false,elapsed:18)
expect(staleTask.tasks[0].isTerminal && staleTask.tools[0].state == .failed,"late runtime cannot downgrade terminal task/tool")
// Rich UI namespaces ignore execution ledger ordinal shifts, preserving E/G children.
let richText = "```mermaid\ngraph TD; A-->B\n```\n\n$$x^2$$\n\n```swift\nlet x = 1\n```"
let liveRich = NativeLiveMessagePresentationProjector.project(.streaming(richText),presentationNamespace:"stable-rich")
let richBlock = NativeLiveCurrentPathBlock(id:"real-block",ordinal:3,kind:"text",rawType:"text",text:richText,payload:nil,createdAt:start)
let ledger = NativeLiveCurrentPathBlock(id:"ledger",ordinal:0,kind:"tool_use",rawType:"tool_use",text:nil,payload:["tool_use_id":.string("ledger-tool"),"tool_name":.string("Read")],createdAt:start)
let richMessage = NativeLiveCurrentPathMessage(id:"canonical-rich",conversationId:conversation,parentMessageId:"uA",role:"assistant",status:"completed",createdAt:start,completedAt:start,blocks:[ledger,richBlock],activity:nil)
let canonicalRich = NativeLiveMessagePresentationProjector.project(.canonical(richMessage),presentationNamespace:"stable-rich")
expect(liveRich.nodes.flatMap(\.children).map(\.id) == canonicalRich.nodes.flatMap(\.children).map(\.id),"Math Mermaid code IDs survive real canonical ledger ordinals")
expect(canonicalRich.nodes[0].sourceBlock.id == "real-block","UI namespace never overwrites canonical provenance")
// Completion refresh may fail before the prepared user enters the current snapshot.
assembler = .init(); identities = .init()
var failSoftSend = NativeLivePendingOperation(kind:.send(text:"Keep optimistic"),baselineSyncToken:nil); failSoftSend.startedAt = start
let failSoftInitial = rows(snapshot(prefix),failSoftSend)
identities.bind(failSoftSend,prepared:prepared("pFailSoft",user:"uMissing"),snapshot:snapshot(prefix))
var delayed = surface("pFailSoft",user:"uMissing",text:"Kept body")
_ = rows(snapshot(prefix),failSoftSend,delayed)
delayed.foregroundTurnCompleted = true
let withoutPending = rows(snapshot(prefix),nil,delayed)
expect(withoutPending.count == 4 && withoutPending[2].id == failSoftInitial[2].id && withoutPending[3].id == failSoftInitial[3].id,"completion refresh failure retains prepared optimistic pair")
expect(withoutPending[3].assistant!.copyText == "Kept body","completion refresh failure retains body")
delayed.events.append(event("result",["duration_ms":.number(18_000)],3))
expect(rows(snapshot(prefix),nil,delayed).last!.assistant!.duration == 18,"delayed provider duration replaces approximate terminal elapsed")
// Multiple durable text blocks must preserve the same direct rich render tree.
let firstText = NativeLiveCurrentPathBlock(id:"first-text",ordinal:0,kind:"text",rawType:"text",text:"Intro",payload:nil,createdAt:start)
let secondText = NativeLiveCurrentPathBlock(id:"second-text",ordinal:1,kind:"text",rawType:"text",text:richText,payload:nil,createdAt:start)
let splitCanonical = NativeLiveCurrentPathMessage(id:"split-canonical",conversationId:conversation,parentMessageId:"uA",role:"assistant",status:"completed",createdAt:start,completedAt:start,blocks:[firstText,secondText],activity:nil)
let joinedLive = NativeLiveMessagePresentationProjector.project(.streaming("Intro\n\n"+richText),presentationNamespace:"split-turn")
let splitBody = NativeLiveMessagePresentationProjector.project(.canonical(splitCanonical),presentationNamespace:"split-turn")
expect(joinedLive.renderNodes.map(\.id) == splitBody.renderNodes.map(\.id),"multiple canonical text blocks preserve logical rich child IDs")
// A slow prepare must not freeze a pre-authority timestamp into live presentation.
assembler = .init(); identities = .init()
var slowSend = NativeLivePendingOperation(kind:.send(text:"Slow prepare"),baselineSyncToken:nil); slowSend.startedAt = start
_ = rows(snapshot(prefix),slowSend)
var slowPrepared = prepared("pSlow",user:"uSlow"); slowPrepared.startedAt = "2026-10-04T00:01:05.000Z"
identities.bind(slowSend,prepared:slowPrepared,snapshot:snapshot(prefix))
var slowRuntime = surface("pSlow",user:"uSlow",text:"Done",terminal:true); slowRuntime.startedAt = slowPrepared.startedAt
let liveTime = rows(snapshot(prefix),slowSend,slowRuntime).last!.assistant!.timestamp
let slowCanonical = NativeLiveCurrentPathMessage(id:"aSlow",conversationId:conversation,parentMessageId:"uSlow",role:"assistant",status:"completed",createdAt:"2026-10-04T00:01:30.000Z",completedAt:nil,blocks:[],activity:.init(prepareId:"pSlow",events:[],interactions:[],durationMs:18_000,startedAt:slowPrepared.startedAt))
var slowReload = NativeLiveConversationPresentationAssembler()
let reloadTime = slowReload.project(snapshot:snapshot([message("uSlow","user",text:"Slow prepare"),slowCanonical]),pendingOperation:nil,runtimeSurface:nil,backgroundRuntimeSurfaces:[:],identities:.init(),now:now).last!.assistant!.timestamp
expect(liveTime == reloadTime && liveTime == slowPrepared.startedAt,"slow preparation uses the same durable timestamp live and after reload")
let removedAnchor = NativeLiveConversationScrollState.Anchor(stableID:"removed-downstream",relativeOffset:-31)
expect(scroll.preservedAnchor(before:removedAnchor,survivingIDs:["uA","replacement"],replacementID:"replacement") == .init(stableID:"replacement",relativeOffset:-31),"removed downstream anchor falls back to replacement slot at same viewport offset")
// Foreground and background overlays both contribute to the original canonical row.
var fgOverlay = surface("pOverlay",user:"uA",text:"Final",terminal:true)
fgOverlay.events.append(event("tool_use",["tool_use_id":.string("fg-tool"),"tool_name":.string("Read")],3))
fgOverlay.events.append(event("tool_result",["tool_use_id":.string("fg-tool"),"output":.string("ok")],4))
var bgOverlay = surface("pOverlay",user:"uA",terminal:true)
bgOverlay.events.append(event("task",["phase":.string("started"),"task_id":.string("bg-overlay"),"is_backgrounded":.bool(true)],3))
let overlayPath = snapshot([message("uA","user",text:"A"),message("aOverlay","assistant",parent:"uA",text:"Final",prepare:"pOverlay")])
let overlaid = assembler.project(snapshot:overlayPath,pendingOperation:nil,runtimeSurface:fgOverlay,backgroundRuntimeSurfaces:["pOverlay":bgOverlay],identities:.init(),now:now)
expect(overlaid.count == 2 && overlaid[1].assistant!.activityProjection.tools.count == 1 && overlaid[1].assistant!.activityProjection.tasks.count == 1,"durable foreground and background all merge into one canonical assistant")
print("Turn lifecycle PASS: \(checks) real Swift frame assertions")
