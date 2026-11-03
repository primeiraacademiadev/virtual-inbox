# Virtual Inbox — Guia de utilização

O Virtual Inbox é uma sandbox efémera para receber mensagens de email e SMS em testes manuais e automatizados.

## Início rápido

1. Abre a consola e cria uma inbox em **Inboxes — Email** ou **Inboxes — SMS**.
2. Deixa o identificador vazio para gerar automaticamente o destinatário.
3. Escolhe a inbox e usa o botão **+** para enviar uma mensagem de demonstração.
4. Inspeciona a mensagem e os eventos na área de **Live Logs**.

As mensagens e os destinatários são mantidos em memória; desaparecem quando o servidor reinicia. O TTL por omissão é de 30 minutos.

## Clientes de email

O servidor recebe SMTP na porta configurada por `SMTP_PORT` (omissão 2525). Quando existe identidade TLS instalada, esse listener anuncia **STARTTLS**; o listener de **SMTPS** usa `SMTPS_PORT` (omissão 2465).

Configura o cliente para usar o nome DNS indicado em **Ligações e TLS**. O certificado deve ser confiável para o cliente. Podes descarregar o certificado público na mesma página. Nunca é necessário instalar a chave privada do servidor no cliente.

## SMS

Envia `POST /sms/messages` com o remetente, destinatário e corpo. Não é enviado nenhum SMS real.

## Observadores e automação

Cada consola tem uma sessão de observação GUID. A subscrição de uma inbox já existente não altera o seu TTL. A API `POST /mailboxes/:id/wait-for-message` permite esperar por mensagens filtrando remetente, assunto ou corpo.

## Referências

Consulta a página **API** para os endpoints de gestão, recebimento e observação. Os endpoints exclusivos de demonstração não aparecem nessa referência.
