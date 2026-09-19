-- Aplicar DEPOIS de FLUXOS-PARTE-1.sql, com o backend parado durante a atualização.
begin;
alter table public.ta_flow_runs drop constraint if exists ta_flow_runs_status_check;
alter table public.ta_flow_runs add constraint ta_flow_runs_status_check check(status in
 ('running','waiting','sending','done','error','uncertain','cancelled','arming_reply','awaiting_reply','paused'));
alter table public.ta_flow_runs
 add column if not exists control_version bigint not null default 0,
 add column if not exists pause_requested boolean not null default false,
 add column if not exists human_takeover boolean not null default false,
 add column if not exists resume_status text,
 add column if not exists remaining_seconds double precision,
 add column if not exists send_started boolean not null default false,
 add column if not exists dispatch_kind text not null default 'step',
 add column if not exists wait_token uuid,
 add column if not exists wait_started_at timestamptz,
 add column if not exists reply_cursor bigint,
 add column if not exists reply_account_id text,
 add column if not exists reply_deadline timestamptz,
 add column if not exists reply_checked_at timestamptz,
 add column if not exists poll_token uuid,
 add column if not exists poll_until timestamptz,
 add column if not exists restarted_from uuid references public.ta_flow_runs(id),
 add column if not exists restarted_to uuid references public.ta_flow_runs(id);
-- Um envio da Parte 1 já pode estar em trânsito. Nunca tratá-lo como somente reservado.
update public.ta_flow_runs set send_started=true where status in ('sending','uncertain');
drop index if exists public.ta_flow_one_per_dialog;
create unique index ta_flow_one_per_dialog on public.ta_flow_runs(dialog_id)
 where status in ('running','waiting','sending','uncertain','arming_reply','awaiting_reply','paused');
create unique index if not exists ta_flow_one_restart on public.ta_flow_runs(restarted_from) where restarted_from is not null;
create index if not exists ta_flow_reply_queue on public.ta_flow_runs(reply_checked_at) where status='awaiting_reply';
alter table public.ta_flow_logs drop constraint if exists ta_flow_logs_run_id_step_event_key;
create table if not exists public.ta_flow_inbound (
 dialog_id text not null, message_id bigint not null, account_id text not null,
 run_id uuid not null references public.ta_flow_runs(id), step integer not null, wait_token uuid not null,
 message_at timestamptz not null, processed_at timestamptz not null default now(),
 primary key(account_id,dialog_id,message_id)
);
create table if not exists public.ta_flow_commands (
 request_id uuid primary key, run_id uuid not null references public.ta_flow_runs(id),
 action text not null, result_id uuid not null references public.ta_flow_runs(id), created_at timestamptz not null default now()
);
create or replace function public.ta_flow_version() returns trigger language plpgsql set search_path=public as $$
begin
 if (new.status,new.current_step,new.claim_token,new.pause_requested,new.cancel_requested,new.human_takeover,new.send_started,new.restarted_to)
 is distinct from (old.status,old.current_step,old.claim_token,old.pause_requested,old.cancel_requested,old.human_takeover,old.send_started,old.restarted_to)
 then new.control_version:=old.control_version+1; end if;
 return new;
end $$;
drop trigger if exists ta_flow_version on public.ta_flow_runs;
create trigger ta_flow_version before update on public.ta_flow_runs for each row execute function public.ta_flow_version();
create or replace function public.ta_flow_start(p_id uuid,p_flow uuid,p_dialog text,p_name text)
returns public.ta_flow_runs language plpgsql set search_path=public as $$
declare r ta_flow_runs; f ta_flows;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_dialog,0));
 select * into r from ta_flow_runs where id=p_id;
 if found then
  if r.dialog_id<>p_dialog or r.flow_id<>p_flow then raise exception 'Identificador já usado em outra execução.'; end if; return r;
 end if;
 select * into r from ta_flow_runs where dialog_id=p_dialog and status in ('running','waiting','sending','uncertain','arming_reply','awaiting_reply','paused');
 if found then
  if r.flow_id<>p_flow then raise exception 'Já existe outro fluxo nesta conversa.'; end if; return r;
 end if;
 select * into r from ta_flow_runs where dialog_id=p_dialog and flow_id=p_flow and started_at>now()-interval '30 seconds' order by started_at desc limit 1;
 if found then return r; end if;
 select * into f from ta_flows where id=p_flow and active and deleted_at is null for share;
 if not found then raise exception 'Fluxo não encontrado ou desativado.'; end if;
 insert into ta_flow_runs(id,flow_id,dialog_id,target_name,snapshot)
 values(p_id,p_flow,p_dialog,p_name,jsonb_build_object('name',f.name,'revision',f.revision,'steps',f.steps)) returning * into r;
 insert into ta_flow_logs(run_id,step,event) values(r.id,0,'started');return r;
