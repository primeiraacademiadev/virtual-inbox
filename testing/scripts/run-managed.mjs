import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {mkdtempSync,rmSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
const root=resolve(import.meta.dirname,"../..");
const temp=mkdtempSync(join(tmpdir(),"virtual-inbox-e2e-"));
const ports={PORT:"13000",HTTPS_PORT:"13443",SMTP_PORT:"12525",SMTPS_PORT:"12465",DEMO_PORT:"13001",DEMO_HTTPS_PORT:"13444"};
const env={...process.env,...ports,MAX_INBOX_COUNT:"40",MAX_MESSAGE_COUNT:"80",MAX_OBSERVER_COUNT:"40",MAX_SMS_BODY_BYTES:"512",MAX_ATTACHMENTS_PER_MESSAGE:"3",MAX_WAIT_TIMEOUT_MS:"12000",ADMIN_TOKEN:"harness-"+randomBytes(32).toString("hex"),VI_HTTPS_PORT:ports.HTTPS_PORT,HOST:"127.0.0.1",SMTP_HOST:"127.0.0.1",PUBLIC_HOST:"localhost",TLS_MODE:"auto",TLS_CERTIFICATES_DIR:join(temp,"certificates"),TLS_SERVER_NAMES:"localhost,127.0.0.1",NETWORK_SETTINGS_FILE:join(temp,"network.json"),TLS_MANAGED_IDENTITY_FILE:join(temp,"imported.json"),VI_RUN_MODE:"managed",VI_BASE_URL:"http://127.0.0.1:13000",VI_SMTP_HOST:"127.0.0.1",VI_SMTP_PORT:ports.SMTP_PORT,VI_SMTPS_PORT:ports.SMTPS_PORT,VI_TEST_CA_FILE:join(temp,"certificates","ca.pem"),VI_TLS_SERVERNAME:"localhost"};
const child=spawn(process.execPath,[join(root,"dist/src/server.js")],{cwd:root,env,stdio:["ignore","pipe","pipe"]});
child.stdout.on("data",data=>process.stdout.write("[SUT] "+data));
child.stderr.on("data",data=>process.stderr.write("[SUT] "+data));
let suite;
try{
 let ready=false;
 for(let i=0;i<80;i++){
  if(child.exitCode!==null)throw Error("SUT exited prematurely");
  try{const response=await fetch(env.VI_BASE_URL+"/health");if(response.ok){ready=true;break}}catch{}
  await delay(250);
 }
 if(!ready)throw Error("SUT did not become healthy");
 const command=process.argv[2]||"test:all";
 const selected={"test:protocols":["--project=protocols"],"test:e2e":["--project=chromium"],"test:all":[]}[command];
 if(!selected)throw Error("Unsupported test suite: "+command);
 const playwrightCli=resolve(root,"testing/node_modules/@playwright/test/cli.js");
 suite=spawn(process.execPath,[playwrightCli,"test",...selected],{cwd:resolve(root,"testing"),env,stdio:"inherit"});
 const code=await new Promise((resolve,reject)=>{suite.once("exit",code=>resolve(code??1));suite.once("error",reject)});
 process.exitCode=code;
}catch(error){console.error(error);process.exitCode=1}
finally{suite?.kill();child.kill();await delay(400);if(child.exitCode===null)child.kill("SIGKILL");rmSync(temp,{recursive:true,force:true})}
