# Virtual Inbox — trabalho priorizado

Atualização: 2026-10-24. Acompanhamento do PR #8 e da avaliação de arquitetura e segurança.

## Concluído e validado anteriormente
- [x] Normalização de anexos, nomes seguros para download e quota MIME.
- [x] CORS/Host restritos com suporte para IPs literais e nomes de serviço Docker.
- [x] SMTP, STARTTLS, SMTPS, SSE e consola cobertos pelo Test Harness.
- [x] Certificados locais com `node:crypto`, sem `node-forge`.
- [x] Lockfiles raiz, web e testing; build e smoke test da imagem Docker.
- [x] `testing/reports/` ignorado pelo Git, com artefactos publicados pelo CI.

## Em validação — PR #8 (segurança e higiene)
- [ ] Token de administração aleatório criptograficamente no harness.
- [ ] Validar os destinos relativos da API e SSE/documentação da consola.
- [ ] Fixar por SHA actions de `container.yml`, Sonar e `upload-artifact`.
- [ ] Substituir `npm install --prefix testing` por `npm ci --prefix testing`.
- [ ] Atualizar README sobre geração TLS e regra de Host/Compose; corrigir README do harness.
- [ ] Confirmar todas as gates do Pull Request antes do merge.

## Próxima intervenção: robustez e segurança
- [ ] Analisar alertas Sonar restantes: distinguir parsers `http:` e listeners HTTP locais intencionais de pedidos inseguros reais; justificar/suprimir apenas com evidência.
- [ ] Corrigir ou rejeitar SAN IPv6 com IPv4 embutido em `ipBytes`; testar `::ffff:127.0.0.1`.
- [ ] Unificar a origem dos nomes TLS no arranque e em `PUT /admin/tls/names` (incluindo `TLS_SERVER_NAMES_FILE`).
- [ ] Registar aliases expirados em `Sandbox`.
- [ ] Avisar quando `network-settings.json` prevalece sobre variáveis de ambiente.
- [ ] Avaliar `nameConstraints` na CA local.
- [ ] Remover `openssl` da imagem Docker se confirmar ausência de uso.

## Qualidade e arquitetura
- [ ] Cobertura real de todo `src/` com `c8 --all --include=src`, incluindo `server.ts`; avaliar cobertura dos E2E.
- [ ] Separar `server.ts` numa fábrica de servidores sem efeitos ao importar.
- [ ] Adicionar ESLint/Prettier e decompor `web/src/App.tsx`.
- [ ] Esquemas de validação JSON e códigos `Fault` explícitos.
- [ ] Contador incremental de bytes armazenados em `Sandbox`.
- [ ] Inspecionar recomendações SonarCloud de forma contínua; gates do PR são obrigatórias.
