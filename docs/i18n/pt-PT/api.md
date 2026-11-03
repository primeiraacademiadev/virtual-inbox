# Referência da API

A consola gera esta referência no build a partir de `src/http/api-contract.ts`, o catálogo usado pelo router HTTP. `npm run build:openapi` produz `docs/openapi.json` e `docs/openapi-demo.json` no checkout. Também podes obter `/api/openapi.json` numa instância em execução.

A API principal usa `/api`. Os emissores demo usam `/demo` no listener principal ou caminhos sem prefixo no listener dedicado; o contrato é separado. SMTP/STARTTLS/SMTPS estão no [guia de integração](integration.md), não são endpoints HTTP.

A referência gerada contém métodos, parâmetros, esquemas, estados, eventos SSE e autenticação. Escritas administrativas exigem HTTPS e bearer `ADMIN_TOKEN`. `204` não tem JSON. As mensagens são efémeras, não são consumidas pelas leituras e estão sujeitas a quotas.
