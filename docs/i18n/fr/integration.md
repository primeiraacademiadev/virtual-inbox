# Intégrer une application

Créer une boîte avec POST `/api/mailboxes` ou `/api/phone-numbers`. Un objet JSON vide utilise les valeurs par défaut du serveur. Conserver `id` (UUID REST) et `address` (destinataire). Configurer l’application testée, déclencher son vrai workflow puis lire ou attendre le message capturé.

## Transports email

| Transport | Port | Options Nodemailer |
| --- | --- | --- |
| SMTP plain | 2525 | `secure:false, ignoreTLS:true` |
| STARTTLS obligatoire | 2525 | `secure:false, requireTLS:true` |
| SMTPS | 2465 | `secure:true` |

Pour TLS, fournir l’AC de confiance et un `servername` présent dans les SAN. Ne jamais utiliser `rejectUnauthorized:false`. L’authentification SMTP n’est pas exigée ; si elle est utilisée, le nom d'utilisateur doit être l'adresse d'une boîte email active, avec un mot de passe fictif. Dans Compose, le hostname est le service ; hors Docker, utiliser le port publié. Ajouter ce hostname aux SAN si TLS est utilisé.

Depuis le dépôt, avec le serveur démarré :

```sh
node examples/smtp-roundtrip.mjs plain
node examples/smtp-roundtrip.mjs starttls
node examples/smtp-roundtrip.mjs smtps
```

Chaque exemple crée une boîte, envoie MIME et pièce jointe binaire, attend, compare SHA-256 puis nettoie. Avec Docker, copier uniquement l’AC publique : `docker cp virtual-inbox:/app/data/certificates/ca.pem ./vi-ca.pem`. Définir `VI_TEST_CA_FILE=./vi-ca.pem` dans l’environnement pour utiliser cette AC publique. Le script n’accepte plus de chemin CA en argument CLI. Ne jamais copier la clé de l’AC.

## SMS

Aucun transport télécom réel. Envoyer `{"from":"test-app","to":"+351912345678","body":"Message de test"}` à `/demo/sms/messages` sur l’origine principale, ou `/sms/messages` sur le listener demo (3001/3444). Pour une livraison normale, le destinataire doit correspondre au numéro créé ; les alias nationaux/internationaux pris en charge rejoignent la même boîte. Les numéros inconnus ou expirés sont acceptés dans les anomalies, comme indiqué ci-dessous. `node examples/sms-roundtrip.mjs` exécute le parcours complet.

Le [contrat OpenAPI demo](/api/openapi-demo.json) documente ces opérations séparément. L’envoi email demo renvoie `202` ; la capture SMS renvoie `201`.


## Destinataires inconnus ou expirés

**L'envoi d'un message ne crée pas automatiquement de boîte.** Par défaut, Virtual Inbox accepte les messages adressés à des adresses ou numéros non enregistrés ou expirés et les conserve dans la boîte système d'anomalies du canal, plutôt que de les supprimer silencieusement.

| Destinataire | Email (SMTP/STARTTLS/SMTPS) | SMS (API de démonstration) |
| --- | --- | --- |
| Boîte active | Livraison normale ; `250 Accepted` après `DATA` | Capture normale ; HTTP `201 Created` |
| Inconnu | `RCPT TO` accepté ; `250 Accepted` après `DATA` ; capture `UNKNOWN_RECIPIENT` | HTTP `201 Created` ; capture `UNKNOWN_RECIPIENT` |
| Expiré | Accepté et capturé avec `EXPIRED_RECIPIENT` | HTTP `201 Created` ; capture `EXPIRED_RECIPIENT` |
| Limites/erreurs | Acceptation non garantie : par exemple `552` pour la taille, `452` pour la capacité ou erreur injectée | Peut retourner `413`, `507` ou échouer à une autre validation |

Les boîtes système sont créées automatiquement : `anomalies@sandbox.test` (email) et `+999000000000` (SMS). Pour consulter les messages :

