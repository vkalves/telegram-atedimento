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

## Publicar separadamente

No Render, crie um **Static Site** apontando para o mesmo repositório:

- **Root Directory:** `dashboard`
- **Build Command:** deixe vazio
- **Publish Directory:** `.`

Depois de o endereço do dashboard ficar disponível, adicione a origem completa,
sem barra no final, em `DASHBOARD_ORIGINS` no serviço web da API. Para testar
mais de um endereço, separe as origens por vírgula. Faça um novo deploy da API.

Também é possível publicar esta pasta em qualquer hospedagem de arquivos
estáticos. O endereço usado precisa ser incluído em `DASHBOARD_ORIGINS`.

## Segurança

O dashboard pede o mesmo `ACCESS_TOKEN` usado pela extensão e o guarda no
`localStorage` deste navegador. Nunca coloque a chave `SUPABASE_SERVICE_ROLE_KEY`
em qualquer arquivo desta pasta. O bucket continua privado.
