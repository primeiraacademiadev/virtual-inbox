# Revisão de hardening e geração de identidades — 22/10/2026

## Etapa A — Correções e segurança

- Corrigida a receção SMTP para transformar os anexos de `postal-mime` em `Buffer` antes de determinar `size` e aplicar quotas.
- Corrigida a sanitização de `Content-Disposition` de ficheiros descarregados.
- Eventos de observadores expirados deixam de causar exceções na entrega; SSE termina e liberta listeners.
- Renovação do observador baseada em `OBSERVER_SESSION_TTL_SECONDS`.
- API HTTP continua sem autenticação, com validação de `Host` e CORS same-origin por omissão. Vite de desenvolvimento e origens explicitamente configuradas são aceites.
- Testes acrescentados: regressões de observador, dados binários e nomes, políticas HTTP.
- `node-forge` atualizado para a versão 1.4.x, a mais recente na data da revisão. Mantém-se a avaliação da vulnerabilidade de verificação de assinatura sem correção publicada; `npm audit` pode bloquear o CI até resolução ou exceção de risco formalizada.
- Ainda falta gerar e versionar `package-lock.json` em ambos os pacotes, verificar os builds e o Docker no ambiente com acesso ao registry npm. Não declarar aprovação de CI.

## Etapa B — Identidades sintéticas

- Catálogos JSON de nomes próprios, apelidos e perfis telefónicos `pt-PT`, `en-US`, `fr-FR`.
- Emails: `FIRST_LAST`, `LAST_FIRST`, `FIRST_MIDDLE_LAST`, `FIRST_LAST_SUFFIX`, `RANDOM`.
- Telefones: `NATIONAL_FORMAT`, prefixos por país, indicativo opcional, sufixo `401`, alternativa `Safe Test Data` sintética.
- Configuração pelo conjunto exato de `IDENTITY_DEFAULT_*` em `.env.example`, com `pt-PT` e `FIRST_LAST` por omissão.
- Criação e reserva síncrona com tentativas repetidas até limite e código `IDENTITY_GENERATION_EXHAUSTED`.
- Equivalência entre formas nacional e internacional no índice interno, com pesquisa REST `GET /{mailboxes|phone-numbers}?address=`.
- UI: bandeira redonda, estratégia por combo, SAFE e indicativo em botões inline; preferências em `sessionStorage`, identificador não persistido.
- `GET /identity-generation/options` anuncia locales, estratégias e defaults.
- Testes de geração, formatos, colisões e esgotamento incluídos.
- Fonte e ressalvas dos dados: [docs/identity-generation.md](../identity-generation.md).

## Condições de aceitação não verificadas

```sh
npm install
npm install --prefix web
npm run build
npm test
npm run build:console
npm run audit
docker build -t virtual-inbox:local .
```

O ambiente de execução usado nesta revisão não conseguiu aceder ao GitHub/npm para obter o checkout e instalar dependências; nenhuma execução bem-sucedida dos comandos acima foi observada. Não houve deployment. Os commits de alterações foram feitos incrementalmente, em vez de dois squash commits, para evitar reescrever o histórico de `main`.
