import {NativeLiveMacSilenceWakeSwitch} from "../src/domains/bridge/mac/native-live-mac-silence-wake-switch.js";
const control=new NativeLiveMacSilenceWakeSwitch();
try {
  const action=process.argv[2];
  if(process.argv.length!==3||!["on","off","status"].includes(action??""))throw new Error("Usage: pnpm wake on|off|status");
  if(action!=="status")control.setEnabled(action==="on");
  console.log(control.isEnabled()?"Automatic Wake ON":"Automatic Wake OFF");
}catch {console.error("Wake switch failed. Usage: pnpm wake on|off|status");process.exitCode=1;}
