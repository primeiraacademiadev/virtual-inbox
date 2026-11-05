// Diagnostic only: verify whether a minimal Node TCP greeting also dies when peers send RST.
// This deliberately has no Virtual Inbox imports.
import { spawn } from "node:child_process";
import { createServer, connect } from "node:net";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";

const reserve = createServer();
reserve.listen(0, "127.0.0.1");
await once(reserve, "listening");
const address = reserve.address();
if (!address || typeof address === "string") throw Error("No port");
const port = address.port;
await new Promise(done => reserve.close(done));
const source = `const net=require('node:net'); const srv=net.createServer(s=>{s.on('error',()=>{});s.write('+OK control\\r\\n')});srv.listen(${port},'127.0.0.1',()=>console.log('READY'));`;
const child=spawn(process.execPath,["-e",source],{stdio:["ignore","pipe","pipe"]});
let output="";
child.stdout.on("data",x=>output+=String(x));
child.stderr.on("data",x=>output+=String(x));
try {
  let ready=false;
  for (let i=0;i<100;i++) {
    if (output.includes("READY")) {ready=true;break;}
    if (child.exitCode !== null) throw Error("Control server exited: "+child.exitCode+" "+output);
    await sleep(25);
  }
  if(!ready)throw Error("Control server did not start: "+output);
  for(let i=0;i<6;i++) {
    const socket=connect(port,"127.0.0.1");
    socket.on("error",()=>{});
    const closed=once(socket,"close");
    socket.once("connect",()=>socket.resetAndDestroy());
    await closed;
  }
  await sleep(100);
  console.log("RAW_TCP_CONTROL", JSON.stringify({node:process.version,platform:process.platform,exitCode:child.exitCode,signal:child.signalCode,output}));
  if(child.exitCode !== null)process.exitCode=1;
} finally {
  if(child.exitCode===null) child.kill();
}
