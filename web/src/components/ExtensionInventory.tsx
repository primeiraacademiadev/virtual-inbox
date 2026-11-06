import React, { useCallback, useEffect, useState } from "react";
import { request } from "../api";
import { useI18n } from "../i18n/context";
import type { Locale } from "../i18n/catalog";

export type ExtensionRoute = {
  method: string;
  audience: "demo" | "management";
  path: string;
  publicPaths: string[];
};
export type ExtensionRecord = {
  id: string;
  displayName: string;
  version: string;
  state: "active" | "failed" | "disabled";
  capabilities: string[];
  documentation?: string;
  routes: ExtensionRoute[];
  metrics: { count: number; errors: number; totalDurationMs: number; lastStatus?: number };
  diagnosticCode?: string;
};

// Pair each translation with one shared set of keys. This avoids three copies
// of the same dictionary shape and keeps locale parity mechanically checked.
const labelKeys = [
  "heading", "description", "refresh", "empty", "loading", "unavailable",
  "active", "failed", "disabled", "capabilities", "endpoints", "requests",
  "errors", "duration", "lastStatus", "method", "audience", "path",
  "publicPath", "noRoutes", "diagnostic", "documentation", "openGuide",
  "logs", "version", "refreshing",
] as const;
type LabelKey = typeof labelKeys[number];
const translations: Record<Locale, readonly string[]> = {
  "pt-PT": [
    "Extensões", "Extensões HTTP publicadas pelo Virtual Inbox. Inventário apenas de leitura.", "Atualizar extensões", "Não existem extensões registadas.", "A carregar extensões…", "Não foi possível consultar as extensões.",
    "Ativa", "Falhou", "Desativada", "Capacidades", "Endpoints publicados", "Pedidos", "Erros", "Duração acumulada", "Último estado HTTP", "Método", "Âmbito", "Caminho lógico",
    "Acessos públicos", "Esta extensão não tem endpoints ativos.", "Diagnóstico", "Documentação", "Abrir guia", "Ver logs desta extensão", "Versão", "Atualização automática a cada 15 segundos.",
  ],
  en: [
    "Extensions", "HTTP extensions published by Virtual Inbox. Read-only inventory.", "Refresh extensions", "No extensions are registered.", "Loading extensions…", "Unable to load extensions.",
    "Active", "Failed", "Disabled", "Capabilities", "Published endpoints", "Requests", "Errors", "Total duration", "Last HTTP status", "Method", "Audience", "Logical path",
    "Public paths", "This extension has no active endpoints.", "Diagnostic", "Documentation", "Open guide", "View this extension's logs", "Version", "Automatically refreshes every 15 seconds.",
  ],
  fr: [
    "Extensions", "Extensions HTTP publiées par Virtual Inbox. Inventaire en lecture seule.", "Actualiser les extensions", "Aucune extension enregistrée.", "Chargement des extensions…", "Impossible de consulter les extensions.",
    "Active", "Échec", "Désactivée", "Fonctionnalités", "Points d'accès publiés", "Requêtes", "Erreurs", "Durée cumulée", "Dernier statut HTTP", "Méthode", "Audience", "Chemin logique",
    "Chemins publics", "Cette extension n'a aucun point d'accès actif.", "Diagnostic", "Documentation", "Ouvrir le guide", "Afficher les logs de cette extension", "Version", "Actualisation automatique toutes les 15 secondes.",
  ],
};
export function extensionLabels(locale: Locale): Record<LabelKey, string> {
  const values = translations[locale];
  return Object.fromEntries(labelKeys.map((key, index) => [key, values[index]])) as Record<LabelKey, string>;
}

