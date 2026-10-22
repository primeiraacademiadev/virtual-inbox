import {readFileSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";
const root=resolve(import.meta.dirname,"..");
const sources=[
 ["overview","Introdução"],["demo","Experimentar"],["integration","Integrar como mock"],
 ["sdk","Automatizar testes"],["tls","Ligações e TLS"],["architecture","Arquitetura"],
 ["development","Desenvolvimento"],["api","API"]
];
const index=[];
for(const [doc,label] of sources){
 const markdown=readFileSync(doc==="api"?join(root,"web/public/docs/api.md"):join(root,"web/public/wiki",doc+".md"),"utf8");
 const lines=markdown.split(/\r?\n/);
 let section={title:label,heading:label,body:[],anchor:"",ordinal:0};
 let ordinal=0;
 const push=()=>{const body=section.body.join(" ").replace(/<[^>]*>/g," ").replace(/[\`*_#|]/g," ").replace(/\s+/g," ").trim();if(body||section.ordinal===0)index.push({document:doc,label,title:section.title,anchor:section.anchor,ordinal:section.ordinal,text:body.slice(0,9000)})};
 for(const line of lines){
  const heading=line.match(/^(#{1,3})\s+(.+)\s*$/);
  if(heading){if(section.body.length||section.ordinal)push();ordinal++;section={title:heading[2].replace(/[*`]/g,""),heading:heading[2],body:[],anchor:"section-"+ordinal,ordinal};}
  else section.body.push(line);
 }
 push();
}
writeFileSync(join(root,"web/public/wiki/search-index.json"),JSON.stringify({version:1,sections:index}));
console.log("Documentation search index generated:",index.length,"sections");
