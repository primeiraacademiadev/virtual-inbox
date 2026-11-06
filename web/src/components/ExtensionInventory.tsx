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

const labels = {
  "pt-PT": {
    heading: "Extensões", description: "Extensões HTTP publicadas pelo Virtual Inbox. Inventário apenas de leitura.",
    refresh: "Atualizar extensões", empty: "Não existem extensões registadas.",
    loading: "A carregar extensões…", unavailable: "Não foi possível consultar as extensões.",
    active: "Ativa", failed: "Falhou", disabled: "Desativada",
    capabilities: "Capacidades", endpoints: "Endpoints publicados", requests: "Pedidos",
    errors: "Erros", duration: "Duração acumulada", lastStatus: "Último estado HTTP",
    method: "Método", audience: "Âmbito", path: "Caminho lógico", publicPath: "Acessos públicos",
    noRoutes: "Esta extensão não tem endpoints ativos.",
    diagnostic: "Diagnóstico", documentation: "Documentação", openGuide: "Abrir guia",
    logs: "Ver logs desta extensão", version: "Versão",
    refreshing: "Atualização automática a cada 15 segundos.",
  },
  en: {
    heading: "Extensions", description: "HTTP extensions published by Virtual Inbox. Read-only inventory.",
    refresh: "Refresh extensions", empty: "No extensions are registered.",
    loading: "Loading extensions…", unavailable: "Unable to load extensions.",
    active: "Active", failed: "Failed", disabled: "Disabled",
    capabilities: "Capabilities", endpoints: "Published endpoints", requests: "Requests",
    errors: "Errors", duration: "Total duration", lastStatus: "Last HTTP status",
    method: "Method", audience: "Audience", path: "Logical path", publicPath: "Public paths",
    noRoutes: "This extension has no active endpoints.",
    diagnostic: "Diagnostic", documentation: "Documentation", openGuide: "Open guide",
    logs: "View this extension's logs", version: "Version",
    refreshing: "Automatically refreshes every 15 seconds.",
  },
  fr: {
    heading: "Extensions", description: "Extensions HTTP publiées par Virtual Inbox. Inventaire en lecture seule.",
    refresh: "Actualiser les extensions", empty: "Aucune extension enregistrée.",
    loading: "Chargement des extensions…", unavailable: "Impossible de consulter les extensions.",
    active: "Active", failed: "Échec", disabled: "Désactivée",
    capabilities: "Fonctionnalités", endpoints: "Points d'accès publiés", requests: "Requêtes",
    errors: "Erreurs", duration: "Durée cumulée", lastStatus: "Dernier statut HTTP",
    method: "Méthode", audience: "Audience", path: "Chemin logique", publicPath: "Chemins publics",
    noRoutes: "Cette extension n'a aucun point d'accès actif.",
    diagnostic: "Diagnostic", documentation: "Documentation", openGuide: "Ouvrir le guide",
    logs: "Afficher les logs de cette extension", version: "Version",
    refreshing: "Actualisation automatique toutes les 15 secondes.",
  },
} as const;

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
  const t = labels[locale];
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
  const t = labels[locale];
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
