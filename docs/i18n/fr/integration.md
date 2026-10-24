# Intégrer une application

Créer une boîte avec POST `/api/mailboxes` ou `/api/phone-numbers`. Un objet JSON vide utilise les valeurs par défaut du serveur. Conserver `id` (UUID REST) et `address` (destinataire). Configurer l’application testée, déclencher son vrai workflow puis lire ou attendre le message capturé.

## Transports email

| Transport | Port | Options Nodemailer |
| --- | --- | --- |
| SMTP plain | 2525 | `secure:false, ignoreTLS:true` |
| STARTTLS obligatoire | 2525 | `secure:false, requireTLS:true` |
| SMTPS | 2465 | `secure:true` |

Pour TLS, fournir l’AC de confiance et un `servername` présent dans les SAN. Ne jamais utiliser `rejectUnauthorized:false`. L’authentification SMTP n’est pas exigée. Dans Compose, le hostname est le service ; hors Docker, utiliser le port publié. Ajouter ce hostname aux SAN si TLS est utilisé.

Depuis le dépôt, avec le serveur démarré :

```sh
node examples/smtp-roundtrip.mjs plain
node examples/smtp-roundtrip.mjs starttls data/certificates/ca.pem
node examples/smtp-roundtrip.mjs smtps data/certificates/ca.pem
```

Chaque exemple crée une boîte, envoie MIME et pièce jointe binaire, attend, compare SHA-256 puis nettoie. Avec Docker, copier uniquement l’AC publique : `docker cp virtual-inbox:/app/data/certificates/ca.pem ./vi-ca.pem`. Passer `vi-ca.pem` en dernier argument, jamais la clé de l’AC.

## SMS

Aucun transport télécom réel. Envoyer `{"from":"test-app","to":"+351912345678","body":"Message de test"}` à `/demo/sms/messages` sur l’origine principale, ou `/sms/messages` sur le listener demo (3001/3444). Le destinataire doit correspondre au numéro créé ; les alias nationaux/internationaux pris en charge rejoignent la même boîte. `node examples/sms-roundtrip.mjs` exécute le parcours complet.

Le [contrat OpenAPI demo](/api/openapi-demo.json) documente ces opérations séparément. L’envoi email demo renvoie `202` ; la capture SMS renvoie `201`.

## Limites et diagnostic

Vérifier la capture REST après l’acceptation SMTP. Les destinataires inconnus/expirés vont dans les anomalies. Le JSON contient seulement les métadonnées des pièces jointes ; télécharger les octets via `/api/mailboxes/{inboxId}/messages/{messageId}/attachments/{attachmentId}`. La limite SMTP inclut l’encodage et tout le MIME. Les quotas peuvent rejeter une livraison.

CORS concerne le navigateur, pas un client Node/SMTP ordinaire. `421` indique Host refusé ; `403` peut indiquer Origin ou administration. Configurer précisément les hosts/origines autorisés. Continuer avec [Tests automatiques](sdk.md).
