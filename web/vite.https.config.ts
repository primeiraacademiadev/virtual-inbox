import {defineConfig} from "vite";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

const directory=resolve(process.env.TLS_CERTIFICATES_DIR||"../data/certificates");
export default defineConfig({
 server:{
  host:"127.0.0.1",
  port:5174,
  https:{
   cert:readFileSync(resolve(process.env.TLS_CERT_FILE||directory+"/server.pem")),
   key:readFileSync(resolve(process.env.TLS_KEY_FILE||directory+"/server-key.pem"))
  },
  proxy:{
   "/api":{target:"http://127.0.0.1:3000",rewrite:path=>path.replace(/^\/api/,"")},
   "/demo":{target:"http://127.0.0.1:3001",rewrite:path=>path.replace(/^\/demo/,"")}
  }
 }
});
