# Construire, tester et maintenir

Depuis un checkout propre, installer les trois lockfiles :

```sh
npm ci --ignore-scripts
npm ci --prefix web --ignore-scripts
npm ci --prefix testing --ignore-scripts
node testing/node_modules/@playwright/test/cli.js install chromium
npm run build
npm test
npm run test:all
```

`npm run build` génère OpenAPI et construit backend/console. `npm run build:openapi` génère seulement contrats et référence. Téléchargements : `/api/openapi.json` et `/api/openapi-demo.json`. Modifier `src/http/api-contract.ts` avec les handlers et tests : le build refuse une opération absente d’un côté. Les schémas documentent le contrat ; ils ne remplacent pas automatiquement la validation d’entrée.

`npm run dev` lance le backend avec console compilée. Reconstruire après une modification UI, ou utiliser le Vite optionnel via `npm run dev:console` pour HMR. L’utilisation normale et Docker ne nécessitent qu’un processus applicatif.

Le style Prettier est défini dans `.prettierrc.json` et `.editorconfig`. ESLint n’est pas ajouté avec la version TypeScript choisie. Séparer formatage et changements fonctionnels. Ne pas versionner dépendances, dist, secrets, clés CA, copies documentaires générées ou rapports.

La console affiche `docs/i18n/{pt-PT,en,fr}/`. Mettre les trois langues à jour ensemble. Les listes API sont générées ; routes et propriétés JSON restent identiques dans chaque langue.

Utiliser branches courtes et Pull Requests. Vérifier build/tests/audit Node 24/26, E2E, Docker smoke et le vrai Quality Gate SonarCloud. Un wrapper réussi ne remplace pas le Quality Gate. Un test ne fait ni merge ni déploiement.
