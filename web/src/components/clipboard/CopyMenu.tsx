import {useState} from "react";
import {CopyButton} from "./CopyButton";
export type CopyOption={label:string;value:string};
export function CopyMenu({items,label="Copiar…"}:{items:CopyOption[];label?:string}){
 const [open,setOpen]=useState(false);
 return <details className="copyMenu" open={open} onToggle={e=>setOpen((e.currentTarget as HTMLDetailsElement).open)}>
 <summary aria-label={label}>{label}</summary>
 <div className="copyMenuItems">{items.filter(x=>x.value).map(item=><div key={item.label} className="copyMenuItem"><span title={item.value}>{item.label}</span><CopyButton value={item.value} label="Copiar"/></div>)}</div>
 </details>;
}
