import { useState } from "react";
import { request } from "../../api";

type Rule = { id: string; sessionId: string; protocol: "SMTP" | "POP3"; command: string; code: number; message: string; remaining: number };
type Props = { adminToken: string; mode: "pop3" | "simulations" };
export function ProtocolTesting({ adminToken, mode }: Props) {
  const [inbox, setInbox] = useState("");
  const [password, setPassword] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [result, setResult] = useState("");
  const [rules, setRules] = useState<Rule[]>([]);
  const [protocol, setProtocol] = useState<"SMTP" | "POP3">(mode === "pop3" ? "POP3" : "SMTP");
  const [command, setCommand] = useState("DATA");
  const [code, setCode] = useState(451);
  const [remaining, setRemaining] = useState(1);
  const headers = { Authorization: "Bearer " + adminToken };
  const endpoint = () => "/admin/test/sessions/" + sessionId + "/simulations";
  async function resolve() {
    try {
      const response = await request<{ sessionId: string }>("/admin/test/sessions", {
        method: "POST", headers, body: JSON.stringify({ username: inbox, password }),
      });
      setSessionId(response.sessionId);
      setResult("Session resolved");
      setRules([]);
    } catch (error) { setResult(error instanceof Error ? error.message : "Unable to resolve session"); }
    finally { setPassword(""); }
  }
  async function verify() {
    try {
      const response = await request<{ matches: boolean }>("/admin/test/sessions/" + sessionId + "/verify", {
        method: "POST", headers, body: JSON.stringify({ username: inbox, password }),
      });
      setResult(response.matches ? "Password matches session" : "Password does not match session");
    } catch (error) { setResult(error instanceof Error ? error.message : "Unable to verify"); }
    finally { setPassword(""); }
  }
  async function loadRules() {
    try { setRules(await request<Rule[]>(endpoint(), { headers })); }
    catch (error) { setResult(error instanceof Error ? error.message : "Unable to load simulations"); }
  }
  async function addRule() {
    try {
      await request<Rule>(endpoint(), { method: "POST", headers,
        body: JSON.stringify({ protocol, command: command.toUpperCase(), code, remaining }) });
      setResult("Simulation configured");
      await loadRules();
    } catch (error) { setResult(error instanceof Error ? error.message : "Unable to configure simulation"); }
  }
  async function removeRule(id: string) {
    try {
      await request<void>(endpoint() + "/" + id, { method: "DELETE", headers });
      await loadRules();
    } catch (error) { setResult(error instanceof Error ? error.message : "Unable to remove simulation"); }
  }
  return <main className="information">
    <h2>{mode === "pop3" ? "POP3 test identities" : "Simulation rules"}</h2>
    <p className="muted">SMTP and POP3 share inbox/password-derived sessions. This technical interface requires HTTPS and ADMIN_TOKEN.</p>
    <div className="detail">
      <h3>Resolve or verify session</h3>
      <label>Inbox / username<input value={inbox} onChange={e => setInbox(e.target.value)} autoComplete="off" /></label>
      <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="off" /></label>
      <div className="actions">
        <button type="button" disabled={!adminToken || !inbox} onClick={() => void resolve()}>Resolve GUID</button>
        <button type="button" disabled={!adminToken || !sessionId} onClick={() => void verify()}>Verify password</button>
      </div>
      <label>Logical session GUID<input value={sessionId} onChange={e => setSessionId(e.target.value)} /></label>
      {result && <p role="status">{result}</p>}
    </div>
    {mode === "pop3" && <div className="detail">
      <h3>POP3 connection</h3>
      <p>Use USER with the inbox address followed by PASS with the test password. The plain POP3 listener defaults to port 2110.</p>
      <p>Available: STAT, LIST, UIDL, RETR, TOP, DELE, RSET, NOOP and QUIT.</p>
    </div>}
    <div className="detail">
      <h3>Simulated protocol errors</h3>
      <div className="row">
        <label>Protocol<select value={protocol} onChange={e => { const p=e.target.value as "SMTP" | "POP3"; setProtocol(p); setCommand(p==="SMTP"?"DATA":"RETR"); }}><option>SMTP</option><option>POP3</option></select></label>
        <label>Command<input value={command} onChange={e => setCommand(e.target.value)} /></label>
        <label>Code<input type="number" min={400} max={599} value={code} onChange={e => setCode(Number(e.target.value))} /></label>
        <label>Executions<input type="number" min={1} value={remaining} onChange={e => setRemaining(Number(e.target.value))} /></label>
      </div>
      <div className="actions">
        <button disabled={!sessionId || !adminToken} onClick={() => void loadRules()}>Refresh rules</button>
        <button disabled={!sessionId || !adminToken} onClick={() => void addRule()}>Add rule</button>
      </div>
      <ul>{rules.map(rule => <li key={rule.id}>
        {rule.protocol} {rule.command}: {rule.code} ({rule.remaining} executions left)
        <button type="button" onClick={() => void removeRule(rule.id)}>Delete</button>
      </li>)}</ul>
    </div>
  </main>;
}
