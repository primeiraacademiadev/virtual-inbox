import {useEffect,useRef,useState} from "react";
import {copyText} from "./clipboard";
import "./clipboard.css";
type State="idle"|"pending"|"success"|"error";
export function CopyButton({value,label="Copiar",className=""}:{value:string;label?:string;className?:string}){
 const [state,setState]=useState<State>("idle");
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const generation=useRef(0);
 useEffect(()=>()=>{generation.current++;if(timer.current)clearTimeout(timer.current)},[]);
 useEffect(()=>{generation.current++;if(timer.current)clearTimeout(timer.current);setState("idle")},[value]);
 async function copy(){
  if(timer.current)clearTimeout(timer.current);
  const current=++generation.current;
  setState("pending");
  try{await copyText(value);if(current===generation.current)setState("success")}
  catch{if(current===generation.current)setState("error")}
  if(current===generation.current)timer.current=setTimeout(()=>setState("idle"),2200);
 }
 const text=state==="success"?"✓ Copiado!":state==="error"?"Falha ao copiar":state==="pending"?"A copiar…":label;
 return <span className={"copyControl "+className}><button type="button" disabled={!value||state==="pending"} title={label} aria-label={state==="idle"?label:text} onClick={()=>void copy()} className={"copyButton copy-"+state}>{text}</button><span className="srOnly" role="status" aria-live="polite" aria-atomic="true">{state==="success"?label+": copiado para a área de transferência":state==="error"?"Não foi possível copiar "+label.toLowerCase():""}</span></span>;
}
