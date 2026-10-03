import assert from "node:assert/strict";
import test from "node:test";
import type {
  NativeLiveConversation,
  NativeLiveMessage,
} from "../src/domains/conversation/native-live-conversation-types.js";
import {
  DefaultNativeLiveMindRuntime,
} from "../src/domains/runtime/mind/native-live-mind-runtime.js";
import {
  NativeLiveMindLoopService,
  type SubjectStateRuntimePort,
} from "../src/domains/runtime/mind/native-live-mind-loop-service.js";

const now = "2026-09-22T15:30:00.000Z";

class Port implements SubjectStateRuntimePort {
  listCalls = 0;
  saved = 0;

  async list() {
    this.listCalls += 1;
    return [];
  }
  async append() {}
  async transition() {}
  async saveContextManifest() {
    this.saved += 1;
  }
}

function userMessage(): NativeLiveMessage {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    conversationId: "11111111-1111-4111-8111-111111111111",
    parentMessageId: null,
    role: "user",
    status: "completed",
    createdAt: now,
    completedAt: now,
    blocks: [{
      id: "33333333-3333-4333-8333-333333333333",
      ordinal: 0,
      kind: "text",
      rawType: "text",
      text: "hello",
      payload: null,
      createdAt: now,
    }],
  };
}

function conversation(): NativeLiveConversation {
  const user = userMessage();
  return {
    id: user.conversationId,
    userId: "u1",
    title: null,
    lifecycleStatus: "active",
    currentHeadMessageId: user.id,
    createdAt: now,
    updatedAt: now,
    messages: [user],
  };
}

function createMind(port: Port) {
  const service = new NativeLiveMindLoopService(
    port,
    {
      assemblyVersion: "assembly-v1",
      promptContractVersion: "prompt-v1",
      ruleVersion: "mind-v1",
      processVersion: "mind-v1",
      breathLimit: 3,
      thoughtLimit: 3,
      maxContextItems: 10,
      maxContextChars: 4000,
    },
    null,
  );

  return new DefaultNativeLiveMindRuntime(service, {
    subjectId: "G",
    now: () => now,
    createManifestId: () =>
      "44444444-4444-4444-8444-444444444444",
  });
}

test("foreground Mind binding now owns Context Assembly only, not general Subject evolution", async () => {
  const port = new Port();
  const mind = createMind(port);
  const user = userMessage();

  const prompt = await mind.prepareUserTurn({
    userId: "u1",
    conversation: conversation(),
    userMessage: user,
    userText: "hello",
    surfaceHeadMessageId: null,
  });

  assert.equal(
    prompt.includes(
      "<user_message>[09-22 周二 15:30] hello</user_message>",
    ),
    true,
  );
  assert.equal(port.listCalls, 1);
  assert.equal(port.saved, 1);
});

test("semantic planning remains independent from Background Loop maintenance", async () => {
  const port = new Port();
  const mind = createMind(port);
  const user = userMessage();

  const plan = await mind.planSemanticUserTurn({
    userId: "u1",
    conversation: conversation(),
    userMessage: user,
    userText: "hello",
    surfaceHeadMessageId: null,
  });

  assert.equal(plan, null);
  assert.equal(port.listCalls, 0);
  assert.equal(port.saved, 0);
});

