import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { withScenario, type Scenario } from './helpers/native-session-scenario/driver.js';

const enabled=process.env.RUN_NATIVE_SESSION_SCENARIO_DATABASE_TEST==='1';
function integer(name:string,fallback:number) {
  if(process.env[name]===undefined)return fallback;
  assert.match(process.env[name]!,/^\d+$/,`${name} must be a nonnegative integer`);
  const value=Number(process.env[name]);assert.ok(Number.isSafeInteger(value),`${name} must be a safe integer`);return value;
}
// Fixed boundary traces complement random exploration. SCENARIO_SEED=101..106
// replays the corresponding trace, then explores any remaining step budget.
const boundaries = [
  ['pre-start native B preserves H → U → F → B', 101, ['send','reserve','queue','background_prepare','background_submit','start','events','success','background_cover','repeat']],
  ['started F covers a deferred B', 102, ['send','reserve','queue','start','background_prepare','background_submit','success','background_cover','repeat']],
  ['started input fences an earlier background receipt', 103, ['background_prepare','send','reserve','start','background_submit','success','repeat']],
  ['ready Wake must run quietly and a consumed slot must refuse precisely', 106, ['wake','wake']],
  ['purged historical request refuses instead of recreating the old turn', 105, ['retry','reserve','success','late_retry','release','late_retry']],
  ['Desktop fences preparation, background commit and Wake', 104, ['background_prepare','release','send','background_submit','wake','attach','send','reserve','admit','renew','queue','start','events','success','repeat','late_retry']],
] as const;
const coverage=new Map<string,number>();
function collect(scenario:Scenario) {
  for(const entry of scenario.log){const {operation,outcome}=entry as {operation:string;outcome:string};const key=`${operation}:${outcome}`;coverage.set(key,(coverage.get(key)??0)+1);}
}
after(()=>{if(enabled)console.log('Scenario operation coverage:',Object.fromEntries([...coverage].sort()));});
const seeds=process.env.SCENARIO_SEED===undefined?[1,2,3,5,8,13,21,34,55,89,144,233,377,610,987,1597,2584,4181,6765,10946]:[integer('SCENARIO_SEED',1)];
for(const seed of seeds)test(`native Session seeded scenario ${seed}`,{skip:!enabled},async()=>{
  await withScenario(seed,async scenario=>{
    const steps=integer('SCENARIO_STEPS',40),boundary=boundaries.find(([,id])=>id===seed);
    if(boundary){for(const operation of boundary[2].slice(0,steps))await scenario.step(operation);}
    await scenario.run(Math.max(0,steps-(boundary?.[2].length??0)));collect(scenario);
  });
});
if(process.env.SCENARIO_SEED===undefined)for(const [name,seed,operations] of boundaries)test(`native Session boundary seed ${seed}: ${name}`,{skip:!enabled},async()=>{
  await withScenario(seed,async scenario=>{for(const operation of operations)await scenario.step(operation);collect(scenario);});
});
