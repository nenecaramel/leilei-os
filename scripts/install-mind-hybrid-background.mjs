#!/usr/bin/env node
/**
 * One-time, idempotent per-user setup for Claude Desktop hybrid Mind.
 * Does NOT configure/restart Native Live or change Railway/production Memory.
 * Requires a working private ~/.claude/leileios-mind/mind.env.
 */
import { promises as fs } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { install as installHook } from "../tools/claude-code-mind/install.mjs";

const home = homedir();
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const label = "com.leilei.mind-hybrid";
const uid = process.getuid?.();
const envPath = join(home, ".claude", "leileios-mind", "mind.env");
const agents = join(home, "Library", "LaunchAgents");
const plistPath = join(agents, label + ".plist");
const socketPath = join(home, ".leileios", "claude-code-mind", "hybrid.sock");
const logs = join(home, ".leileios", "mind-hybrid-background");

const xml = value => String(value).replaceAll("&","&amp;").replaceAll("<","&lt;")
  .replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&apos;");
const str = value => "<string>" + xml(value) + "</string>";
const shell = (cmd,args) => spawnSync(cmd,args,{encoding:"utf8",timeout:12000,stdio:["ignore","pipe","pipe"]});
async function node22() {
  const found = [process.execPath,
    "/opt/homebrew/opt/node@22/bin/node",
    "/usr/local/opt/node@22/bin/node"];
  for(const root of [
    join(home,".nvm","versions","node"),
    join(home,".local","share","fnm","node-versions"),
  ]) {
    try {
      for(const version of await fs.readdir(root)) {
        if(!version.startsWith("v22."))continue;
        found.push(join(root,version,"bin","node"));
        found.push(join(root,version,"installation","bin","node"));
      }
    } catch {}
  }
  for(const exe of found) {
    const probe = shell(exe,["--version"]);
    if(probe.status===0 && /^v22\./.test(probe.stdout.trim()))return exe;
  }
  throw new Error("NODE_22_NOT_FOUND");
}
function plist(binary) {
  const path = [dirname(binary),"/opt/homebrew/bin","/usr/local/bin","/usr/bin","/bin"].join(":");
  const args=[binary,"--import","tsx",join(repo,"scripts","mind-hybrid-background.ts")];
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    '<plist version="1.0"><dict>\n' +
    '<key>Label</key>'+str(label)+'\n' +
    '<key>ProgramArguments</key><array>'+args.map(str).join("")+'</array>\n' +
    '<key>WorkingDirectory</key>'+str(repo)+'\n' +
    '<key>EnvironmentVariables</key><dict><key>HOME</key>'+str(home)+
    '<key>PATH</key>'+str(path)+'</dict>\n' +
    '<key>RunAtLoad</key><true/>\n' +
    '<key>KeepAlive</key><true/>\n' +
    '<key>ThrottleInterval</key><integer>30</integer>\n' +
    '<key>StandardOutPath</key>'+str(join(logs,"stdout.log"))+'\n' +
    '<key>StandardErrorPath</key>'+str(join(logs,"stderr.log"))+'\n' +
    '</dict></plist>\n';
}
async function main() {
  if(process.platform!=="darwin" || uid===undefined)throw new Error("MAC_USER_REQUIRED");
  // Refuse noncanonical clones: keep the installed agent pointed at the
  // checkout used for normal main updates, not an ephemeral worktree.
  if(await fs.realpath(repo)!==await fs.realpath(join(home,"Developer","leilei-os-main")))
    throw new Error("CANONICAL_MAIN_REQUIRED");
  await fs.access(join(repo,"node_modules","tsx"));
  const bin=await node22();
  const stat=await fs.lstat(envPath);
  if(!stat.isFile() || stat.isSymbolicLink() || stat.uid!==uid ||
      (stat.mode & 0o077)!==0 || stat.size>16_000)
    throw new Error("PRIVATE_ENV_INVALID");
  const oldEnv=await fs.readFile(envPath,"utf8");
  if(!/^LEILEI_MIND_RECALL_URL=/m.test(oldEnv) || !/^LEILEI_MIND_RECALL_TOKEN=/m.test(oldEnv))
    throw new Error("RECALL_CREDENTIALS_MISSING");
  const newEnv=oldEnv.split(/\r?\n/).filter(row=>!/^LEILEI_MIND_(RECALL_MODE|SEMANTIC_SOCKET)=/.test(row))
    .filter((row,i,arr)=>!(i===arr.length-1&&row===""))
    .concat(["LEILEI_MIND_RECALL_MODE=hybrid_conditional_v1",
      "LEILEI_MIND_SEMANTIC_SOCKET=" + JSON.stringify(socketPath),""]).join("\n");
  await fs.mkdir(logs,{recursive:true,mode:0o700});
  await fs.chmod(logs,0o700);
  for(const filename of ["stdout.log","stderr.log"]){
    const handle=await fs.open(join(logs,filename),"a",0o600);await handle.close();
    await fs.chmod(join(logs,filename),0o600);
  }
  await fs.mkdir(agents,{recursive:true});
  const nextPlist=plist(bin);
  let existing=null;
  try{existing=await fs.readFile(plistPath,"utf8");}
  catch(error){if(error.code!=="ENOENT")throw error;}
  if(existing!==null && existing!==nextPlist)
    throw new Error("AGENT_ALREADY_CUSTOMIZED_REFUSING_OVERWRITE");
  // Install the patched Hook FIRST. If launchd fails, automatic original
  // Railway recall still works without any local process.
  await installHook({serverName:"leileios",nodeCommand:bin});
  if(newEnv!==oldEnv){
    const backup=envPath+".pre-mind-hybrid-background.bak";
    try{await fs.copyFile(envPath,backup,fs.constants.COPYFILE_EXCL);await fs.chmod(backup,0o600);}
    catch(error){if(error.code!=="EEXIST")throw error;}
    const tmp=envPath+".pending-"+process.pid;
    try {
      await fs.writeFile(tmp,newEnv,{mode:0o600,flag:"wx"});
      await fs.rename(tmp,envPath);
    } finally {await fs.unlink(tmp).catch(()=>undefined);}
  }
  if(existing===null)await fs.writeFile(plistPath,nextPlist,{mode:0o644,flag:"wx"});
  const target="gui/"+uid+"/"+label;
  if(shell("launchctl",["print",target]).status!==0){
    const started=shell("launchctl",["bootstrap","gui/"+uid,plistPath]);
    if(started.status!==0)throw new Error("LAUNCHD_BOOTSTRAP_FAILED");
  } else {
    // A running old worker retains its 60s polling code until restarted.
    // Restart only this standalone Mind LaunchAgent after installing new code.
    const restarted=shell("launchctl",["kickstart","-k",target]);
    if(restarted.status!==0)throw new Error("MIND_WORKER_RESTART_FAILED");
  }
  console.log("MIND_BACKGROUND_INSTALLED");
  console.log("HOOK_RAILWAY_FALLBACK=ENABLED");
  console.log("LAUNCHD_LABEL="+label);
  console.log("SOCKET="+socketPath);
  console.log("The worker may take 10-30 seconds to warm its local models.");
}
main().catch(error=>{
  console.error("Mind background setup failed: "+(
    error instanceof Error && /^[A-Z0-9_]{3,80}$/.test(error.message)
    ?error.message:"INSTALL_ERROR"
  ));
  process.exitCode=1;
});
