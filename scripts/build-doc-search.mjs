import {readFileSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";
const root=resolve(import.meta.dirname,"..");
const names=["overview","demo","integration","sdk","tls","architecture","development","api"];
for(const locale of ["pt-PT","en","fr"]){
 const index=[];
 for(const doc of names){
  const markdown=readFileSync(join(root,"web/public/wiki",locale,doc+".md"),"utf8");
  let ordinal=0;
  let section={title:doc,body:[]};
  const push=()=>{if(section.body.length)index.push({document:doc,label:doc,title:section.title,anchor:"section-"+ordinal,ordinal,text:section.body.join(" ").replace(/[\`*#|]/g," ").slice(0,9000)})};
  for(const line of markdown.split(/\r?\n/)){
   const heading=line.match(/^#{1,3}\s+(.+)$/);
   if(heading){push();ordinal++;section={title:heading[2],body:[]}}else section.body.push(line);
  }
  push();
 }
 writeFileSync(join(root,"web/public/wiki",locale,"search-index.json"),JSON.stringify({version:1,sections:index}));
 console.log(locale+": "+index.length+" searchable sections");
}
