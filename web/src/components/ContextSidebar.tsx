import { useState } from "react";

type AreaPage = "workspace" | "connections" | "smtp" | "pop3" | "simulations" | "documentation" | "api";
type Props = {
  page: AreaPage;
  docPage: string;
  onPage: (page: AreaPage) => void;
  onDocument: (doc: string) => void;
};
const docs = [
  { id: "overview", label: "Introduction" },
  { id: "demo", label: "Getting started" },
  { id: "integration", label: "Integration" },
  { id: "sdk", label: "SDK and testing" },
  { id: "tls", label: "TLS" },
  { id: "architecture", label: "Architecture" },
  { id: "development", label: "Development" },
];
/** Each top-level area owns its own context navigation; inbox navigation stays separate. */
export function ContextSidebar({ page, docPage, onPage, onDocument }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const docsArea = page === "documentation" || page === "api";
  const protocolsArea = page === "smtp" || page === "pop3" || page === "simulations";
  const area = docsArea ? "Documentation" : protocolsArea ? "Protocols" : "System";
  const entries: Array<{ key: AreaPage; label: string }> = docsArea
    ? [{ key: "documentation", label: "Guides" }, { key: "api", label: "API reference" }]
    : protocolsArea
      ? [{ key: "smtp", label: "SMTP" }, { key: "pop3", label: "POP3" }, { key: "simulations", label: "Simulated errors" }]
      : [{ key: "connections", label: "Connections and TLS" }];
  return <aside className={"contextSidebar" + (collapsed ? " collapsed" : "")} aria-label={area + " navigation"}>
    <div className="contextSidebarHeader">
      {!collapsed && <strong>{area}</strong>}
      <button type="button" aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        title={collapsed ? "Expand navigation" : "Collapse navigation"} aria-expanded={!collapsed}
        onClick={() => setCollapsed(v => !v)}>{collapsed ? "»" : "«"}</button>
    </div>
    <nav>
      {entries.map(entry => <button key={entry.key} type="button"
        className={entry.key === page ? "active" : ""}
        aria-current={entry.key === page ? "page" : undefined}
        title={collapsed ? entry.label : undefined}
        onClick={() => onPage(entry.key)}>{collapsed ? entry.label.slice(0, 2).toUpperCase() : entry.label}</button>)}
      {docsArea && page === "documentation" && !collapsed && <>
        <hr />
        <span className="contextSectionTitle">Pages</span>
        {docs.map(doc => <button key={doc.id} type="button" className={docPage === doc.id ? "active" : ""}
          onClick={() => onDocument(doc.id)}>{doc.label}</button>)}
      </>}
    </nav>
  </aside>;
}
