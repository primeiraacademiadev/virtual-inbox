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

L’**API publique fonctionnelle de capture SMS** est `POST /api/sms/ingestions` sur le listener HTTP(S) principal. Elle accepte le même JSON et renvoie `201` avec le message capturé. Tous les clients de test, y compris les extensions, utilisent la même capture, le même routage, les mêmes TTL et anomalies que l’émetteur de démonstration. Cette opération distincte évite à une extension de rappeler récursivement son propre endpoint fournisseur. Le client typé `@virtual-inbox/client` propose `ingestSms({ from, to, body })`. Aucun transport télécom réel, ni sémantique de campagne ou d’authentification fournisseur. L’opération figure dans `/api/openapi.json` ; les endpoints demo restent inchangés.

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

## Découverte des connexions SMTP avec @virtual.inbox

Le domaine réservé `@virtual.inbox` crée automatiquement une boîte temporaire pendant **60 secondes** après la réception SMTP d'une requête valide adressée à un identifiant hexadécimal aléatoire de **32 caractères (128 bits)**, par exemple `d44eaf765b72401cae559febf14f2378@virtual.inbox`. La requête doit avoir **un seul destinataire, sans en-tête Subject, corps texte/HTML ni pièce jointe**. Les requêtes invalides sont rejetées. Le message original n'est pas conservé : une réponse JSON contient `protocol`, `smtpSessionId`, `authenticated` et `secure`. Une nouvelle requête ne prolonge pas le TTL. Consulter `GET /api/mailboxes?address=<adresse>`, puis `POST /api/mailboxes/{inboxId}/wait-for-message`. Garder la même connexion SMTP ouverte pour configurer les erreurs DATA par connexion à `/api/admin/smtp/sessions/{smtpSessionId}/simulations` (HTTPS et ADMIN_TOKEN obligatoires). Le GUID n'est pas un jeton d'autorisation. `SMTP_AUTH_POLICY=OPEN` accepte SMTP AUTH sans boîte; `INBOX` reste le mode par défaut. SMTP anonyme est permis et POP3 reste inchangé. Utiliser uniquement dans des réseaux de test fiables.

### Identité SMTP et historique

Après SMTP AUTH, le serveur associe un GUID public `clientId` au condensat HMAC-SHA-256 interne du nom d'utilisateur, du mot de passe et de l'adresse IP, calculé avec un secret créé au démarrage. Les mêmes trois valeurs donnent le même client pendant cette exécution. Les connexions anonymes ne sont pas regroupées par IP. La réponse `@virtual.inbox` inclut `clientId` (null pour une connexion anonyme) et `sessions` avec `smtpSessionId`, `connectedAt`, `disconnectedAt`, `connected` et `current`. `SMTP_SESSION_HISTORY_HOURS` définit la rétention (24 heures par défaut, dans les limites de mémoire). La boîte spéciale expire après 60 secondes.

### Domaine reserve et attente avant la creation

Le domaine `@virtual.inbox` est reserve : la creation manuelle des boites y est interdite. Seule une requete SMTP valide avec identifiant hexadecimal aleatoire de 32 caracteres cree une boite ephemere (TTL de 60 secondes), sans renouvellement. Pour attendre **avant que la boite existe**, utiliser `POST /api/connection-probes/wait-for-message` avec `{"address":"<32-hex>@virtual.inbox","timeoutMs":60000}` et `after` facultatif. L'attente ne cree pas de boite et ne prolonge pas sa validite : maximum 60 secondes depuis la requete et jamais au-dela de l'expiration d'une boite existante. HTTP 200 retourne le message; HTTP 204 signifie delai expire, suppression ou annulation; HTTP 400 signifie parametres invalides. `MAX_OBSERVER_COUNT` limite les attentes simultanees. L'ancien endpoint par `inboxId` exige toujours une boite existante.

### Visibilité des anomalies dans les journaux

Lorsqu'un filtre cible une boîte ou un expéditeur, les événements `message.captured` restent visibles par défaut, même hors filtre. Définissez `includeAnomalies=false` sur `/api/logs` ou les flux SSE pour un mode strictement ciblé. La console propose l'option «Include anomalies», activée par défaut. Les filtres ne constituent pas une autorisation ; seules des données synthétiques doivent être utilisées.

### Recherche des messages capturés

Les boîtes système restent partagées. `GET /api/mailboxes/{inboxId}/messages` et l'équivalent SMS acceptent les filtres exacts combinables `originalRecipient`, `from` (expéditeur de l'enveloppe SMTP lorsqu'il est disponible), `captureReason`, `smtpSessionId`, `authUser` et le curseur numérique `after`. La console affiche les comptes par destinataire initial et motif, avec filtres dédiés. Le stockage et l'autorisation ne changent pas ; n'utiliser que des données synthétiques.
