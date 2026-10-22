# Automatiser les tests avec le SDK TypeScript

Le client se trouve dans `sdk/client.ts` et utilise le `fetch` natif de Node.js 24+. Il n'est pas encore publié comme package npm.

## Exemple de vérification d'e-mail

```ts
import {VirtualInboxClient} from "../sdk/client.js";
const api = new VirtualInboxClient("http://127.0.0.1:3000");
await api.withInbox("email", async inbox => {
  // Configurez l'application testée pour écrire à inbox.address.
  // Déclenchez l'action qui provoque l'envoi SMTP.
  const message = await api.wait(inbox,{subjectContains:"OTP"},15000);
  if(!message)throw Error("OTP non reçu");
  if(!message.body.includes("123456"))throw Error("Code incorrect");
});
```

`withInbox` supprime toujours la boîte temporaire dans `finally`, même si une assertion échoue. L'attente ne consomme jamais un message.

## Vérification des SMS

Utilisez `withInbox("sms",...)`, configurez l'application testée pour envoyer des SMS via `http://127.0.0.1:3001/sms/messages`, déclenchez l'envoi, puis appelez `wait`.

## Curseurs, délais et isolation

`after` représente une séquence numérique de messages, pas un ID d'événement SSE. `wait` renvoie un message ou `null` en cas de réponse HTTP 204. Préférez des destinataires aléatoires ou uniques pour éviter toute interférence. L'état disparaît au redémarrage.

## Pièces jointes

Les réponses JSON contiennent les métadonnées. Utilisez `api.download(inbox,message.id,attachment.id)` pour obtenir les octets et vérifier des empreintes ou le contenu. Validez les limites SMTP et les quotas pendant les tests d'acceptation.

[Intégration](integration.md) · [API](api.md)
