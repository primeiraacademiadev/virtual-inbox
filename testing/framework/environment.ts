import {readFileSync} from "node:fs";
import {resolve} from "node:path";
export type Profile={profile:string;baseUrl:string;host:string;runMode:"managed"|"attached";smtp:{plainPort:number;smtpsPort:number}};
const name=process.env.VI_TEST_PROFILE||"local";
const defaults=JSON.parse(readFileSync(resolve(import.meta.dirname,"../config",name+".json"),"utf8")) as Profile;
export const profile:Profile={...defaults,baseUrl:process.env.VI_BASE_URL||defaults.baseUrl,host:process.env.VI_SMTP_HOST||defaults.host,runMode:(process.env.VI_RUN_MODE as Profile["runMode"])||defaults.runMode,smtp:{plainPort:Number(process.env.VI_SMTP_PORT||defaults.smtp.plainPort),smtpsPort:Number(process.env.VI_SMTPS_PORT||defaults.smtp.smtpsPort)}};
export const baseUrl=profile.baseUrl.replace(/\/$/,"");
export const apiUrl=baseUrl+"/api";
export function requireManaged(){if(profile.runMode!=="managed")throw Error("This test requires VI_RUN_MODE=managed; refusing to mutate shared certificate/server configuration")}
