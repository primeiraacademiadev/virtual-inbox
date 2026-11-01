import { useMemo, useState } from "react";
import type { Message } from "../api.js";
import { anomalyGroups, filteredAnomalies } from "../anomalies/anomaly-model.js";
import { captureReasonLabel } from "../i18n/domain.js";
import type { Locale } from "../i18n/catalog.js";

export function AnomalyOverview(props: { messages: readonly Message[]; locale: Locale;
  onSelect: (message: Message) => void }) {
  const [recipient, setRecipient] = useState("");
  const [sender, setSender] = useState("");
  const [reason, setReason] = useState("");
  const filtered = useMemo(() => filteredAnomalies(props.messages, { recipient, sender, reason }),
    [props.messages, recipient, sender, reason]);
  const groups = useMemo(() => anomalyGroups(filtered), [filtered]);
  const labels = props.locale === "pt-PT"
    ? { heading: "Anomalias", recipient: "Destinatário original", sender: "Remetente",
      reason: "Motivo", all: "Todos os motivos", entries: "mensagens", group: "Por destinatário e motivo" }
    : props.locale === "fr"
      ? { heading: "Anomalies", recipient: "Destinataire initial", sender: "Expéditeur",
        reason: "Motif", all: "Tous les motifs", entries: "messages", group: "Par destinataire et motif" }
      : { heading: "Anomalies", recipient: "Original recipient", sender: "Sender",
        reason: "Reason", all: "All reasons", entries: "messages", group: "By recipient and reason" };
  const reasons = [...new Set(props.messages.map(message => message.captureReason).filter((value): value is string => !!value))].sort();
  return <div className="logFilters" aria-label={labels.heading}>
    <strong>{labels.heading}: {filtered.length} {labels.entries}</strong>
    <input aria-label={labels.recipient} placeholder={labels.recipient} value={recipient}
      onChange={event => setRecipient(event.target.value)} />
    <input aria-label={labels.sender} placeholder={labels.sender} value={sender}
      onChange={event => setSender(event.target.value)} />
    <select aria-label={labels.reason} value={reason} onChange={event => setReason(event.target.value)}>
      <option value="">{labels.all}</option>
      {reasons.map(value => <option key={value} value={value}>{captureReasonLabel(props.locale, value)}</option>)}
    </select>
    <span>{labels.group}: {groups.map(group =>
      group.recipient + " · " + captureReasonLabel(props.locale, group.reason) + " (" + group.count + ")"
    ).join(" | ")}</span>
    <div className="messages">{filtered.slice().reverse().map(message =>
      <button className="msg" key={message.id} onClick={() => props.onSelect(message)}>
        <span>{message.originalRecipient} · {message.from} · {captureReasonLabel(props.locale, message.captureReason ?? "")}</span>
        <span className="tiny">{message.receivedAt}</span>
      </button>
    )}</div>
  </div>;
}