1. Appeler `GET /api/mailboxes` (email) ou `GET /api/phone-numbers` (SMS) et repérer la boîte système (`system: true` et l'adresse indiquée).
2. Utiliser son `id` (UUID) dans `GET /api/mailboxes/{id}/messages` ou `GET /api/phone-numbers/{id}/messages`.
3. Lire `originalRecipient` pour connaître le destinataire demandé et `captureReason` (`UNKNOWN_RECIPIENT` ou `EXPIRED_RECIPIENT`) pour comprendre le motif. L'événement est `message.captured`, et non `message.received`.

Exemple des champs pertinents d'un message capturé :

```json
{"originalRecipient":"inconnu@example.test","captureReason":"UNKNOWN_RECIPIENT"}
```

**Ne pas confondre livraison et authentification :** `RCPT TO` accepte les destinataires inconnus, mais `SMTP AUTH` exige un *username* correspondant à une boîte email active ; sinon le serveur retourne `535`. La consultation REST d'une boîte UUID inexistante peut retourner `404`, sans rapport avec l'acceptation SMTP. Les messages sont volatils et soumis aux quotas.

## Limites et diagnostic

Vérifier la capture REST après l’acceptation SMTP, dans la boîte normale ou la boîte d'anomalies. Le JSON contient seulement les métadonnées des pièces jointes ; télécharger les octets via `/api/mailboxes/{inboxId}/messages/{messageId}/attachments/{attachmentId}`. La limite SMTP inclut l’encodage et tout le MIME. Les quotas peuvent rejeter une livraison.

CORS concerne le navigateur, pas un client Node/SMTP ordinaire. `421` indique Host refusé ; `403` peut indiquer Origin ou administration. Configurer précisément les hosts/origines autorisés. Continuer avec [Tests automatiques](sdk.md).

## Compatibilité Communication et authentification SMTP

Virtual Inbox est un **bac à sable de test** : il annonce SMTP AUTH `PLAIN` et `LOGIN`. Créer d'abord une boîte email et utiliser son adresse comme nom d'utilisateur ; un mot de passe fictif identifie une session logique (le même couple boîte/mot de passe retrouve le même GUID tant que la boîte existe). Un utilisateur inconnu ou expiré est refusé avec `535`. Le mot de passe n'est ni journalisé ni conservé en clair : des hashes salés restent en mémoire et seul `authUser` est associé aux messages. Les envois sans authentification restent possibles. Ceci **n'est pas un contrôle d'accès sécurisé** : ne pas exposer SMTP à Internet ni à un réseau non fiable. AUTH en clair est autorisé uniquement pour les tests ; préférer STARTTLS/SMTPS.

Communication nécessite toujours des identifiants SMTP. Utiliser l'adresse d'une boîte email déjà créée et un mot de passe fictif : l'ancienne erreur `535 Authentication not implemented` est corrigée, mais un utilisateur inconnu reçoit toujours `535`. Pour les clients Node STARTTLS/SMTPS, définir `NODE_EXTRA_CA_CERTS=/chemin/vi-ca.pem` **avant le démarrage** du processus Communication. Sous Docker, monter l'AC publique et utiliser son chemin dans le conteneur. Le nom d'hôte doit apparaître dans les SAN du certificat. Ne jamais utiliser `rejectUnauthorized:false`.

Les réponses de liste, détail et attente des messages incluent `headers` (ordre et doublons préservés, `key` en minuscules, `originalKey`, `value`), `envelope: {mailFrom,rcptTo}` et `authUser` le cas échéant. Les en-têtes `From`, `Reply-To`, `Cc`, `X-Message-ID` sont accessibles quand ils existent. **Bcc est souvent absent du MIME** : vérifier `envelope.rcptTo`. L'ancien champ `from` reste l'expéditeur SMTP de l'enveloppe.

Attente avec filtre HTML et en-tête :

```json
{"timeoutMs":10000,"match":{"bodyContains":"code-123","header":{"name":"X-Message-ID","valueContains":"trace-abc"}}}
```

`bodyContains` cherche dans le texte **ou le HTML brut** ; `htmlContains` uniquement dans le HTML. Le nom d'en-tête ignore la casse, `valueContains` respecte la casse. Les filtres se combinent par AND. Un message HTML seul peut avoir un `body` vide.

Les dépassements MIME/pièces jointes retournent SMTP **552** (permanent), pas 450. Une capacité globale épuisée peut retourner **452** (transitoire). Adapter les retries et la DLQ. Les tests couvrent AUTH PLAIN/LOGIN, SMTP/STARTTLS/SMTPS, métadonnées et 552.
