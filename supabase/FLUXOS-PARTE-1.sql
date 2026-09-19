-- Execute uma vez no SQL Editor do MESMO projeto Supabase da instalação.
-- Aditivo: preserva ta_state, sessões, biblioteca e Storage existentes.
begin;
create table if not exists public.ta_flows (
 id uuid primary key default gen_random_uuid(), name text not null,
 active boolean not null default true, steps jsonb not null,
 revision integer not null default 1, deleted_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check (length(name) between 1 and 80),
 check (jsonb_typeof(steps)='array' and jsonb_array_length(steps) between 1 and 30)
);
create table if not exists public.ta_flow_runs (
 id uuid primary key, flow_id uuid not null references public.ta_flows(id),
 dialog_id text not null, target_name text not null, snapshot jsonb not null,
 current_step integer not null default 0,
 status text not null default 'running' check(status in ('running','waiting','sending','done','error','uncertain','cancelled')),
 started_at timestamptz not null default now(), completed_at timestamptz,
 due_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 claim_token uuid, cancel_requested boolean not null default false, error text
);
create unique index if not exists ta_flow_one_per_dialog on public.ta_flow_runs(dialog_id)
 where status in ('running','waiting','sending','uncertain');
create index if not exists ta_flow_due on public.ta_flow_runs(due_at) where status in ('running','waiting');
create table if not exists public.ta_flow_logs (
 id bigint generated always as identity primary key,
 run_id uuid not null references public.ta_flow_runs(id), step integer not null,
 event text not null, message_id text, detail text, created_at timestamptz not null default now(),
 unique(run_id,step,event)
);
-- RPCs SECURITY INVOKER: acessíveis somente pela chave secreta no backend.
create or replace function public.ta_flow_start(p_id uuid,p_flow uuid,p_dialog text,p_name text)
returns public.ta_flow_runs language plpgsql set search_path=public as $$
declare r ta_flow_runs; f ta_flows;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_dialog,0));
 select * into r from ta_flow_runs where id=p_id;
 if found then
  if r.dialog_id<>p_dialog or r.flow_id<>p_flow then raise exception 'Identificador já usado em outra execução.'; end if;
  return r;
 end if;
 select * into r from ta_flow_runs where dialog_id=p_dialog and status in ('running','waiting','sending','uncertain');
 if found then
  if r.flow_id<>p_flow then raise exception 'Já existe outro fluxo nesta conversa.'; end if;
  return r;
 end if;
 -- Protege cliques repetidos também quando um fluxo curto acabou de terminar.
 select * into r from ta_flow_runs where dialog_id=p_dialog and flow_id=p_flow and started_at>now()-interval '30 seconds' order by started_at desc limit 1;
 if found then return r; end if;
 select * into f from ta_flows where id=p_flow and active and deleted_at is null for share;
 if not found then raise exception 'Fluxo não encontrado ou desativado.'; end if;
 insert into ta_flow_runs(id,flow_id,dialog_id,target_name,snapshot)
 values(p_id,p_flow,p_dialog,p_name,jsonb_build_object('name',f.name,'revision',f.revision,'steps',f.steps)) returning * into r;
 insert into ta_flow_logs(run_id,step,event) values(r.id,0,'started');
 return r;
