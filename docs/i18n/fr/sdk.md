# Automatiser les assertions

Utiliser des boîtes et marqueurs uniques par test. Éviter les sleeps arbitraires : les lectures et attentes ne consomment pas les messages. Filtrer et nettoyer les ressources propres au test.

## Séquence fiable

1. POST `/api/mailboxes` avec `{"ttlSeconds":180}` ; conserver `id`/`address`.
2. Commencer POST `/api/mailboxes/{id}/wait-for-message` avec `{"timeoutMs":10000,"match":{"subjectContains":"marqueur-unique"}}`.
3. Déclencher l’opération réelle de l’application, pas l’émetteur de démonstration lorsque l’on teste cette application.
4. Vérifier HTTP `200`, expéditeur, contenu et octets des pièces jointes. `204` n’a pas de corps JSON : délai sans résultat ou suppression de boîte.
5. DELETE `/api/mailboxes/{id}` dans `finally`.

`after` est une séquence de message exclusive, pas un id SSE. Tous les filtres `from`, `bodyContains`, `htmlContains`, `subjectContains` et `header` doivent correspondre. Respecter `MAX_WAIT_TIMEOUT_MS`. `404` signifie une boîte déjà absente/expirée, pas un résultat vide réussi.

Exemples exécutables : `examples/smtp-roundtrip.mjs` et `examples/sms-roundtrip.mjs`. Le SDK source optionnel est `sdk/client.ts` ; le contrat HTTP généré définit les payloads.

## Observateurs et SSE

GET `/api/observers/events` ouvre le flux ; `session.initialized` annonce `observerId` et les boîtes observées. POST `/api/observers/{observerId}/inboxes` avec `{"inboxId":"UUID"}` s’abonne et retourne les messages existants. Reconnecter via `/api/observers/{observerId}/events` ; `session.restored` annonce la projection serveur. Réenregistrer les abonnements manquants.

Conserver le dernier id de `log` et l’envoyer dans `Last-Event-ID` ou `after`. `log.gap` exige une réconciliation REST ; `log.reset` indique un autre processus. Les notifications contiennent des identifiants, pas les octets des pièces jointes. Sessions et boîtes expirent indépendamment. Les flux incluent aussi des journaux globaux : les abonnements ne sont pas une frontière d’autorisation.

## Tester Virtual Inbox

```sh
npm ci --prefix testing --ignore-scripts
node testing/node_modules/@playwright/test/cli.js install chromium
npm run build
npm test
npm run test:all
```

Le harness géré lance une instance isolée temporaire. Ne pas exécuter rotation TLS ou saturation sur une installation partagée. Les rapports sous `testing/reports/` sont des artefacts. Le smoke test Docker vérifie réellement HTTP/SMTP mais n’est pas toute la suite navigateur contre le conteneur.

## Métadonnées MIME et filtres

Le SDK TypeScript `sdk/client.ts` renvoie les `headers` MIME originaux (ordonnés, valeurs non décodées), l'`envelope` (y compris les destinataires Bcc présents seulement dans l'enveloppe), `html`, `authUser`, `smtpSessionId` et `decodedFrom` (`name` et `address`). Le nom de `decodedFrom` est décodé selon RFC 2047 sans modifier l'en-tête `From` d'origine.

Exemple : `wait(inbox, { header: { name: "X-Message-ID", valueContains: marker }, htmlContains: "code" })`. `bodyContains` recherche dans le texte et le HTML ; `htmlContains` uniquement dans le HTML. Les filtres sont combinés par ET ; HTTP `204` devient `null`. `after` est une séquence de message, pas un identifiant SSE.

La lecture des sessions et tentatives SMTP est ouverte sans token, en HTTP ou HTTPS, selon ADR-0001. Les ecritures administratives et la verification des identifiants exigent HTTPS et `ADMIN_TOKEN`. Ne pas journaliser les mots de passe ni les tokens. STARTTLS actualise la session existante avec `secure: true`.

## SDK autonome et erreurs typées

