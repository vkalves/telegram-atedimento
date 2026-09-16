# Dashboard administrativo

Interface web estática para administrar os áudios usados pela extensão.

## Publicação no Render

- Tipo: **Static Site**
- Root Directory: `dashboard`
- Build Command: deixe vazio
- Publish Directory: `.`

Depois da primeira publicação, copie a URL HTTPS do dashboard e adicione-a à
variável `DASHBOARD_ORIGINS` do serviço backend. Para autorizar mais de um endereço,
separe-os por vírgulas. Exemplo:

```text
https://meu-dashboard.onrender.com
```

O dashboard solicita a URL do backend e o `ACCESS_TOKEN`. A chave secreta do
Supabase continua somente no backend e nunca deve ser informada no navegador.
