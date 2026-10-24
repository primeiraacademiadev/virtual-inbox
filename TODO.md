# Recomendações priorizadas
As três recomendações bloqueantes anteriores estão feitas. A próxima mais útil é aceitar IPs e nomes sem ponto em Host, para que Docker Compose e CI funcionem sem configuração.

## Agora (bloqueantes)
[x] Corrigir a conversão dos anexos e o build (S3).
[x] Corrigir o nome de ficheiro e tornar o SSE tolerante a observadores expirados.
[x] Restringir CORS e Host com valores por omissão que funcionam localmente (S1, S2).
[ ] Aceitar por omissão, em isAllowedHost, IPs literais e nomes sem ponto, e documentar o caso Docker Compose no README.
## Próximo ciclo
[ ] Versionar package-lock.json e web/package-lock.json, usar npm ci no CI e no Dockerfile, remover openssl da imagem e verificar o docker build.
[ ] Registar uma exceção para o alerta do node-forge, para o CI não ficar vermelho por um risco não explorável (S5). O npm audit não permite exceções; o audit-ci com uma allowlist deste aviso resolve.
[ ] Avisar no arranque quando network-settings.json se sobrepõe a variáveis de ambiente, ou inverter a precedência.
[ ] Usar a mesma função para montar os nomes TLS no arranque e em PUT /admin/tls/names (incluindo TLS_SERVER_NAMES_FILE); guardar em cache a lista de hosts permitidos até o certificado mudar.
[ ] Registar também os aliases no mapa de expirados, para devolver EXPIRED_RECIPIENT em vez de UNKNOWN_RECIPIENT.
[ ] Adicionar nameConstraints à CA local (S4).
## Qualidade
[ ] Transformar server.ts numa fábrica createServer(config) sem efeitos ao importar, com rotas numa tabela; permite testes de integração HTTP, SMTP e SSE em portas efémeras.
[ ] Adicionar Prettier e ESLint e formatar o código; dividir App.tsx em páginas.
[ ] Validar os corpos JSON com esquemas e dar a cada Fault o seu código, eliminando errorCode() por substring.
[ ] Manter um contador de bytes armazenados em Sandbox em vez de somar todas as mensagens a cada entrega.

# Sonarqube
- [ ] Fix sonarcloud issues.