# Extensions

La console Virtual Inbox découvre les extensions grâce au **registre public en lecture seule** situé à `GET /api/extensions`.

Ouvre **Système → Extensions** pour consulter les modules actifs, défaillants ou désactivés. Chaque entrée présente les capacités, les points d'accès HTTP, le nombre de requêtes et d'erreurs, la durée cumulée et le dernier statut HTTP. Le registre est actualisé toutes les 15 secondes ou manuellement. Les compteurs sont conservés uniquement en mémoire et réinitialisés au redémarrage.

L'action **Afficher les logs de cette extension** ouvre le journal avec le filtre serveur `extensionId`. Les anomalies sont désactivées dans le filtre pour isoler les événements de l'extension. Les entrées contiennent le chemin logique, le statut, la durée et l'identifiant de corrélation, sans corps de requête ni identifiants sensibles.

L'extension intégrée `sms-native` est activée par défaut. Elle fournit `POST /demo/sms/messages` sur le listener principal et `POST /sms/messages` sur le listener de démonstration. Elle appelle l'API fonctionnelle publique `POST /api/sms/ingestions`. Pour désactiver l'émetteur uniquement, configure `VI_SMS_NATIVE_ENABLED=false` et redémarre.

Des modules ESM locaux de confiance peuvent être configurés via `VI_EXTENSIONS`. Un module en erreur apparaît sous le nom `failed-N`, avec un diagnostic limité. La console ne permet pas d'installer des modules, de charger des interfaces tierces ou de modifier le serveur.

Consulte les guides [d'intégration](integration.md), du [SDK](sdk.md) et de [l'architecture](architecture.md). Un module peut fournir un chemin de documentation locale ; la console n'ouvre que les documents disponibles pour éviter les liens inexistants.


## Développer une extension HTTP (V1)

Le SDK d'extensions (`extension-sdk/src/index.ts`) crée les handlers HTTP et les middlewares ; le client **fonctionnel** `sdk/client.ts` utilise la même API publique VI que les clients externes. Ce sont deux responsabilités distinctes. Le runtime charge des modules **ESM de confiance** dans le processus Node de VI : ce n'est ni Express, ni un bac à sable, ni un service avec un nouveau port.

Compile le dépôt avant d'activer l'exemple exécutable :

```sh
npm ci
npm run build:server
VI_EXTENSIONS='["./examples/extensions/ping.mjs"]' npm start
```

L'exemple enregistre `GET /extensions/ping` pour `management` et `GET /ping` pour `demo`. Le listener principal expose `GET /api/extensions/ping?name=test` et `GET /demo/ping` ; le listener de démonstration expose `GET /ping`. Les chemins arbitraires à la racine, par exemple `/WebAPI`, **ne sont pas encore pris en charge** sur le listener principal.

Exemple minimal (module ESM compilé, avec SDK local compatible) :

```js
const app = createApp();
app.use(async (ctx, next) => {
  await next();
  ctx.response.headers["x-test"] = "ok";
});
app.post("/provider/send", async ctx => {
  ctx.response.status = 202;
  ctx.response.body = { accepted: true };
});
export default { id: "provider-test", version: "1.0.0", app };
```

Importe `createApp` à partir du SDK compilé comme dans `examples/extensions/ping.mjs` ; le paquet est **privé et non publié**. L'audience par défaut est `demo`; `{ audience: "management" }` publie sous `/api`. Les middlewares peuvent interrompre la chaîne ou modifier la réponse après `await next()`. L'ensemble des routes est validé atomiquement.

Pour capturer un SMS, utilise `VirtualInboxClient.ingestSms({from,to,body})` ou `POST /api/sms/ingestions`, **pas** le point d'accès fournisseur `/demo/sms/messages` ni les méthodes privées du core. Une erreur simulée du fournisseur **après la capture** n'annule pas le message ; les tests de relance doivent en tenir compte. `X-VI-Correlation-ID` est facultatif sur l'ingestion publique, renvoyé dans la réponse, mais pas encore persisté.

Le [guide complet](https://github.com/primeiraacademiadev/virtual-inbox/blob/main/docs/extension-author-guide.md), l'[ADR-0002](https://github.com/primeiraacademiadev/virtual-inbox/blob/main/docs/adr/0002-http-extensions.md) et le [contrat de routage](https://github.com/primeiraacademiadev/virtual-inbox/blob/main/docs/extension-routing-contract.md) expliquent manifeste, installation, cycle de vie, TLS, limites, erreurs, observabilité et OpenAPI. Le registre est en lecture seule ; IPC, hot reload, interface fournisseur spécifique et publication automatique d'OpenAPI externes sont hors du runtime actuel.
