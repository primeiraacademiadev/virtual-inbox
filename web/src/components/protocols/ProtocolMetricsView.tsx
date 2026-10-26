import React, { useCallback, useEffect, useState } from "react";
import { request } from "../../api";
type Counter = {
 connectionsTotal: number; connectionsActive: number; authentications: number;
 commands: number; messages: number; errors: number; simulatedErrors: number;
};
export function ProtocolMetricsView({ adminToken }: {adminToken:string}) {
 const [data,setData]=useState<Record<"SMTP"|"POP3",Counter>|null>(null);
 const [error,setError]=useState("");
 const reload=useCallback(async()=>{
  if(!adminToken || location.protocol!=="https:") return;
  try {
   const value=await request<Record<"SMTP"|"POP3",Counter>>("/admin/test/metrics",{
    headers:{Authorization:"Bearer "+adminToken},
   });
   setData(value);setError("");
  } catch(e) {setError(e instanceof Error?e.message:"Unable to load metrics");}
 },[adminToken]);
 useEffect(()=>{void reload();const interval=setInterval(()=>void reload(),5000);return ()=>clearInterval(interval);},[reload]);
 return <section className="detail">
  <h3>Protocol counters</h3>
  <button type="button" onClick={()=>void reload()}>Refresh counters</button>
  {error && <p role="alert">{error}</p>}
  {data && <table><thead><tr><th>Metric</th><th>SMTP</th><th>POP3</th></tr></thead>
   <tbody>{([
    ["connectionsTotal","Connections"],["connectionsActive","Open connections"],
    ["authentications","Authenticated"],["commands","Commands"],
    ["messages","Messages"],["errors","Errors"],["simulatedErrors","Simulated errors"]
   ] as Array<[keyof Counter,string]>).map(([key,label])=><tr key={key}>
    <th>{label}</th><td>{data.SMTP[key]}</td><td>{data.POP3[key]}</td>
   </tr>)}</tbody></table>}
 </section>;
}
