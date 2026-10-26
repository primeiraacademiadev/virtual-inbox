import test from "node:test";
import assert from "node:assert/strict";
import { connect } from "node:net";
import { once } from "node:events";
import { Sandbox } from "../src/core.js";
import { InboxCredentialStore } from "../src/inbox-credentials.js";
import { SimulationStore } from "../src/simulation-store.js";
import { ProtocolCounters } from "../src/protocol-metrics.js";
import { createPop3Server } from "../src/pop3-server.js";

test("POP3 USER/PASS resolves shared GUID; RETR returns the captured MIME and session failure is scoped", { timeout: 15_000 }, async () => {
  const sandbox = new Sandbox();
  const inbox = sandbox.create("email", "pop3-check@example.test");
  sandbox.deliver("email","sender@example.test",inbox.address,"hello test","subject");
  const credentials = new InboxCredentialStore();
  const rules = new SimulationStore();
  const server = createPop3Server(sandbox,credentials,rules,new ProtocolCounters());
  server.listen(0,"127.0.0.1");
  await once(server,"listening");
  const address=server.address();
  if (!address || typeof address === "string") throw Error("Expected TCP address");
  const socket=connect(address.port,"127.0.0.1");
  const closed = new Promise<void>(resolve => socket.once("close", () => resolve()));
  const pending: Array<{ resolve: (line: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];
  const lines:string[]=[];
  let buffer="";
  socket.on("data",chunk=>{
    buffer+=chunk.toString("utf8");
    let e:number;
    while((e=buffer.indexOf("\n"))>=0) {
      const line=buffer.slice(0,e).replace(/\r$/,"");buffer=buffer.slice(e+1);
      const next=pending.shift();
      if(next) { clearTimeout(next.timer); next.resolve(line); }
      else lines.push(line);
    }
  });
  const failPending = (error: Error) => {
    for (const waiter of pending.splice(0)) { clearTimeout(waiter.timer); waiter.reject(error); }
  };
  socket.on("error", failPending);
  socket.on("close", () => failPending(new Error("POP3 socket closed before response")));
  const read = (): Promise<string> => {
    if (lines.length) return Promise.resolve(lines.shift()!);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = pending.findIndex(waiter => waiter.resolve === resolve);
        if (index >= 0) pending.splice(index, 1);
        reject(new Error("POP3 response timeout after 5 seconds"));
      }, 5_000);
      pending.push({ resolve, reject, timer });
    });
  };
  const send=async(command:string)=>{socket.write(command+"\r\n");return read();};
  try {
    assert.match(await read(),/^\+OK/);
    assert.match(await send("USER "+inbox.address),/^\+OK/);
    assert.match(await send("PASS secret"),/^\+OK/);
    const sessionId=await credentials.authenticate(inbox.address,"secret");
    assert.equal(await credentials.verify(inbox.address,"secret",sessionId),true);
    assert.match(await send("STAT"),/^\+OK 1 /);
    rules.create({sessionId,protocol:"POP3",command:"STAT",code:451,message:"Simulated",remaining:1});
    assert.match(await send("STAT"),/^-ERR Simulated/);
    assert.match(await send("STAT"),/^\+OK 1 /);
    assert.match(await send("RETR 1"),/^\+OK message follows/);
    const retrieved: string[] = [];
    for (;;) {
      const line = await read();
      if (line === ".") break;
      retrieved.push(line);
    }
    assert.ok(retrieved.some(line => line.includes("hello test")));
    assert.match(await send("DELE 1"),/^\+OK/);
    assert.match(await send("STAT"),/^\+OK 0 /);
    assert.match(await send("QUIT"),/^\+OK/);
    await closed;
    assert.equal(sandbox.listMessages(inbox.id).length, 0);
  } finally {
    socket.destroy();server.close();
  }
});
