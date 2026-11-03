import { randomUUID } from "node:crypto";
import { Fault } from "./domain-types.js";
export type AttemptOutcome = "in_progress" | "rejected" | "stored_and_acknowledged" | "stored_without_ack";
export type SmtpAttempt = {
  id:string; smtpSessionId:string; startedAt:string; updatedAt:string;
  sender?:string; recipients:string[]; messageIds:string[]; ruleIds:string[];
  phase:"MAIL"|"RCPT"|"DATA"|"AFTER_DATA"; outcome:AttemptOutcome;
  responseCode?:number; persisted:boolean;
};
export type AttemptFilter = {smtpSessionId?:string; sender?:string; recipient?:string; messageId?:string; ruleId?:string};
export class SmtpAttemptStore {
  private attempts=new Map<string,SmtpAttempt>();
  constructor(private readonly limit=2000) {}
  begin(smtpSessionId:string,sender:string):SmtpAttempt {
    const at=new Date().toISOString();
    const attempt:SmtpAttempt={id:randomUUID(),smtpSessionId,startedAt:at,updatedAt:at,sender,
      recipients:[],messageIds:[],ruleIds:[],phase:"MAIL",outcome:"in_progress",persisted:false};
    this.attempts.set(attempt.id,attempt);
    this.trim();
    return {...attempt,recipients:[],messageIds:[],ruleIds:[]};
  }
  update(id:string,patch:Partial<Pick<SmtpAttempt,"phase"|"outcome"|"responseCode"|"persisted">> &
    {recipient?:string;messageId?:string;ruleId?:string}) {
    const row=this.attempts.get(id);
    if(!row)return;
    Object.assign(row,patch);
    if(patch.recipient && !row.recipients.includes(patch.recipient)) row.recipients.push(patch.recipient);
    if(patch.messageId)row.messageIds.push(patch.messageId);
    if(patch.ruleId)row.ruleIds.push(patch.ruleId);
    row.updatedAt=new Date().toISOString();
  }
  get(id:string){const a=this.attempts.get(id);return a?{...a,recipients:[...a.recipients],messageIds:[...a.messageIds],ruleIds:[...a.ruleIds]}:undefined;}
  list(f:AttemptFilter,limit=100) {
    if(!Object.values(f).some(Boolean)) throw new Fault(400,"A correlation filter is required","ATTEMPT_FILTER_REQUIRED");
    if(!Number.isInteger(limit)||limit<1||limit>200) throw new Fault(400,"Invalid limit","INVALID_LIMIT");
    return [...this.attempts.values()].filter(a=>
      (!f.smtpSessionId||a.smtpSessionId===f.smtpSessionId)&&
      (!f.sender||a.sender?.toLowerCase()===f.sender.toLowerCase())&&
      (!f.recipient||a.recipients.some(x=>x.toLowerCase()===f.recipient!.toLowerCase()))&&
      (!f.messageId||a.messageIds.includes(f.messageId))&&
      (!f.ruleId||a.ruleIds.includes(f.ruleId))).slice(-limit).map(a=>this.get(a.id)!);
  }
  disconnect(sessionId:string){for(const a of this.attempts.values())if(a.smtpSessionId===sessionId&&a.outcome==="in_progress")
    this.update(a.id,{outcome:a.persisted?"stored_without_ack":"rejected"});}
  private trim(){while(this.attempts.size>this.limit)this.attempts.delete(this.attempts.keys().next().value!);}
}
