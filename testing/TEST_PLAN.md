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

## Ciclo de vida TLS — extensão de 24-10-2026

Testes acrescentados:
- `test/tls-lifecycle.test.ts`: chave incompatível, certificado expirado, rollback simulado em listener, persistência automática perante nomes inalterados, regeneração SAN e renovação automática quando restam menos de sete dias.
- `testing/scenarios/tls/restart.spec.ts`: segundo processo Node com o mesmo diretório de certificados temporários; compara fingerprint do certificado HTTPS antes/depois do novo arranque.
- `testing/scenarios/tls/rotation.spec.ts`: fingerprints reais de HTTPS, SMTPS e STARTTLS, envio após rotação e rejeição de importação inválida.

A suite de protocolos deve agora ter 14 testes (sem alterar os três de browser), e a suite unitária deve incorporar quatro novos testes. Confirmar ambos por execução real. A renovação automática é validada na operação `ensureLocalTls` (invocada no arranque e nas operações de gestão), **não** por um agendamento contínuo de rotação em processo vivo.

O handler SMTP reconhece a desconexão específica `SocketError: Socket closed while initiating TLS` como interrupção de transporte esperada; quaisquer outros erros continuam visíveis nos logs. Validar a ausência de crash e a inexistência de erros inesperados durante as execuções.

## Resiliência e concorrência — extensão de 24-10-2026

Os testes `testing/scenarios/resilience/` exigem `VI_RUN_MODE=managed` e usam o processo isolado do runner. Os limites desse processo são intencionalmente reduzidos: 40 inboxes, 80 mensagens, 40 observadores, SMS até 512 bytes, 3 anexos, espera até 5000 ms.

Cenários incluídos:
- inbox com TTL de um segundo e posterior captura na inbox de anomalias;
- `wait-for-message` a terminar com HTTP 204 sem consumo;
- 20 mensagens SMS entregues em concorrência, sem duplicação de identificadores;
- 40 inboxes criadas, a 41.ª rejeitada com 507 e healthcheck disponível;
- payload SMS de 513 bytes rejeitado com 413 e envio seguinte aceite;
- pedido long-poll abortado pelo cliente sem indisponibilidade do servidor;
- cliente SMTP a terminar abruptamente, seguido de validação de healthcheck e envio.

Estes testes são funcionais de resiliência com limites reduzidos, **não** benchmarks de throughput. A suite completa passa de 17 para 24 cenários previstos. A execução em Windows, CI e Docker deve ser confirmada antes de marcar como validada.
