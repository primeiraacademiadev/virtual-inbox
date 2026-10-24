# Ligações e TLS

HTTP e HTTPS funcionam em paralelo. HTTPS não é SMTP: email usa plain/STARTTLS em 2525 e TLS implícito em 2465. A identidade ativa é partilhada por HTTPS, demo HTTPS, STARTTLS e SMTPS.

## Identidade automática local

`TLS_MODE=auto` é o default. O arranque gera CA local e certificado através de Node.js, sem executável OpenSSL. O certificado do servidor dura 30 dias e é regenerado no arranque ou na gestão de SAN quando restam menos de sete dias. Não existe temporizador periódico de renovação em processo vivo. A CA dura 365 dias; planeia a substituição e a confiança dos clientes antes de expirar.

Descarrega a [CA pública](/api/tls/ca.pem) ou o [certificado do servidor](/api/tls/certificate.pem). Confirma o fingerprint da CA por um canal confiável antes de confiar nela. Prefere um ficheiro CA específico do cliente à instalação global. Em Windows, importar para Autoridades de Certificação de Raiz Fidedigna do utilizador é uma decisão explícita de confiança; nunca importes `ca-key.pem`. A CA local não é automaticamente aceite pelo browser nem é uma CA pública.

## Nomes, endereços e portas

Os SAN devem conter os DNS/IP usados pelos clientes, incluindo o nome do serviço Compose. A lista combina `TLS_SERVER_NAMES`, `TLS_SERVER_NAMES_FILE`, o ficheiro gerido pela consola e `PUBLIC_HOST`. O JSON usa `{"dns":["localhost"],"ips":["127.0.0.1","::1"]}`. IPv6 com IPv4 embutido é suportado; scopes como `%eth0` são rejeitados. Endereços wildcard de escuta são excluídos.

Na página Ligações e TLS, introduz as adições geridas pela consola e regenera/aplica. Substitui apenas essas adições; os nomes do ambiente e ficheiro mantêm-se. O novo certificado é aplicado sem reiniciar. Alterar SAN não cria DNS nem muda as interfaces de escuta. Alterar hosts/portas exige reinício.

## Administração

Define `ADMIN_TOKEN` num `.env` privado ou no ambiente e reinicia. Abre a página por HTTPS confiável e fornece o token. A API de mensagens continua aberta. Nunca envies chaves privadas a serviços que não controlas nem as incluas em logs/relatórios. Um token correto por HTTP é recusado.

## Importar ou montar certificados externos

O upload recebe certificado PEM com cadeia (folha primeiro, depois intermédios) e chave privada PEM correspondente, sem palavra-passe. O gestor valida datas e correspondência da chave, ativa e persiste. Material inválido deve preservar a identidade anterior. O upload prevalece no arranque seguinte.

Em standalone ou Docker usa `TLS_MODE=external`, `TLS_CERT_FILE` e `TLS_KEY_FILE`. Monta os secrets como ficheiros read-only; não coloques chaves na imagem. As alterações são verificadas aproximadamente a cada dez segundos enquanto a origem externa estiver selecionada. A confiança é configurada nos clientes; instalar CAs na imagem não torna o certificado aceite nos browsers.

Para voltar ao automático após upload, regenera SAN em modo auto. Para voltar ao externo, para o processo, faz backup e remove o ficheiro de seleção da identidade importada, configura os caminhos externos e reinicia. Guarda o material anterior para recuperação.

## Precedência e erros

Configuração de rede persistida prevalece sobre ambiente, que prevalece sobre defaults. O arranque avisa quais chaves foram sobrepostas. Faz backup/edita `network-settings.json` com o processo parado para voltar a controlar pelo ambiente. O volume persiste configuração/certificados, não mensagens.

Nome incompatível: corrige SAN/servername. CA desconhecida: fornece a CA pública correta. Erro SSL de protocolo: confirma a porta TLS (3443/3444/2465), não HTTP/SMTP plain. `403` administrativo: HTTPS e token. `409` na regeneração: exige modo auto. Não desatives a validação de certificados como solução.
