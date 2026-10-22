import {mkdirSync,writeFileSync,readFileSync} from "node:fs";
import {dirname,resolve,join} from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const documents=["overview","demo","integration","sdk","api","tls","architecture","development"];
const content=JSON.parse(readFileSync(join(root,"scripts/i18n-doc-content.json"),"utf8"));
for(const locale of ["pt-PT","en","fr"]){
 const target=join(root,"web/public/wiki",locale);mkdirSync(target,{recursive:true});
 if(content[locale]?.length!==documents.length)throw Error("Missing localized guide for "+locale);
 documents.forEach((name,i)=>{
  const [title,description]=content[locale][i];
  writeFileSync(join(target,name+".md"),"# "+title+"\n\n"+description+"\n\n## "+(locale==="fr"?"Voir aussi":locale==="en"?"See also":"Consultar também")+"\n\n[API](api.md) · [TLS](tls.md) · [SDK](sdk.md)\n");
 });
}
execFileSync(process.execPath,[join(root,"scripts/build-doc-search.mjs")],{stdio:"inherit"});
