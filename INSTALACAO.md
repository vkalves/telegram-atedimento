# Telegram Atendimento 4.0

O projeto agora possui duas interfaces separadas:

- **Dashboard:** administra a biblioteca de áudios.
- **Extensão Chrome:** mostra somente uma barra compacta abaixo do campo de mensagem do Telegram Web e envia o áudio para a conversa aberta.

O Render continua sendo a API e o responsável por autenticar a conta do
Telegram, converter os arquivos para OGG/Opus e enviar a mensagem de voz. O
Supabase guarda os metadados e o Storage privado.

## 1. Configurar o Supabase

1. Crie um projeto no plano Free.
2. Abra **SQL Editor**, crie uma consulta e execute o conteúdo completo de
   `supabase/CONFIGURAR.sql`.
3. Em **Storage**, confirme o bucket privado `ta-media`.
4. Em **Project Settings → API**, copie o **Project URL** e uma chave secreta de
   servidor (`sb_secret_...` ou `service_role` em Legacy API Keys).

Não use a chave `anon`/`publishable` no Render para esta instalação e nunca
coloque a chave secreta em `dashboard/`, `extension/` ou no GitHub.

## 2. Publicar a API no Render

1. Envie o conteúdo deste repositório ao GitHub, mantendo `render.yaml`,
   `server`, `extension`, `dashboard` e `supabase` na raiz.
2. No Render, escolha **New → Blueprint** e selecione o repositório.
3. Preencha as variáveis solicitadas:

| Variável | Valor |
|---|---|
| `SUPABASE_URL` | Project URL HTTPS do Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave secreta do Supabase |
| `TELEGRAM_API_ID` | API ID de `my.telegram.org` |
| `TELEGRAM_API_HASH` | API Hash de `my.telegram.org` |
| `DASHBOARD_ORIGINS` | URL do dashboard; pode preencher depois |
| `EXTENSION_PASSWORD` | Senha simples usada apenas para entrar na extensão |

O Blueprint gera `ACCESS_TOKEN` e `SESSION_ENCRYPTION_KEY`. Não troque esses
valores entre deploys: a sessão Telegram é cifrada com o segundo segredo, e o
ACCESS_TOKEN é usado pelo dashboard. A extensão usa `EXTENSION_PASSWORD`.

Depois que o serviço ficar **Live**, copie a URL HTTPS da API. O Render Free
pode dormir após inatividade; o primeiro acesso pode levar algum tempo.

## 3. Publicar o dashboard

O Blueprint `render.yaml` já declara o Static Site `telegram-atendimento-dashboard`
junto com a API. Ao criar ou sincronizar o Blueprint no Render, confirme que os
dois serviços foram aplicados. Se o endereço abrir `404 Not Found` com
`no-server`, o Static Site ainda não foi sincronizado ou está sem publicação.

A configuração equivalente é:

- **Root Directory:** vazio (raiz do repositório)
- **Build Command:** vazio
- **Publish Directory:** `dashboard`

Se você mantiver um domínio diferente do padrão, informe a origem completa, sem
barra no final, em `DASHBOARD_ORIGINS` no serviço web da API e faça novo deploy.
O endereço padrão `https://telegram-atendimento-dashboard.onrender.com` já é
aceito pela API. Para teste local, execute um servidor estático na pasta
`dashboard` em `http://localhost:4173`; essa origem também é aceita.

## 4. Instalar a extensão

1. Abra `chrome://extensions`.
2. Ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione a pasta `extension`.
4. Abra **Detalhes → Opções** da extensão.
5. Digite a senha definida em `EXTENSION_PASSWORD`; autorize o acesso quando o
   Chrome solicitar.
6. Abra ou atualize o Telegram Web.

Não haverá popup, painel lateral ou menu de administração. Ao abrir uma
conversa privada compatível, a extensão identifica o destinatário pela URL e
mostra apenas os áudios ativos em uma barra horizontal abaixo do campo de
mensagem. Use as setas ou o deslizador para acessar os demais áudios. Um clique inicia o envio; durante a confirmação os botões ficam
desabilitados para evitar duplicidade.

A autenticação da conta Telegram continua sendo feita pela API e usa o mesmo
fluxo existente, agora apresentado no dashboard. A extensão apenas consulta o
destinatário atual e solicita o envio; ela não exibe formulário de login nem
recebe a chave do Supabase.

## 5. Supabase: é preciso criar algo novo?

Não. A versão 4.0 reutiliza `public.ta_state` e o bucket privado `ta-media`.

Ao iniciar, o backend migra metadados antigos para os campos `active`,
`sortOrder` e `updatedAt`, preserva favoritos/arquivos e cria a categoria
`Geral` no registro `categories` de `ta_state`. Não crie políticas públicas.

## 6. Limites e segurança

- Uma mensagem de voz continua limitada a 50 MB na entrada e na saída.
- O bucket `ta-media` permanece privado; o dashboard acessa prévias via API.
- O ACCESS_TOKEN é administrativo e deve ficar apenas no dashboard privado.
- A senha da extensão deve ter pelo menos 8 caracteres.
- A extensão atende conversas privadas, como a versão anterior. Grupos,
  canais e links fora de `web.telegram.org` são recusados.
- O Render gratuito pode hibernar, e conversões podem demorar em arquivos
  grandes. Aguarde o estado final antes de clicar novamente.

## 7. Teste local do backend

Na pasta `server`, com Node.js 20 ou superior:

```bash
npm ci
FFMPEG_PATH=/usr/bin/ffmpeg npm test
```

Os testes usam clientes e armazenamento simulados; login real, SQL real e
envio real precisam ser validados nas suas contas.
