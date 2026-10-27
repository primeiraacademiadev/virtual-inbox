import React, { useCallback, useEffect, useState } from "react";
import { request } from "../api";

type Snapshot = {
  runId: string; uptimeSeconds: number; capturedAt: string;
  memory: Record<"rss"|"heapUsed"|"heapTotal"|"external"|"arrayBuffers", number>;
  resources: Record<string, number>;
  protocols: Record<"SMTP"|"POP3", { active: number; retained: number; limit: number; retentionSeconds: number }>;
  cleanup: { lastAt: string | null };
};
const mib = (n: number) => (n / (1024 * 1024)).toFixed(1) + " MiB";
export function FootprintView({ adminToken }: { adminToken: string }) {
  const [value, setValue] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    if (!adminToken || window.location.protocol !== "https:") return;
    try { setValue(await request<Snapshot>("/admin/footprint", {
      headers: { Authorization: "Bearer " + adminToken },
    })); setError(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to read footprint"); }
  }, [adminToken]);
  useEffect(() => {
    void reload();
    const interval = setInterval(() => { void reload(); }, 5000);
    return () => clearInterval(interval);
  }, [reload]);
  const pairs: Array<[string, number, number | undefined]> = value ? [
    ["Email inboxes", value.resources.emailInboxes, value.resources.inboxLimit],
    ["SMS inboxes", value.resources.smsInboxes, value.resources.inboxLimit],
    ["Messages", value.resources.messages, value.resources.messageLimit],
    ["Attachments", value.resources.attachments, undefined],
    ["Stored payload", value.resources.storedBytes, value.resources.storedBytesLimit],
    ["Observers", value.resources.observers, value.resources.observerLimit],
    ["Events", value.resources.events, value.resources.eventLimit],
    ["Logical GUID sessions", value.resources.logicalSessions, undefined],
    ["Simulation rules", value.resources.simulationRules, undefined],
  ] : [];
  return <main className="information">
    <h2>Application Footprint</h2>
    <p className="muted">Read-only observability. Process memory is not the same as retained message payload bytes.</p>
    <p>Requires HTTPS and ADMIN_TOKEN. Refreshes every five seconds.</p>
    <button type="button" disabled={!adminToken} onClick={() => void reload()}>Refresh footprint</button>
    {error && <p role="alert">{error}</p>}
    {!value && !error && <p className="muted">Enter the administrator token in the SMTP page.</p>}
    {value && <>
      <p className="tiny">Run {value.runId} · Uptime {value.uptimeSeconds}s · Snapshot {value.capturedAt}</p>
      <h3>Node.js memory</h3>
      <div className="footprintCards">{Object.entries(value.memory).map(([key, bytes]) =>
        <div className="detail" key={key}><strong>{key}</strong><div>{mib(bytes)}</div></div>)}</div>
      <h3>Retained resources</h3>
      <table><thead><tr><th>Resource</th><th>Count / bytes</th><th>Limit</th></tr></thead><tbody>
        {pairs.map(([label, count, limit]) => <tr key={label}>
          <td>{label}</td><td>{label === "Stored payload" ? mib(count) : count.toLocaleString()}</td>
          <td>{limit === undefined ? "—" : label === "Stored payload" ? mib(limit) : limit.toLocaleString()}</td>
        </tr>)}
      </tbody></table>
      <h3>Connection retention</h3>
      <table><thead><tr><th>Protocol</th><th>Active</th><th>Retained</th><th>Maximum</th><th>Closed retention</th></tr></thead>
        <tbody>{(["SMTP", "POP3"] as const).map(protocol => <tr key={protocol}>
          <td>{protocol}</td><td>{value.protocols[protocol].active}</td>
          <td>{value.protocols[protocol].retained}</td><td>{value.protocols[protocol].limit}</td>
          <td>{value.protocols[protocol].retentionSeconds / 60} min</td></tr>)}</tbody></table>
      <p className="tiny">Last cleanup: {value.cleanup.lastAt || "Not yet executed"}</p>
    </>}
  </main>;
}