end $$;
create or replace function public.ta_flow_claim()
returns setof public.ta_flow_runs language plpgsql set search_path=public as $$
declare r ta_flow_runs; s jsonb;
begin
 for r in select * from ta_flow_runs where status='sending' and updated_at<now()-interval '10 minutes' for update skip locked loop
  update ta_flow_runs set status='uncertain',error='Envio sem confirmação. Confira a conversa.',updated_at=now() where id=r.id;
  insert into ta_flow_logs(run_id,step,event) values(r.id,r.current_step,'uncertain');
 end loop;
 for r in select * from ta_flow_runs where
  (status in ('running','waiting') and due_at<=now()) or
  (status='arming_reply' and due_at<=now() and (claim_token is null or updated_at<now()-interval '2 minutes'))
  order by due_at limit 20 for update skip locked loop
  if r.status='waiting' then
   insert into ta_flow_logs(run_id,step,event) values(r.id,r.current_step,'completed');
   r.current_step:=r.current_step+1;
  end if;
  s:=r.snapshot->'steps'->r.current_step;
  if s is null then
   update ta_flow_runs set current_step=r.current_step,status='done',completed_at=now(),updated_at=now() where id=r.id;

  elsif s->>'type'='wait' and r.dispatch_kind='step' then
   update ta_flow_runs set current_step=r.current_step,status='waiting',due_at=now()+make_interval(secs=>(s->>'seconds')::integer),updated_at=now() where id=r.id;
   insert into ta_flow_logs(run_id,step,event) values(r.id,r.current_step,'waiting');
  elsif s->>'type'='reply' and r.dispatch_kind='step' then
   update ta_flow_runs set current_step=r.current_step,status='arming_reply',claim_token=gen_random_uuid(),updated_at=now() where id=r.id returning * into r;
   return next r;
  else
   update ta_flow_runs set current_step=r.current_step,status='sending',send_started=false,claim_token=gen_random_uuid(),updated_at=now() where id=r.id returning * into r;
   insert into ta_flow_logs(run_id,step,event) values(r.id,r.current_step,'claimed');return next r;
  end if;
 end loop;
end $$;
-- Reserva separada do limite irreversível de envio: pausa antes deste RPC impede o envio.
create or replace function public.ta_flow_dispatch(p_id uuid,p_token uuid)
returns boolean language plpgsql set search_path=public as $$
begin
 update ta_flow_runs set send_started=true,updated_at=now()
 where id=p_id and claim_token=p_token and status='sending' and not send_started and not pause_requested and not cancel_requested;
 return found;
end $$;
create or replace function public.ta_flow_arm(p_id uuid,p_token uuid,p_cursor bigint,p_account text,p_error text default null)
returns public.ta_flow_runs language plpgsql set search_path=public as $$
declare r ta_flow_runs; seconds double precision;
begin
 select * into r from ta_flow_runs where id=p_id for update;
 if r.status<>'arming_reply' or r.claim_token is distinct from p_token then return r; end if;
 if p_error is not null then
  if r.error is distinct from left(p_error,220) then insert into ta_flow_logs(run_id,step,event,detail) values(r.id,r.current_step,'reply_error',left(p_error,220)); end if;
  update ta_flow_runs set error=left(p_error,220),claim_token=null,due_at=now()+interval '10 seconds',updated_at=now() where id=p_id returning * into r;
  return r;
 end if;
 if p_cursor<0 or p_cursor is null or p_account is null then raise exception 'Cursor de resposta inválido.'; end if;
 seconds:=coalesce(r.remaining_seconds,(r.snapshot->'steps'->r.current_step->>'timeoutSeconds')::double precision,0);
 update ta_flow_runs set status='awaiting_reply',wait_token=gen_random_uuid(),wait_started_at=now(),reply_cursor=p_cursor,
 reply_account_id=p_account,reply_deadline=case when seconds>0 then now()+make_interval(secs=>seconds) else null end,
 remaining_seconds=null,reply_checked_at=null,poll_token=null,poll_until=null,claim_token=null,error=null,updated_at=now()
 where id=p_id returning * into r;
 insert into ta_flow_logs(run_id,step,event) values(r.id,r.current_step,'awaiting_reply');return r;
