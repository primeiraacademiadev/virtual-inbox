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
node examples/smtp-roundtrip.mjs starttls
node examples/smtp-roundtrip.mjs smtps
```

Chaque exemple crée une boîte, envoie MIME et pièce jointe binaire, attend, compare SHA-256 puis nettoie. Avec Docker, copier uniquement l’AC publique : `docker cp virtual-inbox:/app/data/certificates/ca.pem ./vi-ca.pem`. Définir `VI_TEST_CA_FILE=./vi-ca.pem` dans l’environnement pour utiliser cette AC publique. Le script n’accepte plus de chemin CA en argument CLI. Ne jamais copier la clé de l’AC.

## SMS

Aucun transport télécom réel. Envoyer `{"from":"test-app","to":"+351912345678","body":"Message de test"}` à `/demo/sms/messages` sur l’origine principale, ou `/sms/messages` sur le listener demo (3001/3444). Le destinataire doit correspondre au numéro créé ; les alias nationaux/internationaux pris en charge rejoignent la même boîte. `node examples/sms-roundtrip.mjs` exécute le parcours complet.

Le [contrat OpenAPI demo](/api/openapi-demo.json) documente ces opérations séparément. L’envoi email demo renvoie `202` ; la capture SMS renvoie `201`.

## Limites et diagnostic

Vérifier la capture REST après l’acceptation SMTP. Les destinataires inconnus/expirés vont dans les anomalies. Le JSON contient seulement les métadonnées des pièces jointes ; télécharger les octets via `/api/mailboxes/{inboxId}/messages/{messageId}/attachments/{attachmentId}`. La limite SMTP inclut l’encodage et tout le MIME. Les quotas peuvent rejeter une livraison.

CORS concerne le navigateur, pas un client Node/SMTP ordinaire. `421` indique Host refusé ; `403` peut indiquer Origin ou administration. Configurer précisément les hosts/origines autorisés. Continuer avec [Tests automatiques](sdk.md).

## Compatibilité Communication et authentification SMTP

Virtual Inbox est un **bac à sable de test** : il annonce SMTP AUTH `PLAIN` et `LOGIN` et accepte tous les identifiants/mots de passe. Seul `authUser` est conservé avec le message ; **jamais le mot de passe**. Les envois sans authentification restent possibles. Ceci **n'est pas un contrôle d'accès** : ne pas exposer SMTP à Internet ni à un réseau non fiable. AUTH en clair est autorisé uniquement pour les tests ; préférer STARTTLS/SMTPS.

Communication nécessite toujours des identifiants SMTP. Utiliser des valeurs fictives et cibler Virtual Inbox : l'erreur `535 Authentication not implemented` est corrigée. Pour les clients Node STARTTLS/SMTPS, définir `NODE_EXTRA_CA_CERTS=/chemin/vi-ca.pem` **avant le démarrage** du processus Communication. Sous Docker, monter l'AC publique et utiliser son chemin dans le conteneur. Le nom d'hôte doit apparaître dans les SAN du certificat. Ne jamais utiliser `rejectUnauthorized:false`.

Les réponses de liste, détail et attente des messages incluent `headers` (ordre et doublons préservés, `key` en minuscules, `originalKey`, `value`), `envelope: {mailFrom,rcptTo}` et `authUser` le cas échéant. Les en-têtes `From`, `Reply-To`, `Cc`, `X-Message-ID` sont accessibles quand ils existent. **Bcc est souvent absent du MIME** : vérifier `envelope.rcptTo`. L'ancien champ `from` reste l'expéditeur SMTP de l'enveloppe.

Attente avec filtre HTML et en-tête :

```json
{"timeoutMs":10000,"match":{"bodyContains":"code-123","header":{"name":"X-Message-ID","valueContains":"trace-abc"}}}
```

`bodyContains` cherche dans le texte **ou le HTML brut** ; `htmlContains` uniquement dans le HTML. Le nom d'en-tête ignore la casse, `valueContains` respecte la casse. Les filtres se combinent par AND. Un message HTML seul peut avoir un `body` vide.

Les dépassements MIME/pièces jointes retournent SMTP **552** (permanent), pas 450. Une capacité globale épuisée peut retourner **452** (transitoire). Adapter les retries et la DLQ. Les tests couvrent AUTH PLAIN/LOGIN, SMTP/STARTTLS/SMTPS, métadonnées et 552.
