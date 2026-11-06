# Extensions

La console Virtual Inbox découvre les extensions grâce au **registre public en lecture seule** situé à `GET /api/extensions`.

Ouvre **Système → Extensions** pour consulter les modules actifs, défaillants ou désactivés. Chaque entrée présente les capacités, les points d'accès HTTP, le nombre de requêtes et d'erreurs, la durée cumulée et le dernier statut HTTP. Le registre est actualisé toutes les 15 secondes ou manuellement. Les compteurs sont conservés uniquement en mémoire et réinitialisés au redémarrage.

L'action **Afficher les logs de cette extension** ouvre le journal avec le filtre serveur `extensionId`. Les anomalies sont désactivées dans le filtre pour isoler les événements de l'extension. Les entrées contiennent le chemin logique, le statut, la durée et l'identifiant de corrélation, sans corps de requête ni identifiants sensibles.

L'extension intégrée `sms-native` est activée par défaut. Elle fournit `POST /demo/sms/messages` sur le listener principal et `POST /sms/messages` sur le listener de démonstration. Elle appelle l'API fonctionnelle publique `POST /api/sms/ingestions`. Pour désactiver l'émetteur uniquement, configure `VI_SMS_NATIVE_ENABLED=false` et redémarre.

Des modules ESM locaux de confiance peuvent être configurés via `VI_EXTENSIONS`. Un module en erreur apparaît sous le nom `failed-N`, avec un diagnostic limité. La console ne permet pas d'installer des modules, de charger des interfaces tierces ou de modifier le serveur.

Consulte les guides [d'intégration](integration.md), du [SDK](sdk.md) et de [l'architecture](architecture.md). Un module peut fournir un chemin de documentation locale ; la console n'ouvre que les documents disponibles pour éviter les liens inexistants.
