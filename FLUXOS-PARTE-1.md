# Fluxos automatizados — Parte 1

## Ativar a atualização

1. No **SQL Editor do Supabase que já atende esta instalação**, execute `supabase/FLUXOS-PARTE-1.sql`. O script é aditivo e pode ser repetido; não apaga áudios, categorias, sessão Telegram ou sequências anteriores.
2. Publique esta versão do backend e do dashboard no Render. Reinicie o backend após o SQL. Sem a migração, o atendimento antigo continua disponível e a área de fluxos informa que precisa da configuração.
3. Extraia o ZIP da extensão 5.1.0. Em `chrome://extensions`, ative o modo de desenvolvedor, carregue a pasta `extension` (ou substitua os arquivos da instalação existente e clique em Recarregar). Atualize a aba do Telegram Web.
4. No dashboard, abra **Fluxos → Novo fluxo**, adicione texto, espera em segundos e áudios da biblioteca, organize com Subir/Descer e salve.
5. Abra uma conversa privada no Telegram, selecione o fluxo na barra da extensão e clique em **Iniciar fluxo**. Confirme o destinatário. Acompanhe em **Fluxos → Execuções por conversa → Ver logs**.

**O backend precisa permanecer em execução.** O `render.yaml` atual usa plano gratuito; se o serviço dormir, os fluxos também param até ele voltar. Fechar o dashboard não encerra o worker, mas não mantém um servidor gratuito acordado. Para continuidade sem depender de visitas, use uma instância sempre ativa. Os prazos e estados ficam no Supabase e são retomados no próximo início. Esperas são mínimas, com resolução aproximada de 1 segundo mais latência de rede/carga.

## O que foi preservado e acrescentado

- Base da extensão: ZIP 5.0.5 fornecido pelo usuário. Áudios manuais, identificação de destinatário, login, categorias, favoritos, ordenação, conversão e Storage permanecem no caminho existente.
- Dashboard: criar, editar, excluir, ativar/desativar e reordenar etapas; histórico de execuções e logs por lead.
- `FlowStore` usa a conexão Supabase existente; novas tabelas privadas `ta_flows`, `ta_flow_runs` e `ta_flow_logs` com acesso somente pelo backend.
- `FlowWorker` roda no backend. Texto e áudio usam `TelegramService.sendItem`; áudio usa `VoiceLibrary.get`, o mesmo arquivo OGG/Opus e o mesmo Storage. Não existe biblioteca paralela.
- Destinatário é validado novamente pelo servidor. A execução usa o ID numérico congelado, nunca a conversa que ficou aberta no navegador depois.
- O projeto atende uma conta Telegram por instalação e uma chave de acesso compartilhada; não havia cadastro separado de leads. Nesta etapa, o lead/conversa é identificado pelo ID do usuário Telegram. Não foi introduzido um sistema de contas multiempresa.

## Segurança e recuperação

- Início idempotente por UUID, trava transacional por conversa e índice único impedem dois fluxos ativos para o mesmo lead, inclusive com dois servidores.
- Repetições do mesmo início retornam a execução original. Há uma proteção adicional de 30 segundos contra cliques repetidos após conclusão de fluxos curtos. Outro fluxo ativo na conversa bloqueia o início.
- Cada etapa enviada tem uma reserva atômica no banco e token próprio. Dois workers não enviam a mesma etapa. Um envio lento não segura o processamento de outros leads.
- Fluxos guardam uma cópia das etapas e da versão ao iniciar. Editar, desativar ou excluir um fluxo afeta novos inícios; execuções existentes continuam. Para encerrá-las, use Interromper.
- Áudios continuam sendo referências à biblioteca existente. Excluir/desativar um áudio antes da etapa faz o fluxo parar com erro. Substituir seu arquivo faz os próximos envios usarem a versão atual da biblioteca.
- Se houver falha ANTES do envio, estado `error`. Se o Telegram puder ter recebido a mensagem mas faltar confirmação, estado `uncertain`: sem repetição automática. Quedas durante envio são sinalizadas após 10 minutos; execuções incertas bloqueiam novo fluxo naquela conversa até conferência e encerramento manual.
- Interromper durante envio aguarda o resultado desse envio e impede etapas seguintes. Não desfaz mensagens já entregues.
- Não há promessa de entrega exatamente uma vez diante de falha de rede entre Telegram e banco. A escolha conservadora é parar para conferência em vez de arriscar duplicar. Não há botão de reenvio automático.
- A proteção acima cobre os novos fluxos. O mecanismo legado `/jobs` de envio manual continua separado e em memória, preservado como solicitado.

## Verificação

Na pasta `server`, execute `npm ci --ignore-scripts` e `FFMPEG_PATH=/usr/bin/ffmpeg npm test` (também requer `ffprobe`). Os testes de banco usam PostgreSQL embarcado via PGlite, exclusivamente como dependência de desenvolvimento. `node --test extension/target.test.mjs` na raiz verifica identificação/troca de conversa.

Foram incluídos testes de migração repetível, acesso negado a anon, ordem texto/espera/áudio, isolamento entre leads, início repetido, reserva exclusiva de etapas, alteração de fluxo durante execução, recuperação, falha de confirmação, cancelamento, autenticação e regressões existentes (incluindo conversão real de áudio e vídeo).

Não foi realizado envio a contatos reais nem aplicada a migração no Supabase de produção: essas verificações exigem a instalação configurada. Os envios nos testes são simulados; o motor SQL e as conversões de mídia são executados de verdade.

## Preparação para a Parte 2

Etapas tipadas, snapshot versionado, worker separado, estados e logs persistentes dão base às próximas etapas. Não foram adicionados espera por resposta, condições, ramificações, gatilhos, follow-up, variáveis ou indicadores digitando/gravando aos fluxos. Texto como `{nome}` é enviado literalmente. Recursos manuais anteriores não foram removidos.

Resultado desta entrega: 34 testes de servidor/banco/interfaces e 2 testes de destinatário aprovados. O editor e a extensão foram exercitados com DOM simulado (criar, reordenar, editar, desativar, excluir e iniciar com proteção contra duplo clique). A inspeção visual em navegador real não pôde ser concluída porque o download do Chromium ficou indisponível neste ambiente.
