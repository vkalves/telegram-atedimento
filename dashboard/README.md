# Dashboard do Telegram Atendimento 4.0

Esta pasta é um site estático. Ela não contém chaves do Supabase nem depende de
Node.js: o navegador chama a API protegida do Render, e o Render grava os
metadados no Supabase e os arquivos no bucket privado `ta-media`.

## Testar localmente

Na raiz desta pasta, use qualquer servidor HTTP estático, por exemplo:

```bash
python -m http.server 4173
```

Abra `http://localhost:4173`, informe a URL HTTPS do Render e o `ACCESS_TOKEN`.
O Render precisa aceitar `http://localhost:4173` na variável `DASHBOARD_ORIGINS`.

## Publicar com o Blueprint

O arquivo `render.yaml` declara a API e o Static Site do dashboard. Ao criar ou
sincronizar o Blueprint no Render, confirme que o serviço
`telegram-atendimento-dashboard` foi aplicado e está servindo esta pasta.

A configuração equivalente é:

- **Root Directory:** vazio (raiz do repositório)
- **Build Command:** deixe vazio
- **Publish Directory:** `dashboard`

Se o serviço já existir e o endereço retornar `404 Not Found` com
`no-server`, sincronize/aplique o Blueprint ou ajuste essas configurações
manualmente. Para um domínio diferente do padrão, inclua a origem completa em
`DASHBOARD_ORIGINS` no serviço web da API. O endereço padrão
`https://telegram-atendimento-dashboard.onrender.com` já é aceito.

Também é possível publicar esta pasta em outra hospedagem estática; nesse caso,
inclua a origem usada em `DASHBOARD_ORIGINS`.

## Segurança

O dashboard pede o `ACCESS_TOKEN` do servidor e o guarda no `localStorage` deste
navegador. A extensão usa a senha separada `EXTENSION_PASSWORD`. Nunca coloque a chave `SUPABASE_SERVICE_ROLE_KEY`
em qualquer arquivo desta pasta. O bucket continua privado.
