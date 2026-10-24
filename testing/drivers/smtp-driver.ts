import nodemailer from "nodemailer";
import {readFileSync} from "node:fs";
import {profile} from "../framework/environment";
export type Transport="plain"|"starttls"|"smtps";
export type MailInput={to:string;subject:string;text:string;attachments?:Array<{filename:string;content:Buffer;contentType?:string}>};
export class SmtpDriver{
 private tls(){return process.env.VI_TEST_CA_FILE?{ca:readFileSync(process.env.VI_TEST_CA_FILE),rejectUnauthorized:true,servername:process.env.VI_TLS_SERVERNAME||"localhost"}:(()=>{throw new Error("VI_TEST_CA_FILE is required for verified STARTTLS/SMTPS tests")})();}
 async send(mode:Transport,input:MailInput){
  const secure=mode==="smtps";
  const transport=nodemailer.createTransport({
   host:profile.host,port:secure?profile.smtp.smtpsPort:profile.smtp.plainPort,
   secure,ignoreTLS:mode==="plain",requireTLS:mode==="starttls",
   tls:mode==="plain"?undefined:this.tls(),
   disableFileAccess:true,disableUrlAccess:true,
   connectionTimeout:5000,greetingTimeout:5000,socketTimeout:12000
  });
  try{return await transport.sendMail({from:"harness@example.test",...input})}finally{transport.close()}
 }
}