const supportedDocs = new Set(["architecture", "integration", "sdk", "extensions"]);
/** Only documentation already published by the console is navigable. */
export function extensionDocumentId(documentation: string | undefined): string | null {
  if (!documentation || !/^\/[a-zA-Z0-9/_#.-]{1,250}$/.test(documentation)) return null;
  const doc = documentation.match(/^\/wiki\/(?:pt-PT|en|fr)\/([a-z-]+)\.md$/)?.[1];
  if (doc && supportedDocs.has(doc)) return doc;
  // The bundled native sender's source documentation is presented by our
  // published extensions guide; never link to a non-existent /docs/ URL.
  if (documentation === "/docs/embedded-extension-host") return "extensions";
  return null;
}

export function ExtensionInventorySummary({ entries, locale, onLogs, onDocumentation }: {
  entries: readonly ExtensionRecord[];
  locale: Locale;
  onLogs: (extensionId: string) => void;
  onDocumentation: (documentId: string) => void;
}) {
  const t = extensionLabels(locale);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  return <div className="extensionInventory">
    {entries.length === 0 && <p className="muted">{t.empty}</p>}
    {entries.map(extension => {
      const guide = extensionDocumentId(extension.documentation);
      return <section key={extension.id} className="extensionCard" aria-labelledby={"extension-" + extension.id}>
        <div className="extensionCardHead">
          <div>
            <h3 id={"extension-" + extension.id}>{extension.displayName}</h3>
            <div className="tiny"><code>{extension.id}</code> · {t.version}: {extension.version || "—"}</div>
          </div>
          <span className={"extensionState extensionState-" + extension.state}>
            {t[extension.state]}
          </span>
        </div>
        {extension.capabilities.length > 0 && <p className="extensionCapabilities">
          <strong>{t.capabilities}: </strong>{extension.capabilities.join(", ")}
        </p>}
        {extension.diagnosticCode && <p className="tiny" role="status">
          {t.diagnostic}: <code>{extension.diagnosticCode}</code>
        </p>}
        <dl className="extensionMetrics">
          <div><dt>{t.requests}</dt><dd>{number(extension.metrics.count)}</dd></div>
          <div><dt>{t.errors}</dt><dd>{number(extension.metrics.errors)}</dd></div>
          <div><dt>{t.duration}</dt><dd>{number(extension.metrics.totalDurationMs)} ms</dd></div>
          <div><dt>{t.lastStatus}</dt><dd>{extension.metrics.lastStatus ?? "—"}</dd></div>
        </dl>
        <h4>{t.endpoints}</h4>
        {extension.routes.length === 0 ? <p className="muted">{t.noRoutes}</p> :
          <div className="extensionRoutesScroll">
            <table className="extensionRoutes">
              <thead><tr>
                <th scope="col">{t.method}</th>
                <th scope="col">{t.audience}</th>
                <th scope="col">{t.path}</th>
                <th scope="col">{t.publicPath}</th>
              </tr></thead>
              <tbody>{extension.routes.map((route, index) =>
                <tr key={route.audience + route.method + route.path + index}>
                  <td><code>{route.method}</code></td><td>{route.audience}</td>
                  <td><code>{route.path}</code></td>
                  <td>{route.publicPaths.map(path => <code key={path} className="extensionPublicPath">{path}</code>)}</td>
                </tr>)}</tbody>
            </table>
          </div>}
        <div className="extensionActions">
          <button type="button" onClick={() => onLogs(extension.id)}>{t.logs}</button>
          {guide && <button type="button" onClick={() => onDocumentation(guide)}>{t.openGuide}</button>}
          {extension.documentation && !guide && <span className="tiny">
            {t.documentation}: <code>{extension.documentation}</code>
          </span>}
        </div>
      </section>;
    })}
  </div>;
}

export function ExtensionInventory({ onLogs, onDocumentation }: {
  onLogs: (extensionId: string) => void;
  onDocumentation: (documentId: string) => void;
}) {
  const { locale } = useI18n();
  const t = extensionLabels(locale);
  const [entries, setEntries] = useState<ExtensionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      const results = await request<ExtensionRecord[]>("/extensions", { signal });
      if (signal?.aborted) return;
      setEntries(results);
      setError("");
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : t.unavailable);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [t.unavailable]);
  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    const timer = setInterval(() => void reload(controller.signal), 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [reload]);

  return <main className="information">
    <div className="extensionPageHead">
      <div><h2>{t.heading}</h2><p className="muted">{t.description}</p></div>
      <button type="button" onClick={() => void reload()}>{t.refresh}</button>
    </div>
    <p className="tiny">{t.refreshing}</p>
    {loading && <p role="status">{t.loading}</p>}
    {error && <p role="alert">{t.unavailable} {error}</p>}
    {!loading && <ExtensionInventorySummary entries={entries} locale={locale}
      onLogs={onLogs} onDocumentation={onDocumentation} />}
  </main>;
}
