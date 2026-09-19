# Fluxos automatizados — Parte 2

Esta atualização acrescenta espera real por resposta, recuperação pelo histórico do Telegram, controles individuais e timeout. Usa a base da Parte 1 e a mesma sessão Telegram, biblioteca de áudios e Supabase.

## Instalação

1. A Parte 1 precisa estar incluída no código publicado e seu SQL aplicado. No início desta entrega, o PR #2 da Parte 1 ainda estava aberto, fora da `main`.
2. Pare o backend durante a migração para não misturar o worker anterior com as novas funções. Execute **somente `supabase/FLUXOS-PARTE-2.sql`** no mesmo Supabase. Para instalação nova: primeiro `CONFIGURAR.sql`, depois `FLUXOS-PARTE-1.sql`, por último `FLUXOS-PARTE-2.sql`. Não execute o SQL da Parte 1 novamente depois do da Parte 2, pois ele contém as funções anteriores.
3. Publique backend e dashboard desta versão e reinicie o backend. Sem a migração da Parte 2 confirmada, o novo worker fica desabilitado. Áudios manuais e demais áreas anteriores continuam disponíveis. Nenhum dado de biblioteca ou sessão é apagado pelo novo SQL.
4. Atualize a pasta `extension` para a versão **5.2.0**, recarregue a extensão em `chrome://extensions` e atualize a aba do Telegram Web.
5. No dashboard, acrescente **Esperar resposta do lead** ao fluxo. O padrão é sem limite de tempo. Para duas horas, informe `7200` segundos. Escolha a ação de timeout e, para follow-up, escreva a mensagem.
6. Abra uma conversa privada no Telegram e inicie o fluxo. A barra mostra nome, status e etapa. Dashboard e extensão oferecem os controles da execução.

O processo backend precisa estar ativo e conectado ao Telegram. Fechar navegador/extensão não interfere. Se o servidor dormir ou reiniciar, as esperas permanecem no Supabase e a consulta ao histórico recupera respostas quando ele volta. Isso não mantém um servidor gratuito acordado. Esta entrega não aplica SQL nem publica serviços de produção automaticamente.

## Semântica da espera

- `reply` é a nova etapa. `timeoutSeconds: 0` significa sem limite; o máximo configurável é 30 dias.
- Antes de mostrar “aguardando resposta”, há uma breve preparação que registra a conta e o último ID do histórico daquela conversa. Só mensagens posteriores a esse marco podem liberar a etapa. Mensagens anteriores à ativação da espera não são aproveitadas.
- Conta, conversa, remetente, execução, índice de etapa e token único da espera são conferidos no backend/banco. Mensagens enviadas pelo atendente, mensagens de serviço e histórico de outra conversa não são respostas válidas. Texto, áudio e outras mídias recebidas do lead são aceitos; não há análise do conteúdo.
- A verificação usa consultas autenticadas ao histórico pela sessão já existente do Telegram, com paginação crescente. Não depende de DOM, localStorage ou webhook público. Não há endpoint no navegador para fabricar respostas.
- Cada resposta aceita é registrada uma vez por conta/conversa/ID da mensagem. Um lote libera no máximo a espera atual. A próxima espera captura um novo marco, impedindo que o restante da mesma rajada libere outra etapa.
- O monitor verifica periodicamente as esperas (normalmente a cada poucos segundos, sujeito a carga, rede e limites do Telegram). Consultas lentas de um lead não bloqueiam os demais. Os estados e cursores ficam no Supabase.
- Ao reiniciar, o histórico é consultado antes de expirar uma espera. Resposta enviada dentro do prazo tem prioridade mesmo que o servidor só a veja depois. Erro de consulta, conta trocada ou página incompleta não é interpretado como ausência de resposta.
- Mensagens apagadas do Telegram antes de serem consultadas não podem ser recuperadas pelo histórico. Datas do Telegram têm precisão de segundos; o timeout usa uma margem de um segundo para fechar a consulta.

## Controles por execução

