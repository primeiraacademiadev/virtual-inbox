# Essayer la console

Suivre [Démarrer](overview.md), ouvrir `http://127.0.0.1:3000` et utiliser le menu hamburger pour l’espace de travail, Connexions et TLS, Documentation et API. Le sélecteur de langue change l’affichage, pas les identifiants techniques.

## Ajouter une boîte

Utiliser le bouton d’ajout du groupe email ou SMS. Un champ vide génère une adresse. Une adresse renseignée recherche une boîte existante ; confirmer la création si elle est absente. Le format sélectionne automatiquement le type. Le drapeau règle la locale, la stratégie choisit le motif de l’email, le préfixe contrôle l’indicatif et SAFE choisit des données synthétiques. L’horloge révèle le TTL en secondes. Les choix persistent par onglet, sauf l’identifiant.

L’identifiant REST est le UUID retourné, pas l’adresse ou le numéro. Les boutons de copie donnent un retour. Retirer un abonnement n’équivaut pas nécessairement à supprimer la boîte : confirmer l’action de suppression demandée.

## Envoyer et inspecter

Sélectionner une boîte et ouvrir l’envoi. Le destinataire est cette même boîte. L’email traverse le listener SMTP local ; le SMS est capturé par la route HTTP demo, sans opérateur externe. Lire les détails et télécharger les pièces jointes : leurs octets sont conservés. Les badges de lecture appartiennent à la console ; les lectures API ne consomment pas les messages.

Les journaux peuvent être minimisés, affichés sous la boîte ou agrandis. La barre latérale se replie aussi. En cas de message absent, consulter les journaux et les boîtes système d’anomalies : les destinations inconnues/expirées y sont capturées, dans les limites de quotas.

`404` : boîte/session absente ou expirée ; `409` : adresse existante ; `413` : taille excessive ; `507` : capacité globale épuisée. Supprimer les données de test ou augmenter volontairement les limites. Après un redémarrage serveur, recréer session et boîte : les messages ne persistent pas.
