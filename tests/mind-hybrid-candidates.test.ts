import assert from "node:assert/strict";
import test from "node:test";
import {
  hasDirectPhraseAnchor, selectHybridMindCandidates,
  type HybridInput,
} from "../src/domains/runtime/mind/mind-hybrid-candidates.js";

const memory = (stateId: string, text: string) => ({stateId,text});
const score = (stateId: string, value: number) => ({stateId,score:value});
const states=[
  memory("promise","过去他反复失信，我们因为承诺争执"),
  memory("bread","面团需要发酵才能做出松软的面包"),
  memory("weather","天气预报说周末会下雨"),
];

function select(overrides: Partial<HybridInput> = {}) {
  return selectHybridMindCandidates({
    query:"之前的承诺又没兑现",
    memories:states,
    e5Ranked:[score("promise",.92),score("bread",.84),score("weather",.82)],
    ritrieveRanked:[score("promise",.76),score("weather",.66),score("bread",.61)],
    mode:"agreement",
    ...overrides,
  });
}

test("agreement requires BOTH E5 and ritrieve, unlike E5 alone",()=>{
  assert.deepEqual(select().map(x=>x.stateId),["promise"]);
});

test("unrelated semantic candidates cannot be admitted just by E5 score",()=>{
  assert.deepEqual(select({
    query:"计算一元二次方程",
    ritrieveRanked:[score("bread",.64),score("promise",.62),score("weather",.58)],
  }),[]);
});

test("the rescue is literal-phrase bound and still needs both model signals",()=>{
  assert.equal(hasDirectPhraseAnchor("我们因为承诺吵架","过去他反复失信，我们因为承诺争执"),true);
  assert.equal(hasDirectPhraseAnchor("太阳系里有哪些行星","面团需要发酵才能做出松软的面包"),false);
  const args:Partial<HybridInput>={
    query:"我们因为承诺又争执了",
    ritrieveRanked:[score("promise",.63),score("bread",.62),score("weather",.60)],
  };
  assert.deepEqual(select({...args,mode:"agreement"}),[]);
  assert.deepEqual(select({...args,mode:"anchored_rescue"}).map(x=>x.stateId),["promise"]);
});

test("rescue never grants access to an excluded/unknown memory",()=>{
  assert.deepEqual(select({
    mode:"anchored_rescue",
    query:"我们因为承诺又争执了",
    memories:[states[1]!,states[2]!],
    ritrieveRanked:[score("promise",.63)],
  }),[]);
});

test("agreement is stable and bounded to four with deterministic ties",()=>{
  const ids=["a","b","c","d","e","f","g"];
  const input:HybridInput={
    query:"学习计划",
    memories:ids.map(id=>memory(id,"学习计划里的步骤")),
    e5Ranked:ids.map(id=>score(id,.90)),
    ritrieveRanked:ids.map(id=>score(id,.80)),
    mode:"agreement",
    maxItems:4,
  };
  const result=selectHybridMindCandidates(input);
  assert.deepEqual(result.map(x=>x.stateId),["a","b","c","d"]);
  assert.deepEqual(selectHybridMindCandidates(input),result);
});

test("one-memory policy preserves top candidate and never returns a second",()=>{
  const available = select();
  assert.equal(available.length, 1);
  assert.deepEqual(select({maxItems:1}), available.slice(0,1));
  const query="学习计划";
  const ids=["a","b","c","d"];
  const common:HybridInput = {
    query,
    memories:ids.map(id=>memory(id,"学习计划的步骤")),
    e5Ranked:ids.map(id=>score(id,.9)),
    ritrieveRanked:ids.map(id=>score(id,.8)),
    mode:"agreement",
    maxItems:1,
  };
  assert.deepEqual(selectHybridMindCandidates(common).map(x=>x.stateId),["a"]);
});

test("bad bounds or empty queries return no candidates",()=>{
  assert.deepEqual(select({maxItems:20}),[]);
  assert.deepEqual(select({query:"  "}),[]);
});
