# Connexions et TLS

HTTP et HTTPS fonctionnent en parallèle. HTTPS n’est pas SMTP : email plain/STARTTLS sur 2525, TLS implicite sur 2465. Une identité active est partagée entre HTTPS, demo HTTPS, STARTTLS et SMTPS.

## Identité locale automatique

`TLS_MODE=auto` est la valeur par défaut. Le démarrage génère une AC et un certificat avec Node.js, sans exécutable OpenSSL. Le certificat serveur dure 30 jours et est régénéré au démarrage ou lors de la gestion des SAN lorsqu’il reste moins de sept jours. Aucun ordonnanceur périodique de renouvellement n’est présent. L’AC dure 365 jours ; prévoir son remplacement et la confiance des clients avant expiration.

Télécharger l’[AC publique](/api/tls/ca.pem) ou le [certificat serveur](/api/tls/certificate.pem). Vérifier l’empreinte de l’AC par un canal fiable avant de lui faire confiance. Préférer un fichier CA propre au client à une installation globale. Sous Windows, l’import dans les autorités racines de confiance de l’utilisateur est une décision explicite ; ne jamais importer `ca-key.pem`. Cette AC locale n’est pas automatiquement reconnue par les navigateurs.

## Noms, adresses et ports

Les SAN contiennent les DNS/IP réellement utilisés, notamment le service Compose. Les sources sont `TLS_SERVER_NAMES`, `TLS_SERVER_NAMES_FILE`, le fichier géré par la console et `PUBLIC_HOST`. Format : `{"dns":["localhost"],"ips":["127.0.0.1","::1"]}`. Les IPv6 avec IPv4 intégrée sont pris en charge ; les scopes `%eth0` sont rejetés. Les adresses wildcard d’écoute sont exclues.

Dans Connexions et TLS, modifier les ajouts de la console puis régénérer/appliquer. Seuls ces ajouts sont remplacés ; environnement et fichier restent inclus. Le certificat change sans redémarrage. Un SAN ne modifie ni DNS ni interfaces réseau. Les changements de hosts/ports exigent un redémarrage.

## Administration

Définir `ADMIN_TOKEN` dans un `.env` privé ou l’environnement puis redémarrer. Ouvrir la page par HTTPS de confiance et fournir le jeton. Les APIs de messages restent ouvertes. Ne jamais envoyer une clé privée à un service non contrôlé ou l’inclure dans des journaux/rapports. Un jeton valide par HTTP est refusé.

## Import ou fichiers externes

L’import accepte une chaîne PEM (feuille puis intermédiaires) et la clé privée PEM correspondante, non chiffrée. Le gestionnaire vérifie dates et correspondance puis active et conserve l’identité. Le matériel invalide doit préserver l’identité précédente. Un import prend priorité au prochain démarrage.

En standalone/Docker, utiliser `TLS_MODE=external`, `TLS_CERT_FILE`, `TLS_KEY_FILE`. Monter les secrets en lecture seule ; ne pas incorporer les clés dans l’image. Les fichiers sont vérifiés environ toutes les dix secondes tant que la source externe est sélectionnée. La confiance se configure chez les clients, pas par simple installation d’AC dans l’image serveur.

Pour revenir à l’automatique, régénérer les SAN en mode auto. Pour revenir à une source externe, arrêter le processus, sauvegarder puis retirer le fichier de sélection d’identité importée, configurer les chemins externes et redémarrer. Conserver l’ancien matériel pour récupération.

## Priorité et erreurs

Les paramètres réseau persistés priment sur l’environnement puis sur les valeurs par défaut. Le démarrage annonce les clés remplacées. Sauvegarder/modifier `network-settings.json` à l’arrêt pour rendre la main à l’environnement. Le volume conserve configuration/certificats, pas les messages.

Nom incompatible : corriger SAN/servername. AC inconnue : fournir la bonne AC publique. Erreur de protocole SSL : vérifier le port TLS (3443/3444/2465), pas HTTP/SMTP plain. `403` administratif : HTTPS et jeton. `409` lors de régénération : mode auto requis. Ne pas désactiver la vérification des certificats.
