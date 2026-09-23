# Fluxos automatizados — Parte 3 (motor completo)

Esta parte completa o motor persistente iniciado pelas Partes 1 e 2. Ela é
aditiva: não remove a biblioteca, a sessão Telegram, os fluxos antigos nem o
envio manual de áudios da extensão.

## Atualização de uma instalação existente

Com o backend parado durante a migração:

1. Execute novamente `supabase/CONFIGURAR.sql` para ampliar os tipos MIME do
   bucket privado `ta-media`.
2. Se ainda não tiver aplicado as etapas anteriores, execute, nesta ordem:
   `supabase/FLUXOS-PARTE-1.sql` e `supabase/FLUXOS-PARTE-2.sql`.
3. Execute `supabase/FLUXOS-PARTE-3.sql`.
4. Publique o backend, dashboard e extensão deste branch.
5. Confirme no endpoint autenticado `/flow-capabilities` que a versão é `3`.

`CONFIGURAR.sql` e `FLUXOS-PARTE-3.sql` podem ser executados novamente. Se for
necessário reaplicar toda a cadeia, preserve obrigatoriamente a ordem Parte 1 →
Parte 2 → Parte 3; nunca execute uma parte antiga isoladamente depois da Parte
3, pois ela contém versões anteriores das funções. As execuções em andamento
mantêm o snapshot do fluxo com que começaram; uma edição só afeta novas
execuções.

## Etapas disponíveis

- mensagem de texto;
- conteúdo da biblioteca: áudio de voz, texto, imagem, vídeo MP4 ou arquivo;
- espera em segundos ou minutos (persistida como segundos);
- espera real por nova resposta do lead, com ou sem prazo;
- follow-up, encerramento, continuação ou desvio quando o prazo expira;
- condição `contém`, `é igual a` ou `começa com`, aplicada à última resposta;
- transferência para atendimento humano;
- encerramento explícito.

Cada etapa tem um identificador estável. Condições e timeouts apontam para esse
identificador, portanto reorganizar os cards não quebra o destino do ramo.

## Variáveis

Textos digitados no fluxo e textos reutilizáveis da biblioteca aceitam:

| Variável | Valor |
|---|---|
| `{nome}` / `{name}` | nome completo disponível no Telegram |
| `{primeiro_nome}` / `{first_name}` | primeiro nome |
| `{username}` | username sem `@` |
| `{usuario}` | username com `@` |
| `{telefone}` / `{phone}` | telefone, quando a conta o disponibiliza |
| `{id_conversa}` / `{conversation_id}` | ID privado da conversa |
| `{resposta}` / `{reply}` | texto da última resposta aceita pelo fluxo |

Variáveis desconhecidas permanecem no texto, facilitando adicionar novos
campos no backend sem corromper mensagens salvas.

## Gatilhos

- **Manual:** botão `Iniciar fluxo` na conversa.
- **Primeira mensagem:** primeira mensagem recebida do lead depois que a Parte
  3 começou a registrar leads.
- **Nova conversa:** primeira mensagem ou nova mensagem após 24 horas sem
  entrada desse lead.
- **Palavra-chave:** comparação sem diferenciar maiúsculas/minúsculas.

Updates privados chegam pelo cliente Telegram autenticado no backend, são
deduplicados por conta, conversa e ID da mensagem e nunca passam pelo browser.
Se já existir uma execução ativa na conversa, um gatilho não abre outra.

## Indicadores nativos do Telegram

O backend usa oficialmente `messages.setTyping`; não desenha um indicador falso
na extensão ou no dashboard.

| Configuração | Ação MTProto |
|---|---|
| Digitando | `SendMessageTypingAction` |
| Gravando áudio | `SendMessageRecordAudioAction` |
| Enviando áudio | `SendMessageUploadAudioAction` |
| Enviando foto | `SendMessageUploadPhotoAction` |
| Enviando vídeo | `SendMessageUploadVideoAction` |
| Enviando arquivo | `SendMessageUploadDocumentAction` |
| Cancelar indicador | `SendMessageCancelAction` |

O tempo configurável vai de 0 a 15 segundos. O backend renova ações longas a
cada quatro segundos. O aplicativo Telegram do lead decide o texto e a forma
visual final; a API não oferece controle sobre a tradução exibida. Não existe
uma ação genérica oficial para “preparando mensagem”.

Documentação oficial:

- <https://core.telegram.org/method/messages.setTyping>
- <https://core.telegram.org/type/SendMessageAction>
- <https://core.telegram.org/api/updates>

## Garantias de execução

- um índice parcial impede dois fluxos ativos na mesma conversa;
- cada execução guarda conversa, perfil, snapshot, etapa e resposta no banco;
- tokens de claim, espera, polling e controle invalidam callbacks antigos;
- a mesma atualização, resposta, comando ou mensagem enviada é idempotente;
- uma queda antes do `dispatch` é recuperável; depois dele, resultado sem
  confirmação vira `uncertain` e nunca é reenviado automaticamente;
- uma resposta rápida ocorrida antes de armar o polling é encontrada pelo ID da
  mensagem automática anterior;
- mensagem manual durante envio é reconciliada com o ID confirmado: o próprio
  update automático é ignorado, e uma mensagem realmente humana pausa depois
  da confirmação;
- cancelamento, pausa e atendimento humano são verificados novamente antes do
  limite irreversível do envio;
- o limite configurável de transições (20 a 1.000) interrompe loops;
- respostas sempre conferem conta Telegram, conversa, remetente, etapa e token.

O navegador pode ser fechado. O backend e o Supabase continuam responsáveis
pela execução. Se a hospedagem suspender o processo, o estado permanece seguro
e é retomado quando o backend voltar; esperas não ficam armazenadas somente em
memória.

## Logs

O histórico registra início, gatilho, espera, resposta, timeout, condição,
indicador, envio, pausa humana, retomada, salto, reinício, proteção contra loop,
erro e conclusão. Falha no indicador é apenas um aviso: ela não transforma um
envio ainda não iniciado em resultado incerto.

## Formatos da biblioteca

- áudio: MP3, M4A, WAV, AAC, OGG, OPUS, MP4 ou WEBM, convertido para OGG/Opus;
- imagem: JPG ou PNG;
- vídeo: MP4, otimizado para envio com streaming;
- arquivo: PDF, DOC, DOCX, XLS, XLSX, TXT, CSV ou ZIP;
- texto: até 4.096 caracteres.

O limite por upload continua em 50 MB e o bucket permanece privado.
