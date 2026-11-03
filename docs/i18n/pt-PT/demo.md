# Experimentar a consola

Segue [Começar](overview.md), abre `http://127.0.0.1:3000` e usa o menu hambúrguer para Workspace, Ligações e TLS, Documentação e API. O seletor de língua altera a apresentação; identificadores e propriedades técnicas não são traduzidos.

## Adicionar uma inbox

Usa o controlo de adicionar no grupo email ou SMS da barra lateral. Campo vazio gera um endereço. Um endereço preenchido procura uma inbox existente; se não existir, confirma a criação. O formato seleciona automaticamente o tipo. A bandeira altera o locale da identidade; a estratégia define o padrão do email; o indicativo controla o prefixo telefónico; SAFE escolhe dados sintéticos. O relógio revela o TTL em segundos. As opções persistem por separador do browser, exceto o identificador.

O identificador REST é o UUID devolvido, não o endereço de email nem o telefone. Os controlos de copiar dão feedback. Remover uma subscrição não equivale necessariamente a eliminar a inbox: confirma a ação de eliminação quando pedida.

## Enviar e consultar

Seleciona uma inbox e abre o envio. O destinatário é a própria inbox. Email percorre o listener SMTP local; SMS entra pelo endpoint HTTP de demonstração, sem operadora externa. Consulta detalhes e anexos; o download preserva os bytes originais. O estado lida/não lida pertence à consola: consultar mensagens pela API não as consome.

O painel de logs pode ser minimizado, apresentado sob a inbox ou expandido. A barra lateral também colapsa. Documentação contém os procedimentos; API mostra o catálogo gerado. Se uma mensagem não aparecer, consulta os logs e a inbox de sistema `anomalies@sandbox.test` (email) ou `+999000000000` (SMS). O envio para uma inbox não registada **não a cria nem é rejeitado por esse motivo**: é aceite e capturado em anomalias, dentro das quotas. Consulta `originalRecipient` e `captureReason` (`UNKNOWN_RECIPIENT` / `EXPIRED_RECIPIENT`). Para localizar a inbox de sistema e consultar as mensagens por UUID, segue [Integração](integration.md).

## Erros esperados

`404`: inbox/sessão inexistente ou expirada. `409`: endereço existente. `413`: mensagem/anexo demasiado grande. `507`: capacidade global esgotada. Elimina dados de teste ou aumenta deliberadamente o limite. Um reload pode recuperar o observador; depois de reiniciar o servidor, cria nova sessão e inbox, porque o estado não é persistido.
