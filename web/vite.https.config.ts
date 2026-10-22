import {defineConfig,mergeConfig} from "vite";
import base from "./vite.config.js";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

const directory=resolve(process.env.TLS_CERTIFICATES_DIR||"../data/certificates");
export default mergeConfig(base,defineConfig({
 server:{
  port:5174,
  https:{
   cert:readFileSync(resolve(process.env.TLS_CERT_FILE||directory+"/server.pem")),
   key:readFileSync(resolve(process.env.TLS_KEY_FILE||directory+"/server-key.pem"))
  }
 }
}));
