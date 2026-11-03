# Référence de l’API

La console génère cette référence pendant le build depuis `src/http/api-contract.ts`, le catalogue du router HTTP. `npm run build:openapi` écrit `docs/openapi.json` et `docs/openapi-demo.json` dans le checkout. `/api/openapi.json` est aussi disponible sur une instance en cours d’exécution.

L’API principale utilise `/api`. Les émetteurs demo utilisent `/demo` sur le listener principal, ou des chemins sans préfixe sur leur listener dédié ; leur contrat est séparé. SMTP/STARTTLS/SMTPS sont décrits dans le [guide d’intégration](integration.md), pas comme routes HTTP.

La référence générée décrit méthodes, paramètres, schémas, statuts, SSE et sécurité. Les écritures administratives exigent HTTPS et bearer `ADMIN_TOKEN`. `204` n’a pas de JSON. Les messages sont éphémères, soumis à quotas et ne sont pas consommés par les lectures.
