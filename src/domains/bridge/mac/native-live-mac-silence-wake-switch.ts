import {lstatSync,mkdirSync,unlinkSync,watch,writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";

/** Local control only; never reads credentials or changes server receipts. */
export class NativeLiveMacSilenceWakeSwitch {
  private monitoringAvailable=true;
  constructor(private readonly directory=process.env.LEILEI_WAKE_HOME || join(homedir(),".leileios","wake"), private readonly watchDirectory: typeof watch=watch) {}

  isEnabled(): boolean {
    if(!this.monitoringAvailable)return false;
    try {lstatSync(join(this.directory,"disabled"));return false;}
    catch(error){return (error as NodeJS.ErrnoException).code==="ENOENT";}
  }

  setEnabled(enabled:boolean): void {
    if(enabled){
      try {unlinkSync(join(this.directory,"disabled"));}
      catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
    }else{
      mkdirSync(this.directory,{recursive:true,mode:0o700});
      try {writeFileSync(join(this.directory,"disabled"),"paused\n",{flag:"wx",mode:0o600});}
      catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;}
    }
  }

  watch(onChange:()=>void): ()=>void {
    if(!this.monitoringAvailable)return ()=>{};
    try {
      mkdirSync(this.directory,{recursive:true,mode:0o700});
      const watcher=this.watchDirectory(this.directory,{persistent:false},(_event,name)=>{
        if(name===null||String(name)==="disabled")onChange();
      });
      watcher.on("error",()=>{
        if(!this.monitoringAvailable)return;
        this.monitoringAvailable=false;watcher.close();onChange();
      });
      return ()=>watcher.close();
    }catch{
      // A failed local control must disable automatic wake, not ordinary chat.
      this.monitoringAvailable=false;
      return ()=>{};
    }
  }
}
