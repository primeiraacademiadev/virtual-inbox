import {mkdirSync,copyFileSync,existsSync} from "node:fs";
import {dirname,resolve,join} from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const documents=["overview","demo","integration","sdk","api","tls","architecture","development"];
for(const locale of ["pt-PT","en","fr"]){
 const destination=join(root,"web/public/wiki",locale);
 mkdirSync(destination,{recursive:true});
 for(const name of documents){
  const source=join(root,"docs/i18n",locale,name+".md");
  if(!existsSync(source))throw Error("Missing documentation translation: "+locale+"/"+name);
  copyFileSync(source,join(destination,name+".md"));
 }
}
execFileSync(process.execPath,[join(root,"scripts/build-doc-search.mjs")],{stdio:"inherit"});
