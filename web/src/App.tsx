import {useI18n} from "./i18n/context";
import {LanguageSelector} from "./i18n/LanguageSelector";
import {CopyButton} from "./components/clipboard/CopyButton";
import {CopyMenu} from "./components/clipboard/CopyMenu";
import {DocumentSearch,type SearchDestination} from "./search/DocumentSearch";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {useCallback,useEffect,useMemo,useState,useRef} from "react";
import {classify,del,post,request,type Channel,type EventEntry,type Message,type Observer,type Recipient} from "./api";
type View="split"|"inbox"|"logs";
type Page="workspace"|"connections"|"documentation"|"api";
async function postDemo(path:string,data:unknown,ports?:{demoPort?:number;demoHttpsPort?:number}){const endpoint=location.port==="5173"?"/demo"+path:(location.protocol==="https:"?"https://"+location.hostname+":"+(ports?.demoHttpsPort||3444):"http://"+location.hostname+":"+(ports?.demoPort||3001))+path;
 const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});if(!response.ok)throw new Error("Demo send failed: "+response.status);return response.json()}
const base=(c:Channel)=>c==="email"?"/mailboxes":"/phone-numbers";
export default function App(){
 const {locale,t,formatDate}=useI18n();
 const [page,setPage]=useState<Page>("workspace");
 const [connection,setConnection]=useState<any>(null);
 const [adminToken,setAdminToken]=useState("");
 const [tlsCertFile,setTlsCertFile]=useState<File|null>(null);
 const [tlsKeyFile,setTlsKeyFile]=useState<File|null>(null);
 const [tlsStatus,setTlsStatus]=useState("");
 const [networkFields,setNetworkFields]=useState<Record<string,string>>({});
 const [networkStatus,setNetworkStatus]=useState("");
 const [docText,setDocText]=useState("");
 const [docPage,setDocPage]=useState("overview");
 const [jump,setJump]=useState<SearchDestination|null>(null);
 const [apiText,setApiText]=useState("");
 const [observer,setObserver]=useState(()=>sessionStorage.getItem("virtual-inbox-observer")||"");
 const [inboxes,setInboxes]=useState<Recipient[]>([]);
 const inboxesRef=useRef<Recipient[]>([]);
 useEffect(()=>{inboxesRef.current=inboxes},[inboxes]);
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
 const [outgoingFiles,setOutgoingFiles]=useState<File[]>([]);
 const [messages,setMessages]=useState<Record<string,Message[]>>({});
 const [seen,setSeen]=useState<Record<string,string[]>>({});
 const [detail,setDetail]=useState<Message|null>(null);
 const [logs,setLogs]=useState<EventEntry[]>([]);
 const [logFilter,setLogFilter]=useState("");
 const [connected,setConnected]=useState(false);
 useEffect(()=>{void request<any>("/connection-info").then(data=>{setConnection(data);setNetworkFields(data.networkSettings||{})}).catch(()=>{});fetch("/wiki/"+locale+"/api.md").then(r=>r.ok?r.text():"API reference unavailable").then(setApiText).catch(()=>{})},[locale]);
 useEffect(()=>{fetch("/wiki/"+locale+"/"+docPage+".md").then(r=>r.ok?r.text():"Documentation unavailable").then(setDocText).catch(()=>setDocText("Documentation unavailable"))},[docPage,locale]);
 useEffect(()=>{if(!jump||page!=="documentation"&&page!=="api")return;const timeout=setTimeout(()=>{const root=document.querySelector(".information .docMarkdown");const heading=root?.querySelectorAll("h1,h2,h3")[Math.max(0,jump.ordinal-1)] as HTMLElement|undefined;heading?.scrollIntoView({behavior:"smooth",block:"start"});if(heading){heading.classList.add("searchTarget");setTimeout(()=>heading.classList.remove("searchTarget"),1600)}setJump(null)},130);return()=>clearTimeout(timeout)},[jump,docText,apiText,page]);
 function navigateSearch(target:SearchDestination){setJump(target);if(target.document==="api")setPage("api");else{setDocPage(target.document);setPage("documentation")}}
 const active=inboxes.find(x=>x.id===selected)||null;
 const refresh=useCallback(async(id:string,c:Channel)=>{try{const m=await request<Message[]>(base(c)+"/"+id+"/messages");setMessages(p=>({...p,[id]:m}))}catch{}},[]);
 const syncObserver=useCallback(async(id:string)=>{const snapshot=await request<Observer>("/observers/"+id);setInboxes(snapshot.inboxes);for(const r of snapshot.inboxes)void refresh(r.id,r.channel)},[refresh]);
 useEffect(()=>{
  let activeSse:EventSource|null=null;let closed=false;
  const path=observer?"/api/observers/"+observer+"/events":"/api/observers/events";
  activeSse=new EventSource(path);setConnected(false);
  const handleSession=(ev:MessageEvent)=>{const data=JSON.parse(ev.data) as Observer; if(closed)return;setObserver(data.observerId);sessionStorage.setItem("virtual-inbox-observer",data.observerId);setInboxes(data.inboxes);data.inboxes.forEach(r=>void refresh(r.id,r.channel))};
  const handleLog=(ev:MessageEvent)=>{const entry=JSON.parse(ev.data) as EventEntry;setLogs(p=>p.some(x=>x.id===entry.id)?p:[...p.slice(-499),entry]);if(entry.resourceId&&entry.type.startsWith("message.")){const r=inboxesRef.current.find(x=>x.id===entry.resourceId);if(r)void refresh(r.id,r.channel)}};
  activeSse.addEventListener("session.initialized",handleSession);
  activeSse.addEventListener("session.restored",handleSession);
  activeSse.addEventListener("log",handleLog);
  activeSse.addEventListener("inbox.notification",handleLog);
  activeSse.addEventListener("log.gap",()=>{if(observer)void syncObserver(observer)});
  activeSse.addEventListener("log.reset",()=>{setLogs([]);if(observer)void syncObserver(observer)});
  activeSse.onopen=()=>setConnected(true);
  activeSse.onerror=()=>{setConnected(false);if(observer){void request<Observer>("/observers/"+observer).catch((e:Error & {status?:number})=>{if(e.status===404){sessionStorage.removeItem("virtual-inbox-observer");setObserver("");setInboxes([])}})}};
  return()=>{closed=true;activeSse?.close()};
 },[observer,refresh,syncObserver]);
 useEffect(()=>{if(!observer)return;const poll=setInterval(()=>{void syncObserver(observer)},15000);return()=>clearInterval(poll)},[observer,syncObserver]);
 const unread=useCallback((id:string)=>(messages[id]||[]).filter(m=>!(seen[id]||[]).includes(m.id)).length,[messages,seen]);
 const focus=(id:string)=>{setSelected(id);setView(v=>v==="inbox"&&id===selected?"split":"inbox");setCompose(false);setDetail(null)};
 async function addExisting(){if(!observer)return;const type=classify(identifier.trim());if(!type){setError("Formato inválido.");return}try{const all=await request<Recipient[]>(base(type));const r=all.find(x=>x.address.toLowerCase()===identifier.trim().toLowerCase());if(!r){setMissing(true);return}await post("/observers/"+observer+"/inboxes",{inboxId:r.id});await syncObserver(observer);focus(r.id);setModal(null)}catch(e){setError(String(e))}}
 async function create(){if(!observer||!modal)return;const c=identifier.trim()?classify(identifier.trim()):modal;if(!c)return;try{const r=await post<Recipient>(base(c),{...(identifier.trim()?{[c==="email"?"address":"phoneNumber"]:identifier.trim()}:{}),ttlSeconds:Number(ttl),observerId:observer});await syncObserver(observer);setSelected(r.id);setView("inbox");setModal(null);setMissing(false);setIdentifier("");setCompose(false)}catch(e){setError(String(e))}}
 async function send(){if(!active)return;try{if(active.channel==="sms")await postDemo("/sms/messages",{from:sender,to:active.address,body},connection?.http);else {const attachments=await Promise.all(outgoingFiles.map(async file=>{const bytes=new Uint8Array(await file.arrayBuffer());let binary="";for(const v of bytes)binary+=String.fromCharCode(v);return {filename:file.name,contentType:file.type||"application/octet-stream",contentBase64:btoa(binary)}}));await postDemo("/mailboxes/"+active.id+"/demo-send",{from:sender,subject,body,attachments},connection?.http);}await refresh(active.id,active.channel);setOutgoingFiles([]);setCompose(false)}catch(e){setError(String(e))}}
 async function deleteMessage(m:Message){if(!active)return;try{await del(base(active.channel)+"/"+active.id+"/messages/"+m.id);setDetail(null);await refresh(active.id,active.channel)}catch(e){setError(String(e))}}
 async function removeInbox(){if(!active||!observer)return;try{if(!active.system&&confirm("Eliminar definitivamente esta inbox e as mensagens?"))await del(base(active.channel)+"/"+active.id);else await del("/observers/"+observer+"/inboxes/"+active.id);await syncObserver(observer);setSelected(null);setView("logs")}catch(e){setError(String(e))}}
 async function saveNetwork(){
   try{
    const endpoint=location.protocol==="https:"?"/api/admin/network":"https://"+location.hostname+":3443/admin/network";
    const response=await fetch(endpoint,{method:"PUT",headers:{"Content-Type":"application/json","Authorization":"Bearer "+adminToken},body:JSON.stringify(networkFields)});
    if(!response.ok)throw Error("Configuration rejected: HTTP "+response.status);
    setNetworkStatus(t("networkSaved"));
   }catch(e){setNetworkStatus(String(e))}
 }
 async function importCertificate(){
  if(!tlsCertFile||!tlsKeyFile){setTlsStatus(t("selectPem"));return}
  try{
   const endpoint=location.protocol==="https:"?"/api/admin/tls":"https://"+location.hostname+":3443/admin/tls";
   const response=await fetch(endpoint,{method:"PUT",headers:{"Content-Type":"application/json","Authorization":"Bearer "+adminToken},body:JSON.stringify({cert:await tlsCertFile.text(),key:await tlsKeyFile.text()})});
   if(!response.ok)throw new Error("Importação recusada: HTTP "+response.status);
   const result=await response.json();setTlsStatus(t("certificateInstalled")+" "+result.subject);
   setAdminToken("");setTlsCertFile(null);setTlsKeyFile(null);
  }catch(e){setTlsStatus(String(e))}
 }
 const filteredLogs=useMemo(()=>logs.filter(x=>JSON.stringify(x).toLowerCase().includes(logFilter.toLowerCase())),[logs,logFilter]);
 return <div className="shell">
 <header><button aria-label={t("toggleMenu")} onClick={()=>setCollapsed(v=>!v)}>☰</button><strong>✉ Virtual Inbox</strong><div className="spacer"/><span className="tiny">{connected?t("connected"):t("disconnected")}</span><LanguageSelector/><span className="tiny">{t("session")} {observer.slice(0,8)||t("connecting")}</span><CopyButton value={observer} label={t("copySession")}/></header>
 <nav className="topNav"><button onClick={()=>setPage("workspace")}>{t("inboxes")}</button><button onClick={()=>setPage("connections")}>{t("tls")}</button><button onClick={()=>setPage("documentation")}>{t("documentation")}</button><button onClick={()=>setPage("api")}>{t("api")}</button></nav>
 {page==="workspace"&&<div className="workspace">
 <aside className={"sidebar"+(collapsed?" closed":"")}>
 {(["email","sms"] as Channel[]).map(c=><section key={c} className="inboxGroup">
 <div className="groupHead">
 <div className="navWithTools">
 <button className="ghost groupToggle" onClick={()=>setGroups(p=>({...p,[c]:!p[c]}))} aria-label={c==="email"?"Inboxes — Email":"Inboxes — SMS"}>{c==="email"?"✉":"▣"} {!collapsed&&(c==="email"?"Inboxes — Email":"Inboxes — SMS")} {!collapsed&&(groups[c]?"⌄":"›")}</button>
 {collapsed&&<div className="hoverTools" role="group"><span>{c==="email"?"Inboxes — Email":"Inboxes — SMS"}</span><button onClick={()=>{setModal(c);setIdentifier("");setMissing(false);setError("")}}>+ Adicionar</button></div>}
 </div>
 {!collapsed&&<button aria-label={"Criar inbox "+c} title={t("addInbox")} onClick={()=>{setModal(c);setIdentifier("");setMissing(false);setError("")}}>+</button>}
 </div>
 {groups[c]&&inboxes.filter(r=>r.channel===c).map(r=><div key={r.id} className="navWithTools"><button className={"navItem"+(selected===r.id&&view!=="logs"?" active":"")} onClick={()=>focus(r.id)} title={collapsed?undefined:r.address} aria-label={r.address}>{!collapsed&&<span className="name">{r.system?"⚠ ":""}{r.address}</span>}{collapsed&&<span>{c==="email"?"✉":"▣"}</span>}{unread(r.id)>0&&<span className="badge">{unread(r.id)}</span>}</button>
 {collapsed&&<div className="hoverTools" role="group"><strong>{r.address}</strong><button onClick={()=>focus(r.id)}>{t("selectInbox")}</button><CopyMenu label={t("copyData")} items={[{label:"Endereço",value:r.address},{label:"UUID da inbox",value:r.id},{label:"Endpoint de mensagens",value:location.origin+"/api"+base(r.channel)+"/"+r.id+"/messages"}]}/><button onClick={()=>{setSelected(r.id);setView("inbox");setCompose(true)}}>{t("sendMessage")}</button></div>}
 </div>)}
 </section>)}
 <div className="spacer"/><button className={"navItem"+(view==="logs"?" active":"")} onClick={()=>setView(v=>v==="logs"?"split":"logs")}>☷ {!collapsed&&"Live Logs"}</button>
 </aside>
 <main className={"main "+(view==="split"?"split":view==="logs"?"logsOnly":"inboxOnly")}>
 {view!=="logs"&&<section className="panel"><div className="panelHead"><div><div className="panelTitle">{active?.address||"Seleciona uma inbox"}</div>{active&&<div className="tiny">{active.system?"Captura de anomalias":"Expira: "+formatDate(active.expiresAt!)}</div>}</div><div className="spacer"/>{active&&<><CopyMenu label={t("copyData")} items={[{label:"Endereço",value:active.address},{label:"UUID da inbox",value:active.id},{label:"Endpoint de mensagens",value:location.origin+"/api"+base(active.channel)+"/"+active.id+"/messages"}]}/><button title={t("removeInbox")} onClick={()=>void removeInbox()}>×</button></>}<button title={t("minimizeInbox")} onClick={()=>setView("logs")}>▾</button></div>
 {active&&compose&&<div className="composeOverlay"><div className="compose"><strong>Enviar para {active.address}</strong><label>{t("sender")}<input value={sender} onChange={e=>setSender(e.target.value)}/></label>{active.channel==="email"&&<label>{t("subject")}<input value={subject} onChange={e=>setSubject(e.target.value)}/></label>}<label>{t("message")}<textarea rows={3} value={body} onChange={e=>setBody(e.target.value)}/></label>{active.channel==="email"&&<label>{t("attachments")}<input type="file" multiple onChange={e=>setOutgoingFiles(Array.from(e.target.files||[]))}/></label>}<div className="actions"><button onClick={()=>setCompose(false)}>{t("cancel")}</button><button onClick={()=>void send()}>{t("send")}</button></div></div></div>}
 <div className="panelBody inboxScroll">{active&&<div className="messages">{(messages[active.id]||[]).slice().reverse().map(m=><button key={m.id} className={"msg"+(!(seen[active.id]||[]).includes(m.id)?" unread":"")} onClick={()=>{setDetail(m);setSeen(p=>({...p,[active.id]:[...new Set([...(p[active.id]||[]),m.id])]}))}}><div className="msgTitle">{m.subject||m.body.slice(0,65)||"(sem conteúdo)"} <span className="tiny">{formatDate(m.receivedAt)}</span></div><div className="tiny">{m.from}{m.captureReason?" · "+m.captureReason:""}</div></button>)}{detail&&detail.destinationId===active.id&&<div className="detail"><div className="actions"><button onClick={()=>void deleteMessage(detail)}>{t("deleteMessage")}</button><button onClick={()=>setDetail(null)}>{t("close")}</button></div><p><b>{t("from")}</b> {detail.from}</p><p><b>{t("to")}</b> {detail.originalRecipient}</p><p><b>{t("subject")}</b> {detail.subject||"—"}</p><div className="copyDetails"><CopyButton value={detail.id} label={t("copyMessageId")}/><CopyButton value={detail.from} label={t("copySender")}/><CopyButton value={detail.originalRecipient} label={t("copyRecipient")}/></div><div>{detail.body}</div>{!!detail.attachments?.length&&<section><h4>{t("attachments")} ({detail.attachments.length})</h4>{detail.attachments.map(a=><p key={a.id}><a href={"/api"+base(active.channel)+"/"+active.id+"/messages/"+detail.id+"/attachments/"+a.id} download={a.filename}>{a.filename}</a> · {a.contentType} · {(a.size/1024).toFixed(1)} KiB</p>)}</section>}</div>}</div>}</div>{active&&!compose&&<button className="fab" aria-label={t("sendMessage")} title={t("sendMessage")} onClick={()=>setCompose(v=>!v)}>{compose?"×":"+"}</button>}</section>}
 {view!=="inbox"&&<section className="panel"><div className="panelHead"><strong>{t("logs")}</strong><div className="spacer"/><button onClick={()=>setView("inbox")} title={t("minimizeLogs")}>▾</button></div><div className="logFilters"><input aria-label={t("filterLogs")} placeholder={t("filterLogs")} value={logFilter} onChange={e=>setLogFilter(e.target.value)}/><button onClick={()=>setLogs([])}>{t("clearView")}</button></div><div className="panelBody">{filteredLogs.slice().reverse().map(e=><div className="logRow" key={e.id}><span>{formatDate(e.at)}</span>{e.type} <span>{e.resourceId?.slice(0,8)||""}</span></div>)}</div></section>}
 </main></div>}
 {page==="connections"&&<main className="information"><h2>{t("connectionTitle")}</h2><p>{t("connectionIntro")}</p><h3>{t("clientConfig")}</h3><table><thead><tr><th>{t("protocol")}</th><th>{t("server")}</th><th>{t("port")}</th><th>{t("security")}</th></tr></thead><tbody><tr><td>HTTPS API</td><td>{connection?.host||"localhost"}</td><td>{connection?.http?.httpsPort||"—"}</td><td>TLS</td></tr><tr><td>SMTP</td><td>{connection?.host||"localhost"}</td><td>{connection?.smtp?.plainPort||2525}</td><td>{connection?.smtp?.starttls?t("starttlsReady"):t("starttlsOff")}</td></tr><tr><td>SMTPS</td><td>{connection?.host||"localhost"}</td><td>{connection?.smtp?.implicitTlsPort||"—"}</td><td>{t("implicitTls")}</td></tr><tr><td>SMS API</td><td>{connection?.host||"localhost"}</td><td>{connection?.http?.httpsPort||connection?.http?.port||3000}</td><td>HTTP(S)</td></tr></tbody></table><h3>{t("networkValues")}</h3><div className="copyDetails"><CopyButton value={connection?.host||"localhost"} label={t("copyHost")}/>{connection?.http?.httpsPort&&<CopyButton value={"https://"+(connection.host||"localhost")+":"+connection.http.httpsPort} label={t("copyHttps")}/>}<CopyButton value={(connection?.host||"localhost")+":"+(connection?.smtp?.plainPort||2525)} label={t("copySmtp")}/>{connection?.smtp?.implicitTlsPort&&<CopyButton value={(connection.host||"localhost")+":"+connection.smtp.implicitTlsPort} label={t("copySmtps")}/>}</div><h3>{t("addresses")}</h3><div className="tlsImport">{Object.entries(networkFields).map(([name,value])=><label key={name}>{name}<div className="copyField"><input value={value} onChange={e=>setNetworkFields(p=>({...p,[name]:e.target.value}))}/><CopyButton value={value} label={t("copyValue")+" "+name}/></div></label>)}<button disabled={!adminToken} onClick={()=>void saveNetwork()}>{t("saveAddresses")}</button>{networkStatus&&<p role="status">{networkStatus}</p>}</div><h3>{t("certInstalled")}</h3>{connection?.certificate?<><p>{t("issuer")} {connection.certificate.issuer}</p><p>{t("validity")} {connection.certificate.validTo}</p><p>{t("fingerprint")} {connection.certificate.fingerprint256} <CopyButton value={connection.certificate.fingerprint256} label={t("copyFingerprint")}/></p><a href={"/api"+connection.certificate.download} download>{t("downloadCert")}</a>{connection.certificate.caDownload&&<p><a href={"/api"+connection.certificate.caDownload} download>{t("downloadCa")}</a></p>}</>:<p>{t("tlsMissing")}</p>}<p className="tiny">{t("privateKeyNotice")}</p>
 <h3>{t("importTls")}</h3>
 <div className="tlsImport"><label>{t("publicPem")}<input type="file" accept=".pem,.crt" onChange={e=>setTlsCertFile(e.target.files?.[0]||null)}/></label>
 <label>{t("privatePem")}<input type="file" accept=".pem,.key" onChange={e=>setTlsKeyFile(e.target.files?.[0]||null)}/></label>
 <label>{t("adminToken")}<input type="password" value={adminToken} onChange={e=>setAdminToken(e.target.value)} autoComplete="off"/></label>
 <button onClick={()=>void importCertificate()} disabled={!tlsCertFile||!tlsKeyFile||!adminToken}>{t("install")}</button>
 {tlsStatus&&<p role="status">{tlsStatus}</p>}</div></main>}
 {page==="documentation"&&<main className="information"><h2>{t("documentation")}</h2><DocumentSearch onNavigate={navigateSearch}/><p className="muted">{t("documentationHelp")}</p><div className="docJourneys">{[["demo",t("try"),t("tryDescription")],["integration",t("mock"),t("mockDescription")],["sdk",t("testing"),t("testingDescription")]].map(([id,title,description])=><button className={"docJourney"+(docPage===id?" active":"")} key={id} onClick={()=>setDocPage(id)}><strong>{title}</strong><small>{description}</small></button>)}</div><div className="docPicker"><span>{t("reference")}</span>{[["overview",t("intro")],["tls",t("tls")],["architecture",t("architecture")],["development",t("development")]].map(([id,title])=><button aria-pressed={docPage===id} key={id} onClick={()=>setDocPage(id)}>{title}</button>)}</div><article className="docMarkdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{a:({href,children})=><a href={href?.startsWith("http")?href:"#"} onClick={e=>{if(!href||href.startsWith("http"))return;e.preventDefault();const pageId=href.replace(/^\.\.\//,"").replace(/^docs\//,"").replace(/\.md(#.*)?$/,"");if(["README","overview"].includes(pageId))setDocPage("overview");else if(["demo","integration","sdk","tls","architecture","development"].includes(pageId))setDocPage(pageId);else if(pageId==="api")setPage("api");else window.open("https://github.com/primeiraacademiadev/virtual-inbox/blob/main/"+href.replace(/^\.\.\//,""),"_blank","noopener,noreferrer")}}>{children}</a>}}>{docText}</ReactMarkdown></article></main>}
 {page==="api"&&<main className="information"><h2>{t("apiTitle")}</h2><DocumentSearch onNavigate={navigateSearch}/><p>{t("apiNote")}</p><article className="docMarkdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{apiText}</ReactMarkdown></article></main>}
 {modal&&<div className="modalBackdrop"><div className="modal"><h2>{t("addInbox")}</h2><label>{t("identifier")}<input autoFocus value={identifier} placeholder={modal==="email"?"teste@sandbox.test":"+351900000001"} onChange={e=>{setIdentifier(e.target.value);setMissing(false);setError("")}}/></label>{identifier.trim()&&<span className={classify(identifier.trim())?"success":"error"}>{classify(identifier.trim())==="email"?"✓ Email":classify(identifier.trim())==="sms"?"✓ SMS":"Identificador inválido"}</span>}<div className="row"><button className="clock" title={t("configureTtl")} onClick={()=>setTtlOpen(v=>!v)}>⏱</button>{ttlOpen&&<label>{t("ttl")}<input type="number" min="1" max="604800" value={ttl} onChange={e=>setTtl(e.target.value)}/></label>}</div>{missing&&<p>{t("missingInbox")}</p>}{error&&<p className="error">{error}</p>}<div className="actions"><button onClick={()=>setModal(null)}>{t("cancel")}</button><button disabled={!!identifier.trim()&&!classify(identifier.trim())} onClick={()=>void (missing||!identifier.trim()?create():addExisting())}>{missing?t("create"):identifier.trim()?t("addInbox"):t("createRandom")}</button></div></div></div>}
 </div>
}
