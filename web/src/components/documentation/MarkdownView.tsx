import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {ReactNode} from "react";

const documents=new Set(["overview","demo","integration","sdk","api","tls","architecture","development"]);
type Props={markdown:string;onDocument:(id:string)=>void};
export function MarkdownView({markdown,onDocument}:Props){
 function navigate(href:string){
  const [raw,anchor]=href.split("#",2);
  if(!raw && anchor){document.getElementById(decodeURIComponent(anchor))?.scrollIntoView({behavior:"smooth"});return}
  const normalized=raw.replace(/^\.\.\//,"").replace(/^docs\//,"");
  const id=normalized==="README.md"?"overview":normalized.endsWith(".md")?normalized.slice(0,-3):normalized;
  if(documents.has(id)){onDocument(id);return}
  if(normalized.startsWith("/")||normalized.includes(".."))return;
  window.open("https://github.com/primeiraacademiadev/virtual-inbox/blob/main/"+encodeURI(normalized),"_blank","noopener,noreferrer");
 }
 return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
  a:({href,children})=>{
   if(!href)return <>{children}</>;
   if(/^https?:\/\//i.test(href))return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
   return <a href={href} onClick={event=>{event.preventDefault();navigate(href)}}>{children}</a>;
  }
 }}>{markdown}</ReactMarkdown>;
}