end $$;
create or replace function public.ta_flow_watch()
returns setof public.ta_flow_runs language plpgsql set search_path=public as $$
declare r ta_flow_runs;
begin
 for r in select * from ta_flow_runs where status='awaiting_reply' and (poll_until is null or poll_until<now())
 and (reply_checked_at is null or reply_checked_at<now()-interval '2 seconds')
 order by reply_checked_at nulls first limit 10 for update skip locked loop
  update ta_flow_runs set poll_token=gen_random_uuid(),poll_until=now()+interval '2 minutes',reply_checked_at=now() where id=r.id returning * into r;
  return next r;
 end loop;
end $$;
-- Chamado exclusivamente pelo backend após consultar o histórico autenticado do Telegram.
create or replace function public.ta_flow_reply(p_id uuid,p_wait uuid,p_poll uuid,p_step integer,p_account text,p_dialog text,
 p_messages jsonb,p_cursor bigint,p_complete boolean,p_checked_at timestamptz,p_error text default null)
returns public.ta_flow_runs language plpgsql set search_path=public as $$
declare r ta_flow_runs; m jsonb; mid bigint; stamp timestamptz; matched boolean:=false; action text;
begin
 select * into r from ta_flow_runs where id=p_id for update;
 if r.status<>'awaiting_reply' or r.wait_token is distinct from p_wait or r.poll_token is distinct from p_poll or r.current_step<>p_step then return r; end if;
 if p_error is not null then
  if r.error is distinct from left(p_error,220) then insert into ta_flow_logs(run_id,step,event,detail) values(r.id,r.current_step,'reply_error',left(p_error,220)); end if;
  update ta_flow_runs set error=left(p_error,220),poll_token=null,poll_until=now()+interval '10 seconds' where id=p_id returning * into r;return r;
 end if;
 if r.dialog_id is distinct from p_dialog or r.reply_account_id is distinct from p_account then raise exception 'Resposta de outra conta ou conversa.'; end if;
 if jsonb_typeof(p_messages)<>'array' or jsonb_array_length(p_messages)>100 then raise exception 'Lote inválido.'; end if;
 for m in select value from jsonb_array_elements(p_messages) order by (value->>'id')::bigint loop
  mid:=(m->>'id')::bigint;stamp:=to_timestamp((m->>'date')::double precision);
  if m->>'senderId'=r.dialog_id and m->>'dialogId'=r.dialog_id and mid>r.reply_cursor
   and stamp>=date_trunc('second',r.wait_started_at) and stamp<=now()+interval '1 second'
   and (r.reply_deadline is null or stamp<=r.reply_deadline) then
   insert into ta_flow_inbound(account_id,dialog_id,message_id,run_id,step,wait_token,message_at)
   values(p_account,r.dialog_id,mid,r.id,r.current_step,r.wait_token,stamp) on conflict do nothing;
   if found then
    insert into ta_flow_logs(run_id,step,event,message_id) values(r.id,r.current_step,'reply_received',mid::text);
    insert into ta_flow_logs(run_id,step,event) values(r.id,r.current_step,'completed'),(r.id,r.current_step,'resumed');
    matched:=true;exit;
   end if;
  end if;
 end loop;
 if matched then
  update ta_flow_runs set current_step=current_step+1,status=case when current_step+1>=jsonb_array_length(snapshot->'steps') then 'done' else 'running' end,
   completed_at=case when current_step+1>=jsonb_array_length(snapshot->'steps') then now() else null end,
   due_at=now(),poll_token=null,poll_until=null,wait_token=null,error=null,updated_at=now() where id=p_id returning * into r;
 -- Só expira depois de uma consulta completa iniciada APÓS o prazo (incluindo precisão de 1s do Telegram).
 elsif p_complete and r.reply_deadline is not null and p_checked_at>=r.reply_deadline+interval '1 second' and now()>=p_checked_at then
  action:=coalesce(r.snapshot->'steps'->r.current_step->>'timeoutAction','end');
  insert into ta_flow_logs(run_id,step,event) values(r.id,r.current_step,'reply_timeout');
  if action='followup' then
   update ta_flow_runs set status='running',dispatch_kind='followup',due_at=now(),wait_token=null,poll_token=null,poll_until=null,error=null,updated_at=now() where id=p_id returning * into r;
  else
   update ta_flow_runs set current_step=current_step+1,
    status=case when action='end' or current_step+1>=jsonb_array_length(snapshot->'steps') then 'done' else 'running' end,
    completed_at=case when action='end' or current_step+1>=jsonb_array_length(snapshot->'steps') then now() else null end,
    due_at=now(),wait_token=null,poll_token=null,poll_until=null,error=null,updated_at=now() where id=p_id returning * into r;
  end if;
 else
  update ta_flow_runs set reply_cursor=greatest(reply_cursor,p_cursor),poll_token=null,poll_until=null,error=null where id=p_id returning * into r;
 end if;
 return r;
