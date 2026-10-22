# Intégrer Virtual Inbox comme simulateur de communications

Virtual Inbox remplace les services de communication réels pendant le développement, les démonstrations et les tests automatisés. Ce n'est ni un relais SMTP public ni un opérateur SMS.

## 1. Configurer l'accès au serveur

Par défaut, le serveur écoute sur `127.0.0.1`. Depuis un autre conteneur ou une autre machine, **localhost désigne cette machine**, pas Virtual Inbox. Configurez `HOST`, `SMTP_HOST` et `PUBLIC_HOST` avec des règles réseau restrictives. Le nom utilisé doit figurer dans les SAN du certificat.

## 2. Brancher SMTP

| Transport | Port | Configuration du client |
| --- | --- | --- |
| SMTP | 2525 | Sans chiffrement uniquement sur un réseau de confiance |
| SMTP + STARTTLS | 2525 | Passage à TLS après EHLO |
| SMTPS | 2465 | TLS implicite |

Créez une boîte via l'API de gestion et utilisez son champ `address` comme destinataire. Pour les certificats générés localement, approuvez **uniquement le certificat public de l'autorité**, disponible sur `GET /tls/ca.pem`. N'ignorez pas la vérification du nom d'hôte.

## 3. Remplacer le fournisseur SMS

L'adaptateur SMS doit appeler **le port de démonstration 3001**, ou 3444 en HTTPS, et non le port de gestion 3000.

```sh
curl -X POST http://127.0.0.1:3001/sms/messages \
  -H 'Content-Type: application/json' \
  -d '{"from":"+351911111111","to":"+351900000001","body":"Code : 123456"}'
```

Enregistrez auparavant le numéro avec `POST /phone-numbers` sur l'API de gestion.

## 4. Lire les messages et les pièces jointes

Utilisez `GET /mailboxes/:id/messages` ou `GET /phone-numbers/:id/messages`. La réponse JSON contient les métadonnées (`id`, `filename`, `contentType`, `size`), mais pas les octets binaires. Téléchargez un fichier via `GET /mailboxes/:id/messages/:messageId/attachments/:attachmentId`.

## 5. Erreurs et diagnostics

Les erreurs conservent le champ historique `error` et ajoutent `errorCode` et `errorParams`. Utilisez les codes stables et non le texte anglais. Les types d'événements SSE et les identifiants restent inchangés.

L'API de gestion ne demande généralement pas d'authentification. Restreignez l'accès au réseau de confiance et évitez les données personnelles de production.

[Tests automatisés](sdk.md) · [Référence API](api.md) · [TLS](tls.md)
