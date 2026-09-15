# Instalar pelos painéis: Supabase, GitHub e Render

Versão 3.0.1. Este pacote ainda precisa ser publicado. A arquitetura é uma instalação
privada para uma conta de Telegram, sem cadastro de clientes ou cobrança.

## 1. Preparar o Supabase

1. Crie um projeto dedicado no plano **Free** em [Supabase](https://supabase.com/dashboard).
2. No projeto, abra **SQL Editor**, crie uma consulta, cole o conteúdo completo de
   `supabase/CONFIGURAR.sql` e execute **Run**.
3. Confira que foi criado o bucket privado `ta-media` em Storage. Não o torne público.
4. Nas configurações do projeto, copie o **Project URL**.
5. Na seção **API Keys**, localize uma chave secreta de servidor. O adaptador aceita
   a chave `sb_secret_...` ou a antiga `service_role` em Legacy API Keys.
   Não use `anon` ou `publishable`. Guarde a chave para colar somente no Render.

O nome da variável no Render é `SUPABASE_SERVICE_ROLE_KEY`, inclusive se usar uma
chave nova `sb_secret_...`. A extensão não recebe essa chave.

## 2. Enviar o projeto ao GitHub

1. No GitHub, crie um repositório **Private** chamado `telegram-atendimento`.
2. Extraia este ZIP no computador e abra a pasta `telegram-render-supabase`.
3. No repositório, escolha **Add file → Upload files** (ou o link de enviar arquivos
   que aparece em um repositório vazio).
4. Arraste o conteúdo dessa pasta para a página: `server`, `extension`, `supabase`,
   `render.yaml` e os demais arquivos. Não envie o ZIP fechado.
5. Confirme **Commit changes**.
6. Confira que `render.yaml` aparece diretamente na página inicial do repositório,
   junto das pastas `server` e `extension`. Não deve estar dentro de uma pasta extra.

O pacote não contém credenciais, node_modules, arquivos .env, sessões ou áudios pessoais.
Se você tiver criado arquivos com segredos, não os envie ao GitHub.

## 3. Publicar no Render

1. Acesse [Render](https://dashboard.render.com/) e conecte sua conta do GitHub.
2. Selecione **New → Blueprint** e escolha o repositório privado acima.
3. O Render vai ler `render.yaml`. Confira o plano **Free** e apenas um serviço web.
4. Preencha os campos solicitados:

| Campo no Render | O que colocar |
|---|---|
| `SUPABASE_URL` | Project URL do Supabase, começando por HTTPS |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave secreta de servidor do Supabase |
| `TELEGRAM_API_ID` | API ID da aplicação em my.telegram.org |
| `TELEGRAM_API_HASH` | API Hash da mesma aplicação |

5. O Blueprint gera `ACCESS_TOKEN` e `SESSION_ENCRYPTION_KEY` automaticamente.
   Mantenha esses valores estáveis entre publicações.
6. Confirme a criação e aguarde o build terminar. Ele instala as dependências e FFmpeg.
7. Quando aparecer **Live**, copie o endereço HTTPS exibido pelo Render.
8. Na aba **Environment**, localize o `ACCESS_TOKEN` gerado. Esse é o único segredo
   do servidor que você precisará informar na extensão.

Não crie banco Postgres do Render, disco pago ou serviço adicional. O armazenamento
permanente desta versão fica no Supabase. O endereço HTTPS do Render elimina a
necessidade de DuckDNS, domínio próprio ou Caddy.

## 4. Instalar e conectar a extensão

1. No Chrome, abra `chrome://extensions`, ative **Modo do desenvolvedor** e clique
   em **Carregar sem compactação**.
2. Selecione a pasta `extension` deste pacote. Desative as versões anteriores para
   o teste não misturar painéis. Se atualizar uma instalação existente, mantenha
   um backup antes de substituir seus arquivos.
3. Abra ou atualize o Telegram Web e clique em **Atendimento**.
4. Em **Configurações**, preencha:

| Campo na extensão | O que colocar |
|---|---|
| Endereço da sua instalação | URL HTTPS fornecida pelo Render, sem caminho no final |
| Chave de acesso | `ACCESS_TOKEN` do Render |

5. Clique em **Salvar e conectar** e autorize acesso ao endereço informado.
6. Conecte a mesma conta do Telegram aberta na aba. Digite telefone, código e senha
   de duas etapas, quando solicitados, diretamente no painel.
7. Cadastre um áudio curto e envie para **Mensagens Salvas**.
8. Teste a troca entre duas conversas que você controle antes de iniciar atendimentos.

## O que fica onde

- **GitHub:** código, sem credenciais ou áudios.
- **Render:** processo de atendimento, conversão e cache temporário de mídia.
- **Supabase Storage:** áudios, imagens e vídeos, em bucket privado.
- **Supabase Database:** biblioteca, favoritos, sequências e sessão criptografada.
- **Chrome:** URL da instalação e chave de acesso. Não armazena a chave administrativa
  do Supabase nem a sessão do Telegram.

A criptografia da sessão usa uma chave derivada do segredo `SESSION_ENCRYPTION_KEY`
gerado no Render. Não troque esse segredo ao atualizar: o banco não terá como abrir
uma sessão cifrada com outra chave. Faça backup seguro dele separadamente dos dados.
Uma sessão da 3.0 anterior não deve ser copiada para esta versão: faça login novamente.

## Funcionamento gratuito e limitações

- O Render Free adormece após 15 minutos sem tráfego recebido e pode demorar cerca de
  um minuto para acordar. Os dados permanentes são recuperados do Supabase.
- Envios em andamento param quando o processo é encerrado. Não há retomada automática;
  confira a conversa antes de iniciar de novo. O histórico de envios é temporário.
- Uma sequência permanece ligada ao destinatário escolhido, mesmo ao trocar de conversa.
  Parar impede as próximas etapas; uma mensagem já em transmissão pode terminar.
- O Supabase Free inclui 1 GB de arquivos, limites de transferência e pausa após uma
  semana de inatividade. Se for pausado, reative o projeto pelo painel.
- O Render também impõe limites de horas, tráfego e uso de conexões externas. Não há
  garantia de atendimento contínuo no plano gratuito. Nenhum script de tráfego
  artificial ou mecanismo de contornar cotas está incluído.
- Limite de 50 MB por arquivo de entrada e de saída convertida. A CPU e a memória do
  plano gratuito podem limitar conversões antes desse tamanho, especialmente vídeos.
- Use um serviço e uma instância por instalação. Esta versão guarda os metadados em
  registros JSON compartilhados; não foi projetada para vários servidores escrevendo
  ao mesmo tempo. Pause cadastros, exclusões e envios antes de publicar atualizações.
- Conserve os arquivos originais. Se uma conversão for enviada ao Storage e o banco
  falhar em seguida, pode sobrar um arquivo sem item na biblioteca; isso preserva o
  arquivo diante de falha ambígua, mas pode consumir cota até uma limpeza manual.
- Revogar uma chave de acesso requer alterá-la no Render e atualizar as extensões
  autorizadas. Quem tem a mesma chave acessa a mesma conta e a mesma biblioteca.

## Se ocorrer um erro

- **Supabase 401/403:** confira a chave secreta de servidor; anon não serve.
- **Supabase 404:** confira o Project URL, o SQL e a existência do bucket `ta-media`.
- **Supabase sem resposta:** confira se o projeto está ativo e se há cotas disponíveis.
- **Erro para abrir sessão:** confira `SESSION_ENCRYPTION_KEY` e sua versão anterior.
- **Build não encontra Dockerfile:** confira se `server/Dockerfile` e `render.yaml`
  estão nos caminhos indicados e se o arquivo está na raiz do repositório.
- **Versão incompatível:** atualize a pasta extension deste pacote e recarregue no Chrome.
- **Demora ao abrir:** aguarde o Render despertar e clique em Tentar novamente se necessário.

## Validação e referências

18 testes automatizados locais passaram. Os serviços externos foram simulados e as
conversões foram realizadas com FFmpeg real. O SQL, o Docker e o envio real precisam
ser validados nas suas contas. Para executar os testes em um ambiente de desenvolvimento,
use `npm test` na pasta server; os testes de conversão exigem `FFMPEG_PATH` e ffprobe.

- [Limitações do Render gratuito](https://render.com/docs/free)
- [Configuração por Blueprint](https://render.com/docs/blueprint-spec)
- [Planos do Supabase](https://supabase.com/pricing)
- [Chaves de API do Supabase](https://supabase.com/docs/guides/getting-started/api-keys)
- [Arquivos privados do Supabase](https://supabase.com/docs/guides/storage/serving/downloads)