end $$;
create or replace function public.ta_flow_finish(p_id uuid,p_token uuid,p_status text,p_message text default null,p_error text default null)
returns public.ta_flow_runs language plpgsql set search_path=public as $$
declare r ta_flow_runs;
begin
 select * into r from ta_flow_runs where id=p_id for update;
 if not found then raise exception 'Execução não encontrada.'; end if;
 if r.claim_token is distinct from p_token or r.status not in ('sending','uncertain') then return r; end if;
 if p_status not in ('completed','error','uncertain') then raise exception 'Resultado inválido.'; end if;
 insert into ta_flow_logs(run_id,step,event,message_id,detail) values(r.id,r.current_step,
  case when p_status='completed' and r.dispatch_kind='followup' then 'followup_sent' else p_status end,p_message,p_error);
 if p_status='completed' then
  r.current_step:=r.current_step+1;
  r.status:=case when r.cancel_requested then 'cancelled' when r.pause_requested then 'paused' when r.current_step>=jsonb_array_length(r.snapshot->'steps') then 'done' else 'running' end;
 else r.status:=p_status; end if;
 update ta_flow_runs set current_step=r.current_step,status=r.status,error=p_error,
 completed_at=case when r.status in ('done','error','cancelled') then now() else null end,
 resume_status=case when r.status='paused' then 'running' else null end,
 due_at=now(),updated_at=now(),claim_token=null,send_started=false,dispatch_kind='step',pause_requested=false where id=r.id returning * into r;
 return r;
