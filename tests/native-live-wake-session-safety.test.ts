import assert from 'node:assert/strict';
import test from 'node:test';
import {discardWakeLocked} from '../src/domains/bridge/turn/turn-repository/discard-wake.js';
import type {PreparationRow,Transaction} from '../src/domains/bridge/turn/turn-repository/types.js';

for(const [mode,resultSession,expectedCleanup] of [
 ['resume','source',false],['resume','foreign',false],['fork','source',false],['fork','child',true],['fork',null,false],
] as const) test(`wake discard ${mode}/${resultSession} preserves source and only retires owned child`,async()=>{
 const inserted:unknown[]=[];let deleted=0;
 const transaction={insert(){return {values(value:unknown){inserted.push(value);return {onConflictDoNothing:async()=>{}};}};},delete(){return {where:async()=>{deleted++;}};}};
 await discardWakeLocked(transaction as unknown as Transaction,{operation:'wake',runtimeMode:mode,parentProviderSessionId:'source',userId:'u',id:'id',expectedWorkingDirectory:'/synthetic'} as PreparationRow,resultSession);
 assert.equal(inserted.length,expectedCleanup?1:0);assert.equal(deleted,1);
});