| Controle | Comportamento |
|---|---|
| Pausar | Congela o tempo restante e impede novos envios/respostas de avançarem. |
| Continuar | Retoma a espera por tempo restante. Se aguardava resposta, registra um novo marco e exige nova mensagem; respostas durante a pausa são ignoradas. |
| Assumir atendimento | Pausa e identifica atendimento humano somente naquela execução. A retomada é manual. |
| Cancelar | Encerra sem executar etapas seguintes. Um envio já iniciado no Telegram pode terminar. |
| Reiniciar | Cancela a execução anterior e cria outra desde a primeira etapa, preservando histórico e a cópia original do fluxo. Pode repetir mensagens já enviadas, com confirmação explícita. |
| Pular etapa | Avança somente uma etapa. Se pausado, permanece pausado. |

Durante um envio já autorizado no Telegram, pausa/cancelamento aparecem como pendentes até a confirmação. Não é possível recolher uma mensagem já em trânsito. Pular/reiniciar são recusados durante esse envio. Um envio de resultado incerto exige conferência e cancelamento antes de reiniciar.

Todos os comandos usam UUID de idempotência e versão do estado: clique repetido, resposta de uma tela desatualizada e repetição de rede não executam o comando duas vezes. Uma conversa só pode ter uma execução ativa, inclusive pausada ou esperando resposta. Cancelar/reiniciar invalida consultas antigas em trânsito.

## Timeout e follow-up

- **Encerrar:** marca como concluído e não envia etapas seguintes.
- **Continuar:** conclui a espera e segue para a próxima etapa.
- **Follow-up:** envia um único texto configurado pelo mesmo caminho de envio da Parte 1; depois segue para a próxima etapa. Não repete indefinidamente e não cria ramificações. Para esperar outra resposta, coloque outra etapa de espera depois.

Resposta e timeout disputam a mesma linha bloqueada no banco. Apenas um resultado é aplicado. O follow-up tem reserva exclusiva e a mesma proteção de envio incerto da Parte 1; ausência de confirmação não provoca reenvio automático.

## Persistência e logs

`ta_flow_runs` ganhou estado de espera/pausa, token da espera, conta Telegram, cursor de mensagem, prazo, reserva de consulta, versão dos controles e vínculo de reinício. `ta_flow_inbound` registra respostas consumidas; `ta_flow_commands` registra comandos idempotentes. As novas tabelas têm RLS e acesso apenas pela chave do servidor.

Os logs indicam início, texto/áudio enviado, espera, resposta detectada, retomada, pausa/atendimento humano, cancelamento, etapa pulada, reinício, timeout, follow-up e erros de consulta. O texto da resposta do lead não precisa ser armazenado para tomar essas decisões.

Os controles atingem os novos fluxos persistentes. Os envios manuais legados continuam usando o caminho já existente. Edições do modelo de fluxo continuam valendo somente para novos inícios; reiniciar uma execução usa sua cópia original de etapas.

## Testes e limites de validação

Na raiz: `FFMPEG_PATH=/usr/bin/ffmpeg npm --prefix server test` e `node --test extension/target.test.mjs`.

Testes incluem: múltiplos leads, conta/conversa/remetente corretos, IDs repetidos, mensagens antigas e rajadas, páginas de histórico, pausa antes/depois da autorização de envio, timeout com resposta anterior ao prazo, follow-up único e resultado incerto, comandos repetidos/desatualizados, reinício e retorno de consultas antigas, persistência após fechar/reabrir o banco, permissões, editor e controles da extensão, além das regressões da Parte 1. Banco SQL e conversões de mídia são reais em ambiente isolado; Telegram e interfaces são simulados.

Não houve envio a contatos reais, migração de Supabase de produção ou publicação no Render. A validação visual em navegador real e o teste final com a conta conectada permanecem para o ambiente configurado.

Não foram implementados digitando, gravando, condições de conteúdo, caminhos alternativos, gatilhos avançados, variáveis ou IA. `{nome}` continua literal. A Parte 3 pode acrescentar comportamentos usando os tipos de etapas, tokens e estados já definidos.

Resultado desta entrega: **61 testes aprovados, nenhum teste ignorado** (59 no servidor/banco/interfaces e 2 na identificação de destinatário).
