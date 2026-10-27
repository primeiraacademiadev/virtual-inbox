import React, { useMemo, useState } from "react";

export type ConnectionRow = {
  id: string; remoteAddress: string; connectedAt: string; lastActivityAt: string;
  disconnectedAt?: string; connected: boolean; authenticated: boolean;
  inbox?: string; authUser?: string; testSessionId?: string;
};
type Props = { protocol: "SMTP" | "POP3"; records: ConnectionRow[];
  selectedId?: string; onSelect?: (id: string) => void };
export function filteredConnections(
  records: ConnectionRow[], inbox: string, status: string,
  sort: string, descending: boolean,
) {
  const needle = inbox.trim().toLowerCase();
  return records.filter(item => (!needle ||
    (item.inbox || item.authUser || "").toLowerCase().includes(needle)) &&
    (status === "all" || (status === "connected") === item.connected))
    .sort((a, b) => {
      const key = (item: ConnectionRow) => sort === "inbox" ? (item.inbox || item.authUser || "").toLowerCase() :
        sort === "protocol" ? "" : item.lastActivityAt;
      return (descending ? -1 : 1) * (key(a).localeCompare(key(b)) ||
        a.id.localeCompare(b.id));
    });
}
export function ProtocolConnections({ protocol, records, selectedId, onSelect }: Props) {
  const [inbox, setInbox] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("activity");
  const [descending, setDescending] = useState(true);
  const visible = useMemo(() => filteredConnections(records, inbox, status, sort, descending),
    [records, inbox, status, sort, descending]);
  return <section className="detail protocolConnections">
    <h3>{protocol} connections ({visible.length}/{records.length})</h3>
    <div className="connectionFilters">
      <label>Inbox<input aria-label={protocol + " inbox filter"} value={inbox}
        placeholder="Search inbox" onChange={event => setInbox(event.target.value)} /></label>
      <label>Protocol<select aria-label="Protocol" value={protocol} disabled>
        <option value={protocol}>{protocol}</option></select></label>
      <label>Status<select aria-label={protocol + " status filter"} value={status}
        onChange={event => setStatus(event.target.value)}>
        <option value="all">All</option><option value="connected">Connected</option>
        <option value="disconnected">Disconnected</option></select></label>
      <label>Sort by<select aria-label={protocol + " sort"} value={sort}
        onChange={event => setSort(event.target.value)}>
        <option value="activity">Last activity</option><option value="inbox">Inbox</option>
        <option value="protocol">Protocol</option></select></label>
      <button type="button" aria-label="Reverse sort" onClick={() => setDescending(v => !v)}>
        {descending ? "↓" : "↑"}</button>
    </div>
    <div className="connectionTableWrap"><table className="connectionTable">
      <thead><tr><th>Inbox / user</th><th>Protocol</th><th>Status</th>
        <th>Last activity</th><th>Remote</th></tr></thead>
      <tbody>{visible.map(item => <tr key={item.id}>
        <td><button className="connectionLink" type="button"
          aria-current={selectedId === item.id ? "true" : undefined}
          onClick={() => onSelect?.(item.id)} title={item.id}>
          {item.inbox || item.authUser || "Anonymous"}</button></td>
        <td>{protocol}</td><td>{item.connected ? "Connected" : "Disconnected"}</td>
        <td>{new Date(item.lastActivityAt).toLocaleString()}</td>
        <td>{item.remoteAddress}</td>
      </tr>)}</tbody>
    </table></div>
    {visible.length === 0 && <p className="muted">No connections match these filters.</p>}
    <p className="tiny">Closed connections are retained for up to one hour. Histories are isolated by protocol.</p>
  </section>;
}
