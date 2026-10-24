# Plano de testes E2E — Virtual Inbox

## Objetivo e critérios

Validar um processo Node real, sem importar `Sandbox`. SMTP, STARTTLS, SMTPS, REST, SSE e a consola React são testados externamente. O Playwright é apenas um executor do harness; os drivers de protocolo operam independentemente do browser.

### Matriz de execução

| Área | Casos automáticos | Isolamento | Estado |
| --- | --- | --- | --- |
| SMTP | Plain, STARTTLS, SMTPS com texto, MIME, anexo binário e SHA-256 | Attached/Managed | Implementado |
| API | Criação, consulta, eliminação, geração por locale, demo-send | Attached/Managed | Parcial |
| SMS | Número nacional e E.164 para a mesma inbox | Attached/Managed | Implementado |
| SSE | Stream aberto, mensagem recebida, evento emitido | Attached/Managed | Implementado |
| TLS | Identidade ativa, SAN, validade, rejeição sem token, rotação HTTPS | Rotation: Managed | Parcial |
| Browser | Render, menu, locale, associação da inbox, mensagem visível | Attached/Managed | Inicial |
| Segurança | Host externo 421, Origin externo 403 | Attached/Managed | Implementado |
| Anexos | Bytes, nome e tamanho após captura SMTP | Attached/Managed | Implementado |
| Resiliência | TTL, esgotamento, reinício, limites, rollback SMTP | Managed | Pendente |
| Docker | Build e testes contra imagem standalone | Managed | Pendente |

**Implementado** indica que o cenário foi escrito, não que tenha passado numa execução real.

## Gates

1. Unit: `npm test`, build integrado.
2. Protocol: driver SMTP e contratos API, sem browser.
3. UI: Playwright Chromium em três idiomas e anexos.
4. TLS/security: certificado verificado com CA, SAN, rotação a quente e rollback. Nunca numa instalação partilhada.
5. Container: Docker standalone e publicação apenas após as gates obrigatórias.

## Testes adicionais a implementar

- SMTP cabeçalhos complexos, Unicode, BCC, MIME HTML, multiparte, anexos múltiplos, limites e negativos.
- SSE replay, filtragem, reconexão, expiração de observadores e sessões.
- Estratégias de identidades, colisões e SAFE, inclusive sem indicativo.
- UI importação de certificados, erros, documentação, pesquisa e downloads.
- Testes de validade/cadeia, mismatched key, renovação e rotação em STARTTLS/SMTPS.
- Carga controlada, limpeza de recursos e reinício (apenas `managed`).
- Docker amd64/arm64 com portas expostas.

## Evidências e preservação

O harness cria UUIDs e assuntos exclusivos por execução, remove inboxes no final e guarda relatórios JUnit/HTML, traces e screenshots em caso de falha. Não colocar tokens, chaves privadas ou conteúdos reais de OTP nos artefactos. Não executar operações administrativas, rotação ou saturação em instalações partilhadas.

## Limitações de validação

Ainda não foram instaladas as dependências `testing/` nem executados Playwright, SMTP externo ou Docker nesta alteração. Gerar e versionar `testing/package-lock.json` após `npm install --prefix testing`. O workflow E2E de momento instala o harness pelo manifesto, até existir esse lockfile.
