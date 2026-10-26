import { randomUUID } from "node:crypto";
export type Rule = { id:string; sessionId:string; protocol:"SMTP"|"POP3"; command:string; code:number; message:string; remaining:number };
export class SimulationStore {
 private rules = new Map<string,Rule>();
 create(input:Omit<Rule,"id">) {
  if (!input.sessionId || !["SMTP","POP3"].includes(input.protocol) || !/^[A-Z]+$/.test(input.command) || input.code<400 || input.code>599 || input.remaining<1) throw Error("Invalid simulation");
  const rule={...input,id:randomUUID()}; this.rules.set(rule.id,rule); return rule;
 }
 list(sessionId?:string) {return [...this.rules.values()].filter(r=>!sessionId||r.sessionId===sessionId);}
 delete(id:string) {this.rules.delete(id);}
 match(sessionId:string|undefined,protocol:"SMTP"|"POP3",command:string) {
  if (!sessionId) return undefined;
  const rule=this.list(sessionId).find(r=>r.protocol===protocol&&r.command===command&&r.remaining>0);
  if(rule) rule.remaining--; return rule;
 }
}