test("Retry/Edit context treats a thought dropped by the replaced turn as still active", async () => {
  const { writeThoughtActive, writeThoughtDropped } = await import(
    "../src/domains/runtime/thought/thought.js"
  );
  const droppedBy = "a-replaced";
  const thought = (
    id: string,
    text: string,
    payload: Record<string, unknown>,
  ) => ({
    id,
    kind: "thought" as const,
    text,
    payload,
    envelope: {
      semanticActor: { kind: "subject" as const, id: "G" },
      producer: { kind: "model" as const, id: "claude-code" },
      committer: { kind: "runtime" as const, id: "leileios-runtime" },
      authority: "subject_authorized" as const,
      scope: {
        userId: "u1",
        subjectId: "G",
        applicability: "global" as const,
        conversationId: null,
        pathHeadMessageId: null,
        visibility: "subject_private" as const,
        sensitivity: "normal" as const,
        audience: ["G"],
      },
      status: {
        generationStatus: "committed" as const,
        presentationStatus: "presented" as const,
        pathStatus: "current" as const,
        settlementStatus: "settled" as const,
        validityStatus: "valid" as const,
      },
      provenance: {
        sources: [{ kind: "manual_entry" as const, id: `manual:${id}` }],
        causedBy: `manual:${id}`,
        derivedFrom: [],
      },
      versions: {
        schemaVersion: 1,
        ruleVersion: "test",
        processVersion: "test",
      },
    },
  });
  const states = [
    thought("dropped-by-replaced", "被这一轮放下的", writeThoughtDropped(null, {
      reason: "subject",
      droppedAt: now,
      droppedByMessageId: droppedBy,
    })),
    thought("dropped-earlier", "更早被放下的", writeThoughtDropped(null, {
      reason: "subject",
      droppedAt: now,
      droppedByMessageId: "a-earlier",
    })),
    thought("capacity-dropped", "被挤掉的", writeThoughtDropped(null, {
      reason: "capacity",
      droppedAt: now,
    })),
    thought("active", "一直在的", writeThoughtActive(null)),
  ];

  const port = new Port();
  port.list = async () => states as never;
  const service = new NativeLiveMindLoopService(port, {
    assemblyVersion: "assembly-v2",
    promptContractVersion: "prompt-v5",
    ruleVersion: "mind-v2",
    processVersion: "mind-v2",
    breathLimit: 3,
    thoughtLimit: 3,
    maxContextItems: 10,
    maxContextChars: 4000,
  }, null);
  const prepare = (excluded?: ReadonlySet<string>) =>
    service.prepareTurn({
      manifestId: crypto.randomUUID(),
      userId: "u1",
      subjectId: "G",
      conversation: conversation(),
      userMessageId: "22222222-2222-4222-8222-222222222222",
      userText: "hello",
      snapshotSequence: 1,
      assembledAt: now,
      excludedReferenceIds: excluded,
    });

  const plain = await prepare();
  assert.equal(plain.prompt.includes("被这一轮放下的"), false);

  const retry = await prepare(new Set([droppedBy]));
  assert.equal(
    retry.prompt.includes("Current thoughts (rev 1, supersedes all earlier snapshots):\n- [T1] 一直在的\n- [T2] 被这一轮放下的"),
    true,
  );
  // Only the drop issued by the replaced message is undone.
  assert.equal(retry.prompt.includes("更早被放下的"), false);
  assert.equal(retry.prompt.includes("被挤掉的"), false);
});

test("Mind takes voice identity only from canonical text block payload and ignores malformed modes", async () => {
  for (const payload of [{input_mode:"voice"}, {input_mode:"text"}, {input_mode:"audio"}, null, []]) {
    const user=userMessage();
    user.blocks[0].payload=payload as typeof user.blocks[0]["payload"];
    const mind=createMind(new Port());
    const prompt=await mind.prepareUserTurn({userId:"u1",conversation:conversation(),userMessage:user,userText:"hello",surfaceHeadMessageId:null});
    const isVoice=payload !== null && !Array.isArray(payload) && payload.input_mode === "voice";
    assert.equal(prompt.includes('<user_message input_mode="voice">[voice] '),isVoice);
    assert.equal(prompt.includes('<user_message>[09-22 周二 15:30] hello</user_message>'),!isVoice);
    assert.equal(prompt.includes("[voice] "),isVoice);
  }
});

test("persisted Context Manifest replays voice identity and rejects a conflicting plain-text snapshot", async () => {
  const {NativeLiveMindLoopService}=await import("../src/domains/runtime/mind/native-live-mind-loop-service.js");
  let manifest: import("../src/domains/runtime/context/context-assembly-contract.js").InitialContextManifest | null = null;
  const service=new NativeLiveMindLoopService({
    async list(){return []},async append(){},async transition(){},
    async saveContextManifest(input){manifest=input.manifest;},
    async loadContextManifest(){return manifest;},
  },{assemblyVersion:"voice-v1",promptContractVersion:"voice-v1",ruleVersion:"test",processVersion:"test",breathLimit:3,maxContextItems:16,maxContextChars:8000});
  const input={manifestId:"same-voice-manifest",userId:"u1",subjectId:"G",conversation:conversation(),userMessageId:userMessage().id,userText:"hello",snapshotSequence:1,assembledAt:now,userInputMode:"voice" as const};
  const first=await service.prepareTurn(input);
  const replay=await service.prepareTurn(input);
  assert.equal(replay.prompt,first.prompt);
  assert.match(replay.prompt,/<user_message input_mode="voice">\[voice\] /);
  await assert.rejects(service.prepareTurn({...input,userInputMode:undefined}),/conflicts with the requested turn snapshot/);
});
