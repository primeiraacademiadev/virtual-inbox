# Arquitetura

Aplicação modular Node.js e React de processo único, com estado efémero em memória.

## Fluxo de mensagens

SMTP e gateway HTTP SMS recebem mensagens, resolvem o destinatário, guardam em memória e emitem eventos. Sessões GUID e SSE ligam a consola aos recursos observados.

## Limites

Sem base de dados, Redis ou Kafka. O reinício apaga caixas, mensagens e sessões. Certificados e configuração de rede podem persistir em volume.

---

[API de gestão](api.md) · [TLS](tls.md) · [SDK](sdk.md)
