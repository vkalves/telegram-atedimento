-- Execute no SQL Editor de um projeto Supabase novo, dedicado a esta instalação.
-- Este script pode ser executado novamente sem apagar os dados existentes.
begin;
create table if not exists public.ta_state (
  id text primary key,
  payload jsonb not null
);
alter table public.ta_state enable row level security;
revoke all on table public.ta_state from anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.ta_state to service_role;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ta-media', 'ta-media', false, 52428800,
  array['audio/ogg','video/mp4','image/jpeg','image/png']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
commit;
-- Não crie políticas públicas para ta_state ou ta-media.
-- A biblioteca, favoritos, ordem, status e categorias são payloads JSON nessa tabela;
-- a versão 4.0 não exige tabelas adicionais nem acesso direto do navegador ao Storage.
-- A chave de servidor fica exclusivamente nas variáveis de ambiente do Render.
