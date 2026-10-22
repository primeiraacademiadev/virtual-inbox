import ReactMarkdown from "react-markdown";
import {useCallback,useEffect,useMemo,useState} from "react";
import {classify,del,post,request,type Channel,type EventEntry,type Message,type Observer,type Recipient} from "./api";
type View="split"|"inbox"|"logs";
type Page="workspace"|"connections"|"documentation"|"api";
const base=(c:Channel)=>c==="email"?"/mailboxes":"/phone-numbers";
export default function App(){
 const [page,setPage]=useState<Page>("workspace");
 const [connection,setConnection]=useState<any>(null);
 const [docText,setDocText]=useState("");
 const [apiText,setApiText]=useState("");
 const [observer,setObserver]=useState(()=>sessionStorage.getItem("virtual-inbox-observer")||"");
 const [inboxes,setInboxes]=useState<Recipient[]>([]);
 const [selected,setSelected]=useState<string|null>(null);
 const [view,setView]=useState<View>("split");
 const [collapsed,setCollapsed]=useState(false);
 const [groups,setGroups]=useState({email:true,sms:true});
 const [modal,setModal]=useState<Channel|null>(null);
 const [identifier,setIdentifier]=useState("");
 const [ttlOpen,setTtlOpen]=useState(false);
 const [ttl,setTtl]=useState("1800");
 const [missing,setMissing]=useState(false);
 const [error,setError]=useState("");
 const [compose,setCompose]=useState(false);
 const [sender,setSender]=useState("demo@example.test");
 const [subject,setSubject]=useState("Mensagem de demonstração");
 const [body,setBody]=useState("Esta é uma mensagem de teste.");
 const [messages,setMessages]=useState<Record<string,Message[]>>({});
 const [seen,setSeen]=useState<Record<string,string[]>>({});
 const [detail,setDetail]=useState<Message|null>(null);
 const [logs,setLogs]=useState<EventEntry[]>([]);
 const [logFilter,setLogFilter]=useState("");
 const [connected,setConnected]=useState(false);
 useEffect(()=>{void request<any>("/connection-info").then(setConnection).catch(()=>{});fetch("/docs/guide.md").then(r=>r.ok?r.text():"Documentation unavailable").then(setDocText).catch(()=>{});fetch("/docs/api.md").then(r=>r.ok?r.text():"API reference unavailable").then(setApiText).catch(()=>{})},[]);
 const active=inboxes.find(x=>x.id===selected)||null;
 const refresh=useCallback(async(id:string,c:Channel)=>{try{const m=await request<Message[]>(base(c)+"/"+id+"/messages");setMessages(p=>({...p,[id]:m}))}catch{}},[]);
 const syncObserver=useCallback(async(id:string)=>{const snapshot=await request<Observer>("/observers/"+id);setInboxes(snapshot.inboxes);for(const r of snapshot.inboxes)void refresh(r.id,r.channel)},[refresh]);
 useEffect(()=>{
  let activeSse:EventSource|null=null;let closed=false;
  const path=observer?"/api/observers/"+observer+"/events":"/api/observers/events";
  activeSse=new EventSource(path);setConnected(false);
  const handleSession=(ev:MessageEvent)=>{const data=JSON.parse(ev.data) as Observer; if(closed)return;setObserver(data.observerId);sessionStorage.setItem("virtual-inbox-observer",data.observerId);setInboxes(data.inboxes);data.inboxes.forEach(r=>void refresh(r.id,r.channel))};
  const handleLog=(ev:MessageEvent)=>{const entry=JSON.parse(ev.data) as EventEntry;setLogs(p=>p.some(x=>x.id===entry.id)?p:[...p.slice(-499),entry]);if(entry.resourceId&&entry.type.startsWith("message.")){const r=inboxes.find(x=>x.id===entry.resourceId);if(r)void refresh(r.id,r.channel)}};
  activeSse.addEventListener("session.initialized",handleSession);
  activeSse.addEventListener("session.restored",handleSession);
  activeSse.addEventListener("log",handleLog);
  activeSse.addEventListener("inbox.notification",handleLog);
  activeSse.addEventListener("log.gap",()=>{if(observer)void syncObserver(observer)});
  activeSse.onopen=()=>setConnected(true);
  activeSse.onerror=()=>setConnected(false);
  return()=>{closed=true;activeSse?.close()};
 },[observer,refresh,syncObserver]);
 useEffect(()=>{if(!observer)return;const poll=setInterval(()=>{void syncObserver(observer)},15000);return()=>clearInterval(poll)},[observer,syncObserver]);
 const unread=useCallback((id:string)=>(messages[id]||[]).filter(m=>!(seen[id]||[]).includes(m.id)).length,[messages,seen]);
 const focus=(id:string)=>{setSelected(id);setView(v=>v==="inbox"&&id===selected?"split":"inbox");setCompose(false);setDetail(null)};
 async function addExisting(){if(!observer)return;const type=classify(identifier.trim());if(!type){setError("Formato inválido.");return}try{const all=await request<Recipient[]>(base(type));const r=all.find(x=>x.address.toLowerCase()===identifier.trim().toLowerCase());if(!r){setMissing(true);return}await post("/observers/"+observer+"/inboxes",{inboxId:r.id});await syncObserver(observer);focus(r.id);setModal(null)}catch(e){setError(String(e))}}
 async function create(){if(!observer||!modal)return;const c=identifier.trim()?classify(identifier.trim()):modal;if(!c)return;try{const r=await post<Recipient>(base(c),{...(identifier.trim()?{[c==="email"?"address":"phoneNumber"]:identifier.trim()}:{}),ttlSeconds:Number(ttl),observerId:observer});await syncObserver(observer);setSelected(r.id);setView("inbox");setModal(null);setMissing(false);setIdentifier("");setCompose(false)}catch(e){setError(String(e))}}
 async function send(){if(!active)return;try{if(active.channel==="sms")await post("/sms/messages",{from:sender,to:active.address,body});else await post("/mailboxes/"+active.id+"/demo-send",{from:sender,subject,body});await refresh(active.id,active.channel);setCompose(false)}catch(e){setError(String(e))}}
 async function deleteMessage(m:Message){if(!active)return;try{await del(base(active.channel)+"/"+active.id+"/messages/"+m.id);setDetail(null);await refresh(active.id,active.channel)}catch(e){setError(String(e))}}
 async function removeInbox(){if(!active||!observer)return;try{if(!active.system&&confirm("Eliminar definitivamente esta inbox e as mensagens?"))await del(base(active.channel)+"/"+active.id);else await del("/observers/"+observer+"/inboxes/"+active.id);await syncObserver(observer);setSelected(null);setView("logs")}catch(e){setError(String(e))}}
 const filteredLogs=useMemo(()=>logs.filter(x=>JSON.stringify(x).toLowerCase().includes(logFilter.toLowerCase())),[logs,logFilter]);
 return <div className="shell">
 <header><button aria-label="Alternar menu" onClick={()=>setCollapsed(v=>!v)}>☰</button><strong>✉ Virtual Inbox</strong><div className="spacer"/><span className="tiny">{connected?"● SSE ligado":"○ SSE desligado"}</span><span className="tiny">Sessão: {observer.slice(0,8)||"a ligar..."}</span></header>
 <nav className="topNav"><button onClick={()=>setPage("workspace")}>Inboxes</button><button onClick={()=>setPage("connections")}>Ligações e TLS</button><button onClick={()=>setPage("documentation")}>Documentação</button><button onClick={()=>setPage("api")}>API</button></nav>
 {page==="workspace"&&<div className="workspace">
 <aside className={"sidebar"+(collapsed?" closed":"")}>
 {(["email","sms"] as Channel[]).map(c=><section key={c} className="inboxGroup">
 <div className="groupHead">
 <div className="navWithTools">
 <button className="ghost groupToggle" onClick={()=>setGroups(p=>({...p,[c]:!p[c]}))} aria-label={c==="email"?"Inboxes — Email":"Inboxes — SMS"}>{c==="email"?"✉":"▣"} {!collapsed&&(c==="email"?"Inboxes — Email":"Inboxes — SMS")} {!collapsed&&(groups[c]?"⌄":"›")}</button>
 {collapsed&&<div className="hoverTools" role="group"><span>{c==="email"?"Inboxes — Email":"Inboxes — SMS"}</span><button onClick={()=>{setModal(c);setIdentifier("");setMissing(false);setError("")}}>+ Adicionar</button></div>}
 </div>
 {!collapsed&&<button aria-label={"Criar inbox "+c} title="Adicionar inbox" onClick={()=>{setModal(c);setIdentifier("");setMissing(false);setError("")}}>+</button>}
 </div>
 {groups[c]&&inboxes.filter(r=>r.channel===c).map(r=><div key={r.id} className="navWithTools"><button className={"navItem"+(selected===r.id&&view!=="logs"?" active":"")} onClick={()=>focus(r.id)} title={collapsed?undefined:r.address} aria-label={r.address}>{!collapsed&&<span className="name">{r.system?"⚠ ":""}{r.address}</span>}{collapsed&&<span>{c==="email"?"✉":"▣"}</span>}{unread(r.id)>0&&<span className="badge">{unread(r.id)}</span>}</button>
 {collapsed&&<div className="hoverTools" role="group"><strong>{r.address}</strong><button onClick={()=>focus(r.id)}>Abrir inbox</button><button onClick={()=>void navigator.clipboard.writeText(r.address)}>Copiar</button><button onClick={()=>{setSelected(r.id);setView("inbox");setCompose(true)}}>Enviar mensagem</button></div>}
 </div>)}
 </section>)}
 <div className="spacer"/><button className={"navItem"+(view==="logs"?" active":"")} onClick={()=>setView(v=>v==="logs"?"split":"logs")}>☷ {!collapsed&&"Live Logs"}</button>
 </aside>
 <main className={"main "+(view==="split"?"split":view==="logs"?"logsOnly":"inboxOnly")}>
 {view!=="logs"&&<section className="panel"><div className="panelHead"><div><div className="panelTitle">{active?.address||"Seleciona uma inbox"}</div>{active&&<div className="tiny">{active.system?"Captura de anomalias":"Expira: "+new Date(active.expiresAt!).toLocaleString()}</div>}</div><div className="spacer"/>{active&&<><button title="Copiar destinatário" onClick={()=>void navigator.clipboard.writeText(active.address)}>Copiar</button><button title="Remover inbox" onClick={()=>void removeInbox()}>×</button></>}<button title="Minimizar inbox" onClick={()=>setView("logs")}>▾</button></div>
 {active&&compose&&<div className="composeOverlay"><div className="compose"><strong>Enviar para {active.address}</strong><label>Remetente<input value={sender} onChange={e=>setSender(e.target.value)}/></label>{active.channel==="email"&&<label>Assunto<input value={subject} onChange={e=>setSubject(e.target.value)}/></label>}<label>Mensagem<textarea rows={3} value={body} onChange={e=>setBody(e.target.value)}/></label><div className="actions"><button onClick={()=>setCompose(false)}>Cancelar</button><button onClick={()=>void send()}>Enviar</button></div></div></div>}
 <div className="panelBody inboxScroll">{active&&<div className="messages">{(messages[active.id]||[]).slice().reverse().map(m=><button key={m.id} className={"msg"+(!(seen[active.id]||[]).includes(m.id)?" unread":"")} onClick={()=>{setDetail(m);setSeen(p=>({...p,[active.id]:[...new Set([...(p[active.id]||[]),m.id])]}))}}><div className="msgTitle">{m.subject||m.body.slice(0,65)||"(sem conteúdo)"} <span className="tiny">{new Date(m.receivedAt).toLocaleTimeString()}</span></div><div className="tiny">{m.from}{m.captureReason?" · "+m.captureReason:""}</div></button>)}{detail&&detail.destinationId===active.id&&<div className="detail"><div className="actions"><button onClick={()=>void deleteMessage(detail)}>Eliminar mensagem</button><button onClick={()=>setDetail(null)}>Fechar</button></div><p><b>De:</b> {detail.from}</p><p><b>Para:</b> {detail.originalRecipient}</p><p><b>Assunto:</b> {detail.subject||"—"}</p><div>{detail.body}</div></div>}</div>}</div>{active&&!compose&&<button className="fab" aria-label="Enviar mensagem" title="Enviar para esta inbox" onClick={()=>setCompose(v=>!v)}>{compose?"×":"+"}</button>}</section>}
 {view!=="inbox"&&<section className="panel"><div className="panelHead"><strong>Live Logs</strong><div className="spacer"/><button onClick={()=>setView("inbox")} title="Minimizar logs">▾</button></div><div className="logFilters"><input aria-label="Filtrar logs" placeholder="Filtrar eventos, recurso, nível..." value={logFilter} onChange={e=>setLogFilter(e.target.value)}/><button onClick={()=>setLogs([])}>Limpar vista</button></div><div className="panelBody">{filteredLogs.slice().reverse().map(e=><div className="logRow" key={e.id}><span>{new Date(e.at).toLocaleTimeString()}</span>{e.type} <span>{e.resourceId?.slice(0,8)||""}</span></div>)}</div></section>}
 </main></div>}
 {page==="connections"&&<main className="information"><h2>Ligações e certificados</h2><p>O TLS termina no servidor Node.js para HTTPS, STARTTLS e SMTPS.</p><h3>Configuração dos clientes</h3><table><thead><tr><th>Protocolo</th><th>Servidor</th><th>Porta</th><th>Segurança</th></tr></thead><tbody><tr><td>HTTPS API</td><td>{connection?.host||"localhost"}</td><td>{connection?.http?.httpsPort||"—"}</td><td>TLS</td></tr><tr><td>SMTP</td><td>{connection?.host||"localhost"}</td><td>{connection?.smtp?.plainPort||2525}</td><td>{connection?.smtp?.starttls?"STARTTLS disponível":"Sem STARTTLS"}</td></tr><tr><td>SMTPS</td><td>{connection?.host||"localhost"}</td><td>{connection?.smtp?.implicitTlsPort||"—"}</td><td>TLS implícito</td></tr><tr><td>SMS API</td><td>{connection?.host||"localhost"}</td><td>{connection?.http?.httpsPort||connection?.http?.port||3000}</td><td>HTTP(S)</td></tr></tbody></table><h3>Certificado instalado</h3>{connection?.certificate?<><p>Emissor: {connection.certificate.issuer}</p><p>Validade: {connection.certificate.validTo}</p><p>SHA-256: {connection.certificate.fingerprint256}</p><a href={"/api"+connection.certificate.download} download>Descarregar certificado público (PEM)</a></>:<p>TLS não está configurado. Define TLS_CERT_FILE e TLS_KEY_FILE no servidor e reinicia a aplicação.</p>}<p className="tiny">A chave privada nunca é disponibilizada para download. A importação de chaves pela web fica desativada até existir autenticação administrativa.</p></main>}
 {page==="documentation"&&<main className="information"><h2>Documentação de utilização</h2><article className="docMarkdown"><ReactMarkdown>{docText}</ReactMarkdown></article></main>}
 {page==="api"&&<main className="information"><h2>API pública da sandbox</h2><p>Exclui endpoints de demonstração.</p><article className="docMarkdown"><ReactMarkdown>{apiText}</ReactMarkdown></article></main>}
 {modal&&<div className="modalBackdrop"><div className="modal"><h2>Adicionar inbox</h2><label>Identificador (vazio = aleatório)<input autoFocus value={identifier} placeholder={modal==="email"?"teste@sandbox.test":"+351900000001"} onChange={e=>{setIdentifier(e.target.value);setMissing(false);setError("")}}/></label>{identifier.trim()&&<span className={classify(identifier.trim())?"success":"error"}>{classify(identifier.trim())==="email"?"✓ Email":classify(identifier.trim())==="sms"?"✓ SMS":"Identificador inválido"}</span>}<div className="row"><button className="clock" title="Configurar TTL" onClick={()=>setTtlOpen(v=>!v)}>⏱</button>{ttlOpen&&<label>TTL (segundos)<input type="number" min="1" max="604800" value={ttl} onChange={e=>setTtl(e.target.value)}/></label>}</div>{missing&&<p>Esta inbox não existe. Pretendes criá-la?</p>}{error&&<p className="error">{error}</p>}<div className="actions"><button onClick={()=>setModal(null)}>Cancelar</button><button disabled={!!identifier.trim()&&!classify(identifier.trim())} onClick={()=>void (missing||!identifier.trim()?create():addExisting())}>{missing?"Criar":identifier.trim()?"Adicionar":"Criar aleatória"}</button></div></div></div>}
 </div>
}
