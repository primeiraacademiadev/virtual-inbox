# Arquitetura e limites

Um processo Node.js serve consola e API por HTTP/HTTPS. SMTP/STARTTLS/SMTPS recebem email. Listeners HTTP auxiliares recebem SMS simulado ou enviam email demo. Todos partilham a mesma Sandbox em memória.

A Sandbox gere inboxes, mensagens, bytes de anexos, observadores, sequências, log circular e TTL. O CertificateManager gere identidade e atualização dos listeners. O catálogo HTTP alimenta encaminhamento e OpenAPI. Os guias da consola são os mesmos ficheiros localizados do repositório.

Reiniciar elimina mensagens e sessões e altera `runId`; não é um armazenamento persistente de email. Só configuração de rede e certificados persistem. Destinos desconhecidos/expirados são capturados em anomalias, mas a saturação pode rejeitar entregas: não existe garantia de retenção ilimitada.

Limites globais por omissão: 10000 mensagens, 2000 inboxes mais as de sistema, 500 observadores, 256 MiB contabilizados, 2000 logs, MIME SMTP completo de 20 MiB, anexo individual de 20 MiB, corpo HTTP de 32 MiB, SMS de 64 KiB e 20 anexos. Configura-os por ambiente; consulta `.env.example`. O overhead MIME/base64 conta para o tamanho da mensagem. A quota de bytes da aplicação não é um limite exato de RSS do processo.

A API é aberta por desenho numa rede de testes confiável. CORS/Host não autenticam clientes de rede. Protege tokens administrativos e chaves CA. Os streams de observadores incluem logs globais; as subscrições não isolam tenants.

Os testes unitários verificam lógica interna; o harness verifica protocolos reais; o smoke Docker é outra camada. A aprovação de uma camada não certifica todas as restantes.
