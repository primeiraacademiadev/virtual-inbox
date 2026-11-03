# Architecture et limites

Un processus Node.js sert console et API par HTTP/HTTPS. SMTP/STARTTLS/SMTPS capturent l’email. Des listeners HTTP auxiliaires capturent le SMS simulé ou envoient l’email demo. Tous partagent la même Sandbox en mémoire.

La Sandbox gère boîtes, messages, octets des pièces jointes, observateurs, séquences, journal circulaire et TTL. CertificateManager gère l’identité TLS et les contextes. Le catalogue HTTP alimente routage et OpenAPI. Les guides de console sont les mêmes sources localisées que le dépôt.

Le redémarrage supprime les messages/sessions et change `runId`. Ce n’est pas un stockage persistant de courrier. Seuls réseau et certificats persistent. Les destinations inconnues/expirées sont capturées comme anomalies, mais les quotas peuvent rejeter une livraison : la rétention n’est pas illimitée.

Limites globales par défaut : 10000 messages, 2000 boîtes plus les boîtes système, 500 observateurs, 256 MiB comptabilisés, 2000 événements, MIME SMTP complet 20 MiB, pièce jointe individuelle 20 MiB, corps HTTP 32 MiB, SMS 64 KiB, 20 pièces jointes. Elles se configurent par environnement ; voir `.env.example`. L’encodage MIME/base64 compte dans la taille SMTP. La comptabilité de l’application ne représente pas une limite exacte de RSS du processus.

L’API reste ouverte sur un réseau de test fiable. CORS/Host n’authentifient pas un client réseau. Protéger jetons et clés privées CA. Les flux d’observateurs comprennent des logs globaux ; les abonnements n’isolent pas des tenants.

Tests unitaires, harness réseau et smoke Docker sont des couches distinctes. La réussite d’une couche ne certifie pas tous les environnements.