end $$;
create or replace function public.ta_flow_claim()
returns setof public.ta_flow_runs language plpgsql set search_path=public as $$
declare r ta_flow_runs; s jsonb;
begin
 -- Nunca repete um envio de resultado desconhecido após queda/reinício.
 for r in select * from ta_flow_runs where status='sending' and updated_at<now()-interval '10 minutes' for update skip locked loop
  update ta_flow_runs set status='uncertain',error='Envio sem confirmação. Confira a conversa antes de encerrar.',updated_at=now() where id=r.id;
  insert into ta_flow_logs(run_id,step,event,detail) values(r.id,r.current_step,'uncertain','Servidor interrompido ou envio sem confirmação.') on conflict do nothing;
 end loop;
 for r in select * from ta_flow_runs where status in ('running','waiting') and due_at<=now() order by due_at limit 20 for update skip locked loop
  if r.status='waiting' then
   insert into ta_flow_logs(run_id,step,event) values(r.id,r.current_step,'completed') on conflict do nothing;
   r.current_step:=r.current_step+1;
  end if;
  s:=r.snapshot->'steps'->r.current_step;
  if s is null then
   update ta_flow_runs set current_step=r.current_step,status='done',completed_at=now(),updated_at=now() where id=r.id;
   insert into ta_flow_logs(run_id,step,event) values(r.id,r.current_step,'finished') on conflict do nothing;
  elsif s->>'type'='wait' then
   update ta_flow_runs set current_step=r.current_step,status='waiting',due_at=now()+make_interval(secs=>(s->>'seconds')::integer),updated_at=now() where id=r.id;
   insert into ta_flow_logs(run_id,step,event) values(r.id,r.current_step,'waiting') on conflict do nothing;
  else
   update ta_flow_runs set current_step=r.current_step,status='sending',claim_token=gen_random_uuid(),updated_at=now() where id=r.id returning * into r;
   insert into ta_flow_logs(run_id,step,event) values(r.id,r.current_step,'claimed') on conflict do nothing;
   return next r;
  end if;
 end loop;
end $$;
create or replace function public.ta_flow_finish(p_id uuid,p_token uuid,p_status text,p_message text default null,p_error text default null)
returns public.ta_flow_runs language plpgsql set search_path=public as $$
declare r ta_flow_runs;
begin
 select * into r from ta_flow_runs where id=p_id for update;
 if not found then raise exception 'Execução não encontrada.'; end if;
 if r.claim_token is distinct from p_token or r.status not in ('sending','uncertain') then return r; end if;
 if p_status not in ('completed','error','uncertain') then raise exception 'Resultado inválido.'; end if;
 insert into ta_flow_logs(run_id,step,event,message_id,detail) values(r.id,r.current_step,p_status,p_message,p_error) on conflict do nothing;
 if p_status='completed' then
  r.current_step:=r.current_step+1;
  r.status:=case when r.cancel_requested then 'cancelled' when r.current_step>=jsonb_array_length(r.snapshot->'steps') then 'done' else 'running' end;
 else r.status:=p_status;
 end if;
 update ta_flow_runs set current_step=r.current_step,status=r.status,error=p_error,
  completed_at=case when r.status in ('done','error','cancelled') then now() else null end,
  due_at=now(),updated_at=now(),claim_token=null where id=r.id returning * into r;
 return r;
end $$;
create or replace function public.ta_flow_cancel(p_id uuid)
returns public.ta_flow_runs language plpgsql set search_path=public as $$
declare r ta_flow_runs;
begin
 select * into r from ta_flow_runs where id=p_id for update;
 if not found then raise exception 'Execução não encontrada.'; end if;
 if r.status in ('running','waiting','sending','uncertain') then
  update ta_flow_runs set cancel_requested=true,
   status=case when status='sending' then 'sending' else 'cancelled' end,
   completed_at=case when status='sending' then null else now() end,updated_at=now()
  where id=r.id returning * into r;
  insert into ta_flow_logs(run_id,step,event) values(r.id,r.current_step,'cancel_requested') on conflict do nothing;
 end if;
 return r;
end $$;
alter table public.ta_flows enable row level security;
alter table public.ta_flow_runs enable row level security;
alter table public.ta_flow_logs enable row level security;
revoke all on public.ta_flows,public.ta_flow_runs,public.ta_flow_logs from anon,authenticated;
grant select,insert,update,delete on public.ta_flows,public.ta_flow_runs,public.ta_flow_logs to service_role;
grant usage,select on sequence public.ta_flow_logs_id_seq to service_role;
revoke all on function public.ta_flow_start(uuid,uuid,text,text),public.ta_flow_claim(),public.ta_flow_finish(uuid,uuid,text,text,text),public.ta_flow_cancel(uuid) from public,anon,authenticated;
grant execute on function public.ta_flow_start(uuid,uuid,text,text),public.ta_flow_claim(),public.ta_flow_finish(uuid,uuid,text,text,text),public.ta_flow_cancel(uuid) to service_role;
commit;
