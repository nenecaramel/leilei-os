import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";

test("wake CLI persists off/on across processes without touching Mind",async t=>{
 const home=await mkdtemp(join(tmpdir(),"wake-toggle-"));t.after(()=>rm(home,{recursive:true,force:true}));
 const run=(action:string)=>spawnSync(process.execPath,["--import","tsx","scripts/native-live-wake-toggle.ts",action],{env:{...process.env,LEILEI_WAKE_HOME:home},encoding:"utf8"});
 assert.equal(run("status").stdout.trim(),"Automatic Wake ON");
 const off=run("off");assert.equal(off.status,0,off.stderr);assert.equal(off.stdout.trim(),"Automatic Wake OFF");
 assert.equal(await readFile(join(home,"disabled"),"utf8"),"paused\n");
 assert.equal(run("status").stdout.trim(),"Automatic Wake OFF");
 assert.equal(run("on").stdout.trim(),"Automatic Wake ON");
 assert.equal(run("status").stdout.trim(),"Automatic Wake ON");
 assert.equal(run("invalid").status,1);
});

import {NativeLiveMacSilenceWakeSwitch} from "../src/domains/bridge/mac/native-live-mac-silence-wake-switch.js";
import {writeFile,stat} from "node:fs/promises";

test("running file watcher observes toggles and closes cleanly",async t=>{
 const home=await mkdtemp(join(tmpdir(),"wake-watch-"));t.after(()=>rm(home,{recursive:true,force:true}));
 const control=new NativeLiveMacSilenceWakeSwitch(home);
 for(const enabled of [false,true]){
  let stop=()=>{};let timer:ReturnType<typeof setTimeout>;
  try{
   await new Promise<void>((resolve,reject)=>{
    stop=control.watch(()=>resolve());
    timer=setTimeout(()=>reject(new Error("file switch not observed")),2000);
    control.setEnabled(enabled);
   });
  }finally{stop();clearTimeout(timer!);}
  assert.equal(control.isEnabled(),enabled);
 }
 control.setEnabled(false);
 assert.equal((await stat(join(home,"disabled"))).mode&0o777,0o600);
});

test("unreadable control fails closed without throwing into normal chat",async t=>{
 const home=await mkdtemp(join(tmpdir(),"wake-invalid-"));t.after(()=>rm(home,{recursive:true,force:true}));
 const file=join(home,"not-directory");await writeFile(file,"x");
 const control=new NativeLiveMacSilenceWakeSwitch(file);
 assert.equal(control.isEnabled(),false);
 const stop=control.watch(()=>{throw new Error("must not spin on watch startup failure");});stop();
 assert.equal(control.isEnabled(),false);
});

import {EventEmitter} from "node:events";
import type {watch} from "node:fs";

test("watcher error disables wake once without immediate rewatch/probe loops",async t=>{
 const home=await mkdtemp(join(tmpdir(),"wake-watch-error-"));t.after(()=>rm(home,{recursive:true,force:true}));
 const watcher=Object.assign(new EventEmitter(),{close(){}});
 let created=0;let changes=0;
 const factory=(()=>{created++;return watcher;}) as unknown as typeof watch;
 const control=new NativeLiveMacSilenceWakeSwitch(home,factory);
 const close=control.watch(()=>{changes++;});
 watcher.emit("error",new Error("synthetic OS watcher error"));
 assert.equal(control.isEnabled(),false);
 const closeAgain=control.watch(()=>{changes++;});
 assert.equal(created,1,"failed monitoring must not repeatedly wake/probe/recreate");
 watcher.emit("error",new Error("duplicate OS watcher error"));
 assert.equal(changes,1);
 close();closeAgain();
});
