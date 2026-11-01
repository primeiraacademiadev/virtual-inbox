import { useMemo, useState } from "react";
import type { EventEntry } from "../api.js";
import { LOG_DEPTHS, LOG_FILTER_FIELDS, visibleLogs, gapLabel } from "../logs/log-model.js";
import { eventLabel } from "../i18n/domain.js";

export function LogPanel(props: {
  logs: EventEntry[];
  depth: number;
  onDepth: (value: number) => void;
  field: string;
  onField: (value: string) => void;
  serverFilter: string;
  onServerFilter: (value: string) => void;
  onClear: () => void;
  onMinimize: () => void;
  onOlder: () => void;
  onRecover: (gap: EventEntry) => void;
  hasOlder: boolean;
  loadingOlder: boolean;
  unretrievableGaps: string[];
  loadingGaps: string[];
  locale: string;
  formatDate: (value: string) => string;
  labels: { logs: string; minimize: string; filter: string; clear: string };
}) {
  const [filter, setFilter] = useState("");
  const entries = useMemo(() => visibleLogs(props.logs, filter).slice().reverse(), [props.logs, filter]);
  return <section className="panel">
    <div className="panelHead">
      <strong>{props.labels.logs}</strong>
      <div className="spacer" />
      <button onClick={props.onMinimize} title={props.labels.minimize}>▾</button>
    </div>
    <div className="logFilters">
      <input aria-label={props.labels.filter} placeholder={props.labels.filter} value={filter}
        onChange={event => setFilter(event.target.value)} />
      <label>History <select aria-label="Log history depth" value={props.depth}
        onChange={event => props.onDepth(Number(event.target.value))}>
        {LOG_DEPTHS.map(n => <option key={n} value={n}>{n}</option>)}
      </select></label>
      <label>Server filter <select aria-label="Log filter field" value={props.field}
        onChange={event => props.onField(event.target.value)}>
        {LOG_FILTER_FIELDS.map(field => <option key={field}>{field}</option>)}
      </select></label>
      <input aria-label="Server log filter value" placeholder="Exact match" value={props.serverFilter}
        onChange={event => props.onServerFilter(event.target.value)} />
      <button onClick={props.onClear}>{props.labels.clear}</button>
    </div>
    <div className="panelBody" onScroll={event => {
      if (event.currentTarget.scrollTop < 120) props.onOlder();
    }}>
      {props.hasOlder && <button type="button" disabled={props.loadingOlder} onClick={props.onOlder}>
        {props.loadingOlder ? "Loading…" : "Load older events"}
      </button>}
      {entries.map(entry => <div className="logRow" key={entry.id}>
        <span>{props.formatDate(entry.at)}</span>
        {entry.type === "log.gap" ? <button type="button"
          disabled={props.unretrievableGaps.includes(entry.id) || props.loadingGaps.includes(entry.id)}
          onClick={() => props.onRecover(entry)}>
          {gapLabel(props.locale, props.unretrievableGaps.includes(entry.id),
            entry.data?.missingFrom, entry.data?.missingTo)}
          {props.loadingGaps.includes(entry.id) ? "…" : ""}
        </button> : eventLabel(props.locale, entry.type)}
        <span>{entry.resourceId?.slice(0, 8) || ""}</span>
      </div>)}
    </div>
  </section>;
}
