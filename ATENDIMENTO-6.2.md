# Televoice 6.2 — Central de atendimento

## O que mudou

### Dentro do Telegram

- Barra de áudios com busca, filtro por categoria e favoritos.
- Destinatário visível e confirmação antes do envio de áudio.
- Controles do fluxo separados dos áudios, com status e etapas.
- Botão **Atendimento** e atalho **Alt+A** para abrir a central.
- Ficha com notas internas, etiquetas, responsável, prioridade e horário de retorno.
- **Concluir e próximo** salva a ficha e abre o primeiro lead da fila prioritária.
- Fila com pendências, urgentes e retornos vencidos.
- Respostas prontas com `{nome}`, `{primeiro_nome}` e `{usuario}`. O botão copia o texto para revisão e envio manual.
- Rascunhos de notas preservados por conta/conversa enquanto a aba permanece aberta. Salve para persistir após fechar a aba.
- Um fluxo ativo pode ser assumido pelo atendente; concluir a ficha, por si só, não cancela o fluxo.

### Dashboard

- Atendimento como tela inicial, com indicadores de respostas, retornos, espera e concluídos.
- Busca por nome, usuário, etiquetas e responsável; filtros e páginas de 50 leads.
- Ordem: urgência, horário de retorno e tempo de espera. Horários de retorno usam o fuso local do navegador.
- Ficha lateral e atalhos para abrir a conversa no Telegram.
- Ações em lote para até 50 leads: urgente, aguardar, retomar em 1 hora e concluir. Falhas são informadas por operação; alterações concorrentes não são sobrescritas.
- Editor de respostas prontas por categoria (até 500 respostas exibidas).
- Biblioteca com busca, ordenação e linhas compactas.

## Ativação

1. No **SQL Editor do Supabase**, execute `supabase/ATENDIMENTO.sql` uma vez. É repetível e não apaga os dados existentes. Pressupõe a configuração inicial de `CONFIGURAR.sql`.
2. Publique o backend e a pasta `dashboard` desta versão no Render. Reinicie a API após aplicar o SQL.
3. Atualize a extensão com todos os arquivos de `extension/`, incluindo o novo `support.js`. Em `chrome://extensions`, use **Recarregar** e depois recarregue o Telegram Web. A versão do manifesto é **6.2.0**.
4. Na dashboard, abra **Atendimento → Importar 100 conversas recentes**. São examinadas as 100 conversas mais recentes do Telegram; somente conversas privadas, sem bots e sem Mensagens Salvas, entram na central. Não se trata de importar toda a conta.
5. Crie respostas em **Respostas prontas**. No Telegram, clique em **Atendimento** para abrir uma ficha.

Se o SQL ainda não estiver aplicado, o sistema informa como habilitar a central; biblioteca e fluxos continuam disponíveis. As migrações dos fluxos continuam sendo `FLUXOS-PARTE-1.sql` e `FLUXOS-PARTE-2.sql`.

## Como a fila se atualiza

- Mensagens privadas novas recebidas com a API conectada marcam o lead como precisando de resposta e reabrem seu atendimento.
- Mensagens enviadas marcam a conversa como aguardando o lead. Estados agendados/concluídos são preservados nas mensagens de saída.
- Marcar como aguardando ou concluído remove a pendência de resposta. Agendar retira o lead da fila principal até o horário definido; uma mensagem nova de entrada reabre a conversa antes desse horário.
- Os eventos são gravados por conta e conversa, com identificação da mensagem. Eventos repetidos/antigos não desfazem uma mensagem mais nova; decisões manuais mais recentes também são preservadas.
- O servidor guarda a última prévia de até 160 caracteres, não uma cópia completa do histórico.
- A captura depende da conexão da API ao Telegram. Falhas temporárias no banco ficam em uma fila limitada a 2.000 conversas e aparecem no indicador de sincronização. Essa fila pendente é em memória: depois de uma queda/reinício, importe as recentes para reconciliar. Conversas anteriores às 100 recentes não são recuperadas por essa importação.
- A dashboard atualiza a fila visível a cada 15 segundos; o painel do Telegram atualiza ao abrir ou clicar em Atualizar.
- Responsável é uma identificação organizacional. Esta versão usa a autenticação já existente da instalação e não adiciona contas individuais, permissões por atendente nem bloqueio exclusivo de uma conversa.
- Agendar cria uma pendência de retorno; não envia uma mensagem automaticamente.

## Verificação

```sh
npm ci --prefix server
npm test --prefix server
node --test extension/target.test.mjs
```

Os testes usam PostgreSQL local via PGlite e DOM simulado. Cobrem 1.001 leads, isolamento por conta, paginação, mensagens fora de ordem, concorrência, rascunhos e troca de destinatário. Não houve envio real de mensagens nem teste de carga com uma conta de produção. A capacidade final depende dos recursos do servidor/banco e dos limites do Telegram.

O navegador Chromium de teste não iniciou neste ambiente por restrição de sockets; o layout ainda deve ser conferido visualmente no Telegram Web e na dashboard após a ativação.
