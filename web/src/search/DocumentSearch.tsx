import {useEffect,useMemo,useRef,useState} from "react";
import {search,type SearchIndex,type SearchResult} from "./engine";
import "./search.css";
export type SearchDestination={document:string;ordinal:number};
export function DocumentSearch({onNavigate}:{onNavigate:(target:SearchDestination)=>void}){
 const [query,setQuery]=useState(""),[index,setIndex]=useState<SearchIndex|null>(null),[error,setError]=useState("");
 const [scope,setScope]=useState("all"),[open,setOpen]=useState(false),[selected,setSelected]=useState(0);
 const field=useRef<HTMLInputElement>(null);
 useEffect(()=>{fetch("/wiki/search-index.json").then(r=>{if(!r.ok)throw Error("Índice de pesquisa indisponível");return r.json()}).then(setIndex).catch(e=>setError(String(e)))},[]);
 useEffect(()=>{const listener=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();setOpen(true);field.current?.focus()}if(e.key==="Escape"){setOpen(false)}};window.addEventListener("keydown",listener);return()=>window.removeEventListener("keydown",listener)},[]);
 const results=useMemo(()=>index?search({version:index.version,sections:index.sections.filter(s=>scope==="all"||(scope==="api"?s.document==="api":scope==="settings"?s.document==="tls":s.document!=="api"&&s.document!=="tls"))},query):[],[index,query,scope]);
 function visit(result:SearchResult){onNavigate({document:result.document,ordinal:result.ordinal});setOpen(false)}
 return <div className="docSearch"><div className="docSearchBox"><input ref={field} aria-label="Pesquisar na documentação" placeholder="Pesquisar documentação, protocolos, endpoints…" value={query} onFocus={()=>setOpen(true)} onChange={e=>{setQuery(e.target.value);setSelected(0)}} onKeyDown={e=>{if(e.key==="ArrowDown"){e.preventDefault();setSelected(n=>Math.min(n+1,results.length-1))}if(e.key==="ArrowUp"){e.preventDefault();setSelected(n=>Math.max(0,n-1))}if(e.key==="Enter"&&results[selected])visit(results[selected])}}/><kbd>Ctrl K</kbd></div>
 {open&&<div className="docSearchResults"><div className="docSearchFilters">{[["all","Tudo"],["guide","Guias"],["api","API"],["settings","Configuração"]].map(([id,label])=><button key={id} aria-pressed={scope===id} onClick={()=>setScope(id)}>{label}</button>)}<button className="docSearchClose" onClick={()=>setOpen(false)} aria-label="Fechar pesquisa">×</button></div>
 {error&&<p role="alert">{error}</p>}{!index&&!error&&<p>A carregar índice…</p>}
 {index&&query&&!results.length&&<p>Sem resultados para “{query}”.</p>}
 {index&&!query&&<p>Procura por assunto, método HTTP, endpoint ou protocolo.</p>}
 <div role="listbox" aria-label="Resultados da pesquisa">{results.map((result,i)=><button role="option" aria-selected={selected===i} className={selected===i?"selected":""} key={result.document+result.ordinal} onClick={()=>visit(result)}><strong>{result.title}</strong><span>{result.label}</span><small>{result.snippet}</small></button>)}</div></div>}
 </div>;
}
