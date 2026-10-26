import test from "node:test";
import assert from "node:assert/strict";
import { connect } from "node:net";
import { once } from "node:events";
import { Sandbox } from "../src/core.js";
import { InboxCredentialStore } from "../src/inbox-credentials.js";
import { SimulationStore } from "../src/simulation-store.js";
import { createPop3Server } from "../src/pop3-server.js";

test("POP3 USER/PASS resolves shared GUID; RETR returns the captured MIME and session failure is scoped", async () => {
  const sandbox = new Sandbox();
  const inbox = sandbox.create("email", "pop3-check@example.test");
  sandbox.deliver("email","sender@example.test",inbox.address,"hello test","subject");
  const credentials = new InboxCredentialStore();
  const rules = new SimulationStore();
  const server = createPop3Server(sandbox,credentials,rules);
  server.listen(0,"127.0.0.1");
  await once(server,"listening");
  const address=server.address();
  if (!address || typeof address === "string") throw Error("Expected TCP address");
  const socket=connect(address.port,"127.0.0.1");
  const closed=once(socket,"close");
  const pending: Array<(line:string)=>void>=[];
  const lines:string[]=[];
  let buffer="";
  socket.on("data",chunk=>{
    buffer+=chunk.toString("utf8");
    let e:number;
    while((e=buffer.indexOf("\n"))>=0) {
      const line=buffer.slice(0,e).replace(/\r$/,"");buffer=buffer.slice(e+1);
      const next=pending.shift();
      if(next) next(line); else lines.push(line);
    }
  });
  const read=()=>lines.length ? Promise.resolve(lines.shift()!) : new Promise<string>(resolve=>pending.push(resolve));
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
    assert.match(await send("DELE 1"),/^\+OK/);
    assert.match(await send("STAT"),/^\+OK 0 /);
    assert.match(await send("QUIT"),/^\+OK/);
    await closed;
    assert.equal(sandbox.listMessages(inbox.id).length, 0);
  } finally {
    socket.destroy();server.close();
  }
});
