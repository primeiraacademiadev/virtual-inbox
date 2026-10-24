# Começar

O Virtual Inbox recebe email real por SMTP e SMS simulados por HTTP para demonstrações e testes. Não entrega email na Internet nem envia SMS por uma operadora. Inboxes, mensagens, anexos, observadores e logs vivem em memória e desaparecem ao reiniciar. Apenas configuração e certificados persistem.

## Instalar em standalone

Usa Node.js 24 ou superior e npm. Na raiz do repositório:

```sh
npm ci --ignore-scripts
npm ci --prefix web --ignore-scripts
npm run build
npm start
```

Abre `http://127.0.0.1:3000`. O mesmo processo disponibiliza HTTPS em `https://localhost:3443`, SMTP/STARTTLS em `2525` e SMTPS em `2465`. HTTPS exige confiar explicitamente na CA local. Não é obrigatório ter `.env`, base de dados, Kubernetes ou executável OpenSSL. `npm run dev` compila a consola antes de iniciar o backend em modo watch; o Vite é opcional.

## Escolher o percurso

[Demonstração](demo.md) orienta a utilização manual; [Integração](integration.md) liga uma aplicação ao mock; [Testes automáticos](sdk.md) explica como verificar entregas; [TLS](tls.md) configura ligações cifradas. A página [API](api.md) contém a referência gerada e o download OpenAPI.

## Docker

Constrói com `docker build -t virtual-inbox:local .` e executa:

```sh
docker run --rm --name virtual-inbox -p 127.0.0.1:3000:3000 -p 127.0.0.1:3443:3443 -p 127.0.0.1:2525:2525 -p 127.0.0.1:2465:2465 -v virtual-inbox-data:/app/data virtual-inbox:local
```

O volume preserva certificados e configurações, não mensagens. Em Compose usa o nome do serviço em vez de localhost. Publica as portas demo adicionais apenas quando necessárias. As APIs de mensagens são abertas: mantém a aplicação numa rede de testes de confiança.

## Confirmar e diagnosticar

`GET /api/health` deve devolver `status: ok` e um `runId`. Consola ausente: executa `npm run build` e atualiza o browser. Ligação recusada: confirma processo, portas publicadas e `/api/connection-info`. Porta ocupada: altera a variável correspondente antes do arranque. Uma variável aparentemente ignorada pode estar sobreposta por configuração persistida; consulta [TLS](tls.md).
