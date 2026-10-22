# Automatiser les tests

Créez une boîte éphémère, déclenchez un envoi et attendez le message.

## Client TypeScript

Le SDK se trouve dans `sdk/client.ts` et utilise fetch natif. Créez un `VirtualInboxClient`, appelez `withInbox("email", async inbox => { ... })` et `api.wait(inbox, {subjectContains:"OTP"}, 15000)`. Le nettoyage est exécuté dans `finally`.

## Vérifications

L'attente renvoie HTTP 200 avec le message ou HTTP 204 en cas de délai dépassé. Le curseur `after` correspond à la séquence des messages, pas à l'ID SSE.

---

[API de gestion](api.md) · [TLS](tls.md) · [SDK](sdk.md)