Le paquet ESM `@virtual-inbox/client` (version npm publiee 0.2.1; version source 0.3.0 avec AUTH/resolve non encore publiee) peut être créé avec `npm run build --prefix sdk` et `cd sdk && npm pack --dry-run`, puis installé dans un autre dépôt sans récupérer le code du serveur. Le SDK est publie sur npm; les prochaines versions suivront le workflow de publication. `VirtualInboxError` conserve `status`, `errorCode`, `errorParams` et `cause`. `waitOrThrow()` indique l'absence d'observation pendant le délai, sans la confondre avec un rejet SMTP. Le diagnostic ne contient que les métadonnées de cinq messages récents de la boîte demandée, jamais les journaux globaux ou les anomalies d'autres tests. `wait()` continue à retourner `null` pour HTTP 204. Les ecritures administratives et les simulations SMTP exigent `adminUrl` HTTPS et `adminToken` explicites. Ne jamais enregistrer le token dans les journaux de tests.

## Assertions negatives et suivi SMTP (#39)

`messages(inbox, after)` utilise un curseur de sequence exclusif. `expectNoMessage(inbox, {after, forMs, match?})` attend pendant la fenetre: un message correspondant provoque une erreur `UNEXPECTED_MESSAGE`; aucune observation termine normalement, **sans prouver un rejet SMTP**. Sans jeton administratif, `smtpAttempts({smtpSessionId, sender, recipient, messageId, ruleId})` retrouve les tentatives filtrees; au moins un filtre est obligatoire. Les etats `in_progress`, `rejected`, `stored_and_acknowledged` et `stored_without_ack` documentent les phases et la persistance sans exposer les contenus ni les mots de passe. Le stockage est limite a 2000 tentatives, et chaque recherche a 200 lignes. Les evenements SSE filtres seront traites dans le #44.

## Idempotence explicite et capacites (#41)

Par defaut, un doublon explicite renvoie toujours `409`. Avec `ifExists: "return"` dans `POST /api/mailboxes` ou `POST /api/phone-numbers`, le serveur retourne la boite existante (`200`) sans modifier son ID ni son TTL. Une adresse expiree est recreee (`201`) avec un nouvel ID. Le domaine reserve `@virtual.inbox` reste protege. Le SDK prend en charge `create(channel, address, ttlSeconds, "return")`. `GET /api/capabilities` fournit la version, les protocoles, la politique SMTP AUTH et les actions de simulation prises en charge; le SDK expose `client.capabilities()`.

## Rétention et séquence des journaux (incrément #44)

`MAX_LOG_BUFFER_BYTES` fixe à 10485760 octets (10 Mio) par défaut la taille du tampon circulaire; entier positif obligatoire. Les événements trop volumineux ne sont pas conservés, mais sont diffusés en direct. `log_id` est croissant par exécution, tandis que `id=runId:sequence` reste compatible avec SSE. `log.gap` indique `missingFrom` et `missingTo`; `log.reset` signale un redémarrage. La console permet 500, 2000, 5000 ou 10000 entrées par session du navigateur. Le nombre d'événements conservés dépend de leur taille sérialisée. Données synthétiques uniquement. REST et SSE acceptent les filtres exacts `type`, `inboxId`, `messageId`, `smtpSessionId`, `attemptId`, `sender`, `recipient`, `ruleId` (conjonction ET); `recipient` correspond à un élément du tableau. Les événements exclus par filtre ne sont pas des lacunes.

## Simulation AUTH et portées des règles SMTP (v0.3)

Avant la connexion, `resolveSmtp({credentials:{username,password}, origin:{ip}})` résout une ou deux dimensions et renvoie leurs identifiants opaques et l'arbre des connexions **réellement observées**, sans mot de passe. Avec `createSmtpRule`, une règle AUTH limitée à une adresse IP ne spécifie aucune restriction sur les identifiants :

```ts
await sdk.createSmtpRule({phase:"AUTH",action:"reply",code:454,remaining:3,
  priority:1,selectors:{origin:{ip:"10.1.1.53"}}});
```

Les règles **GLOBAL** omettent `selectors` (ou utilisent `{}`) ; les règles **SPECIFIC** contiennent au moins un sélecteur. Tous les sélecteurs présents sont combinés avec **AND** ; une dimension absente ne limite pas, et `"*"` n'est **pas pris en charge**. Les règles SPECIFIC éligibles ont priorité sur GLOBAL ; dans chaque portée, `priority` puis l'ordre d'insertion départagent les règles. Une seule règle est consommée par événement. AUTH admet les réponses 400–599 ; CONNECT/EHLO et inbox/SMS restent hors périmètre. Resolve et modification exigent HTTPS et token administratif ; aucun mot de passe dans les logs. [Spécification complète](https://github.com/primeiraacademiadev/virtual-inbox/blob/main/docs/smtp-rule-scopes.md).
