# Desenvolvimento

Estrutura do projeto e procedimentos de manutenção.

## Organização

`src/core.ts`: domínio. `src/server.ts`: HTTP, SMTP e TLS. `src/config.ts`: limites. `web/src`: consola. `web/src/i18n`: localização. `web/src/search`: pesquisa. `sdk/client.ts`: testes.

## Validação

Executa `npm test`, `npm run build`, `npm run build:console` e a auditoria npm no ambiente de validação. Os lockfiles e a interoperabilidade TLS ainda exigem verificação.

---

[API de gestão](api.md) · [TLS](tls.md) · [SDK](sdk.md)
