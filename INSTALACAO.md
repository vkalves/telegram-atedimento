# Telegram Atendimento 6.0

O projeto possui três partes integradas:

- **Dashboard:** biblioteca de conteúdos, construtor visual, execuções e logs;
- **Extensão Chrome:** áudios rápidos e controle do fluxo na conversa aberta;
- **Backend:** autenticação Telegram, mídia e motor persistente por lead.

O navegador não precisa permanecer aberto para um fluxo continuar.

## 1. Configurar ou atualizar o Supabase

1. Crie um projeto dedicado no Supabase.
2. No **SQL Editor**, execute `supabase/CONFIGURAR.sql`.
3. Execute, nesta ordem:
   - `supabase/FLUXOS-PARTE-1.sql`;
   - `supabase/FLUXOS-PARTE-2.sql`;
   - `supabase/FLUXOS-PARTE-3.sql`.
4. Em **Storage**, confirme que `ta-media` é privado.
5. Em **Project Settings → API**, copie o Project URL e uma chave secreta de
   servidor (`sb_secret_...` ou `service_role` legada).

Em uma instalação já existente, execute novamente `CONFIGURAR.sql` para liberar
os novos tipos de arquivo e depois apenas as Partes ainda não aplicadas. As
migrações são aditivas e repetíveis.

Nunca use a chave `anon`/`publishable` no backend e nunca coloque a chave
secreta em `dashboard/`, `extension/` ou no GitHub.

## 2. Publicar a API no Render

1. Mantenha `render.yaml`, `server`, `extension`, `dashboard` e `supabase` na
   raiz do repositório.
2. No Render, escolha **New → Blueprint** e selecione o repositório.
3. Preencha:

| Variável | Valor |
|---|---|
| `SUPABASE_URL` | Project URL HTTPS do Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave secreta do Supabase |
| `TELEGRAM_API_ID` | API ID de `my.telegram.org` |
| `TELEGRAM_API_HASH` | API Hash de `my.telegram.org` |
| `DASHBOARD_ORIGINS` | URL completa do dashboard |
| `EXTENSION_PASSWORD` | Senha de entrada da extensão, mínimo 8 caracteres |

O Blueprint gera `ACCESS_TOKEN` e `SESSION_ENCRYPTION_KEY`. Mantenha ambos
estáveis entre deploys. O primeiro protege o dashboard; o segundo cifra a
sessão Telegram persistida.

Depois do deploy, abra `/health`. Em seguida, autenticado pelo dashboard,
confirme `/flow-capabilities`: a versão esperada é `3`.

O estado é durável, mas uma hospedagem que suspenda o processo não executa
timers enquanto estiver desligada. Ao voltar, o worker retoma do banco sem
repetir envios confirmados. Para horários rigorosos e gatilhos sempre online,
use uma instância que não hiberne.

## 3. Publicar o dashboard

O Blueprint declara o Static Site `telegram-atendimento-dashboard`:

- **Root Directory:** vazio;
- **Build Command:** vazio;
- **Publish Directory:** `dashboard`.

Se usar outro domínio, inclua a origem HTTPS completa, sem barra final, em
`DASHBOARD_ORIGINS` e publique a API novamente. Localhost é aceito apenas para
desenvolvimento.

No primeiro acesso, informe a URL HTTPS da API e o `ACCESS_TOKEN`. Depois:

1. conecte a conta Telegram no cartão lateral;
2. cadastre áudios, textos, imagens, vídeos ou arquivos;
3. abra **Fluxos**, crie as etapas e escolha o gatilho;
4. ative o fluxo;
5. acompanhe cada lead em **Execuções por conversa**.

## 4. Instalar ou atualizar a extensão

1. Abra `chrome://extensions` e ative **Modo do desenvolvedor**.
2. Use **Carregar sem compactação** e selecione `extension`.
3. Se já estava instalada, clique em **Atualizar** no cartão da extensão.
4. Abra **Detalhes → Opções**, informe a URL da API e `EXTENSION_PASSWORD`.
5. Atualize o Telegram Web e abra uma conversa privada.

A barra preserva o envio manual de áudio com confirmação e indicador nativo de
gravação. Na mesma barra é possível selecionar um fluxo, iniciar, pausar,
continuar, cancelar, reiniciar, pular etapa ou assumir o atendimento.

## 5. Criar um fluxo

Exemplo:

1. Mensagem `Oi, {primeiro_nome}! Tudo bem?` com `digitando` por 3s.
2. Espera de 2s.
3. Áudio da biblioteca com `gravando áudio` por 4s.
4. Esperar resposta por até 2 horas.
5. Se não responder, enviar follow-up; se responder, continuar.
6. Condição: resposta contém `sim`.
7. Ramo positivo envia catálogo; ramo negativo transfere para humano.

O estado de cada lead, a última resposta, os prazos e os IDs do Telegram ficam
no Supabase. Editar um fluxo não altera execuções já iniciadas.

Consulte [FLUXOS-PARTE-3.md](FLUXOS-PARTE-3.md) para variáveis, indicadores,
gatilhos, garantias de concorrência e limitações oficiais do Telegram.

## 6. Limites e segurança

- Upload máximo de 50 MB.
- Conversas privadas somente; grupos e canais são recusados.
- O bucket é privado e prévias passam pela API autenticada.
- Apenas o backend usa a chave secreta do Supabase.
- Um único fluxo ativo pode ocupar uma conversa.
- Resultado de envio incerto exige conferência humana e nunca é repetido.
- O limite de transições interrompe loops.
- Ação manual pode pausar automaticamente a automação.

## 7. Testar localmente

Com Node.js 20 ou superior, na pasta `server`:

```bash
npm ci
FFMPEG_PATH=/usr/bin/ffmpeg npm test
```

A suíte aplica as três migrações em PostgreSQL embutido e cobre isolamento por
lead, respostas, timeout, ramificação, gatilhos, indicadores, deduplicação,
reconexão, pausa humana, arquivos, dashboard e extensão. Login e envio reais
devem receber um teste final na conta Telegram da operação.
