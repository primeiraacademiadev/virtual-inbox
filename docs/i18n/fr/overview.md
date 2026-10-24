# Démarrer

Virtual Inbox capture des emails SMTP réels et des SMS simulés par HTTP pour les démonstrations et tests. Il ne distribue pas d’email sur Internet et n’utilise aucun opérateur SMS. Boîtes, messages, pièces jointes, observateurs et journaux sont en mémoire et disparaissent au redémarrage. Seuls configuration et certificats persistent.

## Installation standalone

Utiliser Node.js 24+ et npm. Depuis la racine du dépôt :

```sh
npm ci --ignore-scripts
npm ci --prefix web --ignore-scripts
npm run build
npm start
```

Ouvrir `http://127.0.0.1:3000`. Le même processus propose HTTPS sur `https://localhost:3443`, SMTP/STARTTLS sur `2525` et SMTPS sur `2465`. HTTPS nécessite de faire explicitement confiance à l’AC locale. Aucun `.env`, base de données, Kubernetes ou exécutable OpenSSL n’est obligatoire. `npm run dev` construit la console puis lance le backend en watch ; Vite reste optionnel.

## Choisir un parcours

[Démonstration](demo.md) pour l’usage manuel ; [Intégration](integration.md) pour connecter une application ; [Tests automatiques](sdk.md) pour vérifier les livraisons ; [TLS](tls.md) pour les connexions chiffrées. [API](api.md) fournit la référence générée et OpenAPI.

## Docker

Construire avec `docker build -t virtual-inbox:local .`, puis :

```sh
docker run --rm --name virtual-inbox -p 127.0.0.1:3000:3000 -p 127.0.0.1:3443:3443 -p 127.0.0.1:2525:2525 -p 127.0.0.1:2465:2465 -v virtual-inbox-data:/app/data virtual-inbox:local
```

Le volume conserve certificats et configuration, pas les messages. Dans Compose, utiliser le nom du service au lieu de localhost. Ne publier les ports demo supplémentaires que si nécessaire. Conserver l’API ouverte sur un réseau de test de confiance.

## Vérification et dépannage

GET `/api/health` doit renvoyer `status: ok` et `runId`. Console absente : exécuter `npm run build`. Connexion refusée : vérifier processus, ports publiés et `/api/connection-info`. Port occupé : modifier la variable concernée avant démarrage. Une variable ignorée peut être remplacée par la configuration persistée ; voir [TLS](tls.md).
