import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenApiDocument, operations } from "../src/http/api-contract.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "src/server.ts"), "utf8");
const handlerIds = source
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.startsWith('case "'))
  .map((line) => {
    const end = line.indexOf('":', 6);
    if (end === -1) throw new Error("Invalid HTTP handler case: " + line);
    const id = line.slice(6, end);
    if (!id || !Array.from(id).every((char) =>
      (char >= "A" && char <= "Z") || (char >= "a" && char <= "z"))) {
      throw new Error("Invalid HTTP handler identifier: " + id);
    }
    return id;
  });
const handlers = new Set(handlerIds);
const declared = new Set(operations.map((operation) => operation.id));
if (declared.size !== operations.length) throw new Error("Duplicate API operation identifiers");
for (const id of declared) {
  if (!handlers.has(id)) throw new Error("API contract has no HTTP handler: " + id);
}
for (const id of handlers) {
  if (!declared.has(id)) throw new Error("HTTP handler has no API contract: " + id);
}

function validateReferences(document) {
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (typeof value.$ref === "string") {
      const name = value.$ref.replace("#/components/schemas/", "");
      if (!document.components.schemas[name]) throw new Error("Unknown schema: " + value.$ref);
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(document);
}
function save(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
for (const audience of ["management", "demo"]) {
  const document = createOpenApiDocument(audience);
  validateReferences(document);
  const filename = audience === "management" ? "openapi.json" : "openapi-demo.json";
  const content = JSON.stringify(document, null, 2) + "\n";
  save(join(root, "docs", filename), content);
  save(join(root, "web/public", filename), content);
}

const labels = {
  "pt-PT": {
    title: "Referência da API", download: "Descarregar OpenAPI JSON", generated: "Referência gerada no build a partir do mesmo catálogo usado pelo servidor. Não editar esta secção.",
    intro: "A API principal usa o prefixo `/api` na mesma origem da consola. Os caminhos sem prefixo continuam disponíveis por compatibilidade. As operações de demonstração têm um contrato separado e não aparecem nesta lista.",
    security: "As leituras e operações de inboxes não exigem login. As escritas administrativas exigem HTTPS e `Authorization: Bearer <ADMIN_TOKEN>`. Um token correto enviado por HTTP é rejeitado.",
    request: "Corpo JSON", response: "Resposta", timeout: "Sem mensagem: `204`, sem corpo.", schema: "Esquemas", errors: "Erros",
    errorText: "Os erros usam `{error,errorCode,errorParams}`. `400`: pedido inválido; `403`: origem/administração; `404`: recurso inexistente ou expirado; `409`: conflito; `413`: tamanho excedido; `421`: Host não autorizado; `507`: quota global atingida; `500`: erro interno. Os limites efetivos vêm do ambiente. Consulte os guias de integração e TLS.",
    sse: "SSE devolve `text/event-stream`. Eventos: `session.initialized`, `session.restored`, `log`, `inbox.notification`, `log.gap`, `log.reset`. Guarde o último id de `log`; envie-o em `Last-Event-ID` ou `after`. As notificações contêm ids, não os bytes da mensagem. Leia a mensagem por REST.",
  },
  en: {
    title: "API reference", download: "Download OpenAPI JSON", generated: "Generated during build from the same catalogue used by the server. Do not edit this section.",
    intro: "The main API uses `/api` on the console origin. Unprefixed paths remain available for compatibility. Demo sender operations have a separate contract and are not listed here.",
    security: "Inbox operations and reads do not require login. Administrative writes require HTTPS and `Authorization: Bearer <ADMIN_TOKEN>`. A valid token over HTTP is rejected.",
    request: "JSON body", response: "Response", timeout: "No matching message: `204`, without a body.", schema: "Schemas", errors: "Errors",
    errorText: "Errors use `{error,errorCode,errorParams}`. `400`: invalid request; `403`: origin/admin access; `404`: absent or expired resource; `409`: conflict; `413`: size limit; `421`: rejected Host; `507`: global quota; `500`: internal failure. Effective limits come from the environment. See the integration and TLS guides.",
    sse: "SSE returns `text/event-stream`. Events: `session.initialized`, `session.restored`, `log`, `inbox.notification`, `log.gap`, `log.reset`. Retain the last log id and send it as `Last-Event-ID` or `after`. Notifications contain identifiers, not message bytes. Read messages using REST.",
  },
  fr: {
    title: "Référence de l’API", download: "Télécharger OpenAPI JSON", generated: "Référence générée pendant le build depuis le catalogue utilisé par le serveur. Ne pas modifier cette section.",
    intro: "L’API principale utilise `/api` sur la même origine que la console. Les chemins sans préfixe restent disponibles par compatibilité. Les opérations de démonstration ont un contrat séparé et ne figurent pas ici.",
    security: "La lecture et les opérations sur les boîtes ne nécessitent pas de connexion. Les écritures administratives exigent HTTPS et `Authorization: Bearer <ADMIN_TOKEN>`. Un jeton valide envoyé par HTTP est refusé.",
    request: "Corps JSON", response: "Réponse", timeout: "Aucun message : `204`, sans corps.", schema: "Schémas", errors: "Erreurs",
    errorText: "Les erreurs utilisent `{error,errorCode,errorParams}`. `400` : requête invalide ; `403` : origine/administration ; `404` : ressource absente ou expirée ; `409` : conflit ; `413` : taille ; `421` : Host refusé ; `507` : quota global ; `500` : erreur interne. Les limites effectives viennent de l’environnement. Voir les guides d’intégration et TLS.",
    sse: "SSE renvoie `text/event-stream`. Événements : `session.initialized`, `session.restored`, `log`, `inbox.notification`, `log.gap`, `log.reset`. Conserver le dernier id log et le transmettre dans `Last-Event-ID` ou `after`. Les notifications contiennent des identifiants, pas les octets du message. Lire les messages par REST.",
  },
};
const descriptions = {
  "pt-PT": {
    health: "Estado do serviço e identificador da execução.", openapi: "Contrato da API principal.", demoOpenapi: "Contrato separado do emissor de demonstração.", generationOptions: "Locales, estratégias e valores de geração efetivos.", connectionInfo: "Portas, endereços e metadados públicos de TLS.", tlsStatus: "Identidade TLS ativa, sem chaves privadas.", tlsCa: "Certificado público da CA local (modo auto).", tlsCertificate: "Certificado público do servidor.", networkSettings: "Guardar configuração de rede; exige reinício dos listeners.", importTls: "Importar certificado PEM e chave; ativação imediata.", tlsNames: "Substituir os nomes SAN geridos pela consola; gerar e aplicar.", logs: "Eventos retidos, cursor e indicação de lacunas.", logEvents: "Abrir stream de logs.", newObserverEvents: "Criar sessão SSE; primeiro evento anuncia o GUID.", observerEvents: "Restabelecer sessão SSE existente.", observerSnapshot: "Consultar subscrições e renovar a sessão.", watchInbox: "Subscrever inbox e receber mensagens existentes.", unwatchInbox: "Remover subscrição sem eliminar a inbox.",
    List: "Listar inboxes ou pesquisar por address.", Create: "Criar inbox com endereço explícito ou gerado.", Get: "Consultar inbox ativa.", Delete: "Eliminar inbox e mensagens; inboxes de sistema são protegidas.", Messages: "Listar mensagens sem as consumir.", Clear: "Eliminar todas as mensagens da inbox.", Message: "Consultar mensagem e metadados dos anexos.", DeleteMessage: "Eliminar uma mensagem.", Attachment: "Descarregar os bytes originais de um anexo.", Wait: "Esperar por mensagem existente ou futura que corresponda aos filtros.",
  },
  fr: {
    health: "État du service et identifiant d’exécution.", openapi: "Contrat de l’API principale.", demoOpenapi: "Contrat séparé de l’émetteur de démonstration.", generationOptions: "Locales, stratégies et valeurs effectives.", connectionInfo: "Ports, adresses et métadonnées TLS publiques.", tlsStatus: "Identité TLS active, sans clé privée.", tlsCa: "Certificat public de l’AC locale (mode auto).", tlsCertificate: "Certificat public du serveur.", networkSettings: "Enregistrer le réseau ; redémarrage des écouteurs nécessaire.", importTls: "Importer certificat PEM et clé ; activation immédiate.", tlsNames: "Remplacer les SAN gérés par la console et les appliquer.", logs: "Événements conservés et curseur de reprise.", logEvents: "Ouvrir le flux des journaux.", newObserverEvents: "Créer une session SSE ; le premier événement annonce le GUID.", observerEvents: "Rétablir une session SSE existante.", observerSnapshot: "Lire les abonnements et renouveler la session.", watchInbox: "S’abonner à une boîte et lire les messages existants.", unwatchInbox: "Retirer un abonnement sans supprimer la boîte.",
    List: "Lister les boîtes ou rechercher par address.", Create: "Créer une boîte avec adresse explicite ou générée.", Get: "Lire une boîte active.", Delete: "Supprimer boîte et messages ; les boîtes système sont protégées.", Messages: "Lire les messages sans les consommer.", Clear: "Supprimer tous les messages de la boîte.", Message: "Lire un message et les métadonnées des pièces jointes.", DeleteMessage: "Supprimer un message.", Attachment: "Télécharger les octets originaux d’une pièce jointe.", Wait: "Attendre un message existant ou futur correspondant aux filtres.",
  },
};
for (const [locale, text] of Object.entries(labels)) {
  const lines = [`# ${text.title}`, "", text.generated, "", text.intro, "", text.security, "",
    `[${text.download}](/api/openapi.json)`, "", "## SSE", "", text.sse, ""];
  for (const operation of operations.filter((item) => item.audience === "management")) {
    const suffix = operation.id.replace(/^(email|sms)/, "");
    const summary = descriptions[locale]?.[operation.id] ?? descriptions[locale]?.[suffix] ?? operation.summary;
    lines.push(`## ${operation.method} ${operation.path}`, "", summary, "");
    if (operation.query) lines.push(`Query: \`${operation.query}\` (string).`, "");
    if (operation.request) lines.push(`${text.request}: \`${operation.request}\`.`, "");
    lines.push(`${text.response}: \`${operation.status}\`${operation.response ? ` — \`${operation.response}\`` : ""}.`, "");
    if (operation.noContent) lines.push(text.timeout, "");
  }
  lines.push(`## ${text.errors}`, "", text.errorText, "", `## ${text.schema}`, "",
    "```json", JSON.stringify(createOpenApiDocument().components.schemas, null, 2), "```", "");
  save(join(root, "web/public/wiki", locale, "api.md"), lines.join("\n"));
}
console.log(`OpenAPI: ${operations.length} operations; management and demo contracts generated.`);
