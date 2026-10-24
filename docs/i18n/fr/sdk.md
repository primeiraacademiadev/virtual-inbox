# Automatiser les assertions

Utiliser des boîtes et marqueurs uniques par test. Éviter les sleeps arbitraires : les lectures et attentes ne consomment pas les messages. Filtrer et nettoyer les ressources propres au test.

## Séquence fiable

1. POST `/api/mailboxes` avec `{"ttlSeconds":180}` ; conserver `id`/`address`.
2. Commencer POST `/api/mailboxes/{id}/wait-for-message` avec `{"timeoutMs":10000,"match":{"subjectContains":"marqueur-unique"}}`.
3. Déclencher l’opération réelle de l’application, pas l’émetteur de démonstration lorsque l’on teste cette application.
4. Vérifier HTTP `200`, expéditeur, contenu et octets des pièces jointes. `204` n’a pas de corps JSON : délai sans résultat ou suppression de boîte.
5. DELETE `/api/mailboxes/{id}` dans `finally`.

`after` est une séquence de message exclusive, pas un id SSE. Tous les filtres `from`, `bodyContains`, `subjectContains` doivent correspondre. Respecter `MAX_WAIT_TIMEOUT_MS`. `404` signifie une boîte déjà absente/expirée, pas un résultat vide réussi.

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
