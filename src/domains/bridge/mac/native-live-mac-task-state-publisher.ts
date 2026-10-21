/** Advisory task membership, separate from generated replies and result receipts.
 * One in-flight request; SDK callbacks never await it. Retired writers cannot
 * enqueue more work. A failed snapshot waits for a later membership observation,
 * rather than introducing another idle polling loop or rerunning Claude. */
export type NativeLiveTaskStateOwner = {prepareId:string;providerSessionId:string;generationId:string};
export type NativeLiveTaskStateUpdate = NativeLiveTaskStateOwner & {snapshotSequence:number;tasks:Array<{
  task_id:string;run_id?:string;task_type:string;description:string;ambient:boolean;
}>};
type Task = {taskId:string;handle:string;active:boolean;runId?:string|null;taskType?:string|null;description?:string|null;ambient?:boolean};
type Source = {owner:NativeLiveTaskStateOwner;last:string|null;desired:NativeLiveTaskStateUpdate['tasks']};
export class NativeLiveMacTaskStatePublisher {
  private readonly sources=new Map<string,Source>();
  private readonly owners=new Map<string,string>();
  private pumping:Promise<void>|null=null;
  private closed=false;
  private sequence=0;
  constructor(private readonly input:{publish(value:NativeLiveTaskStateUpdate):Promise<unknown>;isLive():boolean}){}
  observe(owner:NativeLiveTaskStateOwner,tasks:readonly Task[]):void {
    if(this.closed||!this.input.isLive())return;
    const active=tasks.filter(t=>t.active);
    if(active.length>64)return; // Never describe a truncated set as complete membership.
    let source=this.sources.get(owner.prepareId);
    if(!source){
      // At most one source per live task, plus the foreground just completed.
      // Don't grow an unbounded metadata backlog when transport is unavailable.
      if(this.sources.size>=128)return;
      source={owner:{...owner},last:null,desired:[]};this.sources.set(owner.prepareId,source);
    }
    for(const item of this.sources.values())item.desired=[];
    const handles=new Set(active.map(t=>t.handle));
    for(const [handle] of this.owners)if(!handles.has(handle))this.owners.delete(handle);
    for(const task of active){
      const prepareId=this.owners.get(task.handle)??owner.prepareId;this.owners.set(task.handle,prepareId);
      this.sources.get(prepareId)?.desired.push({task_id:task.taskId,...(task.runId?{run_id:task.runId}:{}),
        task_type:(task.taskType??'unknown').slice(0,128),description:(task.description??'').slice(0,2000),ambient:task.ambient===true});
    }
    void this.pump();
  }
  async settle():Promise<void>{await this.pumping;}
  close():void{this.closed=true;this.sources.clear();this.owners.clear();}
  private pump():Promise<void>{
    if(this.pumping)return this.pumping;
    const run=(async()=>{
      const attempted=new Set<string>();
      while(!this.closed&&this.input.isLive()){
        const item=[...this.sources.entries()].find(([id,s])=>!attempted.has(id)&&JSON.stringify(s.desired)!==s.last);
        if(!item)break;
        const [id,source]=item;attempted.add(id);
        const desired=structuredClone(source.desired),serialized=JSON.stringify(desired);
        const value={...source.owner,snapshotSequence:++this.sequence,tasks:desired};
        try{
          await this.input.publish(value);
          if(this.closed||!this.input.isLive())break;
          source.last=serialized;
          if(!desired.length&&source.desired.length===0)this.sources.delete(id);
          if(JSON.stringify(source.desired)!==serialized)attempted.delete(id);
        }catch{/* Keep latest desired snapshot for the next observation; bounded metadata only. */}
      }
    })();
    this.pumping=run;void run.finally(()=>{if(this.pumping===run)this.pumping=null;});return run;
  }
}