end $$;
create or replace function public.ta_flow_control(p_id uuid,p_request uuid,p_action text,p_version bigint)
returns public.ta_flow_runs language plpgsql set search_path=public as $$
declare r ta_flow_runs; c ta_flow_commands; n ta_flow_runs; next_status text;
begin
 select * into r from ta_flow_runs where id=p_id;
 if not found then raise exception 'Execução não encontrada.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(r.dialog_id,0));
 select * into r from ta_flow_runs where id=p_id for update;
 select * into c from ta_flow_commands where request_id=p_request;
 if found then
  if c.run_id<>p_id or c.action<>p_action then raise exception 'Comando já utilizado.'; end if;
  select * into n from ta_flow_runs where id=c.result_id;return n;
 end if;
 if r.control_version<>p_version then raise exception 'Execução mudou. Atualize antes de repetir o comando.'; end if;
 if p_action in ('pause','human') then
  if r.status not in ('running','waiting','sending','arming_reply','awaiting_reply','paused') then raise exception 'Não é possível pausar este estado.'; end if;
  if r.status='sending' and r.send_started then
   update ta_flow_runs set pause_requested=true,human_takeover=(p_action='human' or human_takeover),updated_at=now() where id=p_id returning * into r;
  elsif r.status<>'paused' then
   update ta_flow_runs set status='paused',resume_status=case when status='sending' then 'running' else status end,
    remaining_seconds=case when status='waiting' then greatest(0.001,extract(epoch from due_at-now())) when status='awaiting_reply' and reply_deadline is not null then greatest(0.001,extract(epoch from reply_deadline-now())) else remaining_seconds end,
    human_takeover=(p_action='human' or human_takeover),claim_token=null,poll_token=null,wait_token=null,updated_at=now() where id=p_id returning * into r;
  else update ta_flow_runs set human_takeover=(p_action='human' or human_takeover) where id=p_id returning * into r;
  end if;
 elsif p_action='resume' then
  if r.status<>'paused' then raise exception 'O fluxo não está pausado.'; end if;
  next_status:=case when r.resume_status in ('awaiting_reply','arming_reply') then 'arming_reply' when r.resume_status='waiting' then 'waiting' else 'running' end;
  update ta_flow_runs set status=next_status,due_at=case when next_status='waiting' then now()+make_interval(secs=>coalesce(remaining_seconds,0)) else now() end,
   human_takeover=false,pause_requested=false,remaining_seconds=case when next_status='arming_reply' then remaining_seconds else null end,claim_token=null,updated_at=now() where id=p_id returning * into r;
 elsif p_action in ('cancel','restart','skip') then
  if r.status='sending' and r.send_started and p_action<>'cancel' then raise exception 'Aguarde o envio em andamento antes de pular ou reiniciar.'; end if;
  if p_action='cancel' then
   if r.status not in ('done','error','cancelled') then
    update ta_flow_runs set cancel_requested=true,status=case when status='sending' and send_started then 'sending' else 'cancelled' end,
    completed_at=case when status='sending' and send_started then null else now() end,poll_token=null,wait_token=null,updated_at=now() where id=p_id returning * into r;
   end if;
  elsif p_action='skip' then
   if r.status not in ('running','waiting','arming_reply','awaiting_reply','paused','sending') then raise exception 'Não é possível pular este estado.'; end if;
   update ta_flow_runs set current_step=current_step+1,status=case when status='paused' then 'paused' when current_step+1>=jsonb_array_length(snapshot->'steps') then 'done' else 'running' end,
    completed_at=case when status<>'paused' and current_step+1>=jsonb_array_length(snapshot->'steps') then now() else null end,
    resume_status='running',remaining_seconds=null,claim_token=null,poll_token=null,wait_token=null,dispatch_kind='step',due_at=now(),updated_at=now() where id=p_id returning * into r;
  else
   if r.status='uncertain' then raise exception 'Confira e cancele o envio incerto antes de reiniciar.'; end if;
   if r.restarted_to is not null then select * into n from ta_flow_runs where id=r.restarted_to;return n; end if;
   if exists(select 1 from ta_flow_runs where dialog_id=r.dialog_id and id<>p_id and status in ('running','waiting','sending','uncertain','arming_reply','awaiting_reply','paused')) then raise exception 'Outro fluxo ocupa esta conversa.'; end if;
   update ta_flow_runs set status='cancelled',completed_at=now(),claim_token=null,poll_token=null,wait_token=null,updated_at=now() where id=p_id;
   insert into ta_flow_runs(id,flow_id,dialog_id,target_name,snapshot,restarted_from) values(p_request,r.flow_id,r.dialog_id,r.target_name,r.snapshot,r.id) returning * into n;
   update ta_flow_runs set restarted_to=n.id where id=p_id;
   insert into ta_flow_logs(run_id,step,event,detail) values(n.id,0,'started','Reinício da execução '||p_id);
   insert into ta_flow_logs(run_id,step,event,detail) values(p_id,r.current_step,'restarted',n.id::text);
   insert into ta_flow_commands(request_id,run_id,action,result_id) values(p_request,p_id,p_action,n.id);return n;
  end if;
 else raise exception 'Comando inválido.';
 end if;
 insert into ta_flow_logs(run_id,step,event) values(p_id,case when p_action='skip' then r.current_step-1 else r.current_step end,p_action);
 insert into ta_flow_commands(request_id,run_id,action,result_id) values(p_request,p_id,p_action,p_id);return r;
end $$;
create or replace function public.ta_flow_cancel(p_id uuid)
returns public.ta_flow_runs language plpgsql set search_path=public as $$
declare r ta_flow_runs;
begin
 select * into r from ta_flow_runs where id=p_id;
 return ta_flow_control(p_id,gen_random_uuid(),'cancel',r.control_version);
end $$;
create or replace function public.ta_flow_status_log() returns trigger language plpgsql set search_path=public as $$
begin
 if new.status is distinct from old.status and new.status in ('done','paused','cancelled') then
  insert into ta_flow_logs(run_id,step,event) values(new.id,new.current_step,
   case new.status when 'done' then 'finished' when 'paused' then 'paused' else 'cancelled' end);
 end if;
 return new;
end $$;
drop trigger if exists ta_flow_status_log on public.ta_flow_runs;
create trigger ta_flow_status_log after update on public.ta_flow_runs for each row execute function public.ta_flow_status_log();
create or replace function public.ta_flow_capabilities() returns jsonb language sql as $$select '{"version":2}'::jsonb$$;
alter table public.ta_flow_inbound enable row level security;
alter table public.ta_flow_commands enable row level security;
revoke all on public.ta_flow_inbound,public.ta_flow_commands from anon,authenticated;
grant select,insert,update,delete on public.ta_flow_inbound,public.ta_flow_commands to service_role;
-- Inclui apenas funções de fluxos; não altera permissões de outras áreas.
do $$declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'ta_flow_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
