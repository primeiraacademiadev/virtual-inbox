# Construir, testar e manter

Num checkout limpo, instala pelos três lockfiles:

```sh
npm ci --ignore-scripts
npm ci --prefix web --ignore-scripts
npm ci --prefix testing --ignore-scripts
node testing/node_modules/@playwright/test/cli.js install chromium
npm run build
npm test
npm run test:all
```

`npm run build` gera OpenAPI e compila backend e consola. `npm run build:openapi` gera apenas contratos e referência. Os downloads em execução são `/api/openapi.json` e `/api/openapi-demo.json`. Altera `src/http/api-contract.ts` em conjunto com handlers e testes: o build rejeita operações em falta de qualquer dos lados. Os esquemas documentam contratos; não substituem automaticamente a validação de entrada.

`npm run dev` inicia o backend com consola compilada. Reconstrói a consola após mudanças visuais ou usa o Vite opcional com `npm run dev:console` para HMR. Utilização normal e Docker precisam apenas de um processo aplicacional.

O estilo Prettier está em `.prettierrc.json` e `.editorconfig`. Não acrescentamos ESLint nesta fase, devido à versão TypeScript escolhida. Separa formatação de alterações funcionais. Não versiones dependências, dist, credenciais, chaves CA, cópias de documentação geradas nem relatórios.

A consola renderiza `docs/i18n/{pt-PT,en,fr}/`. Atualiza as três línguas em conjunto. As listagens de API são geradas; nomes de rotas e propriedades JSON não são traduzidos.

Usa branches curtas e Pull Requests. Valida build/testes/audit Node 24/26, E2E, Docker smoke e o Quality Gate SonarCloud efetivo. O sucesso do job de wrapper não substitui o Quality Gate. Executar testes não faz merge nem deployment.
