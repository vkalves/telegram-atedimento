-- Aplicar DEPOIS de FLUXOS-PARTE-1.sql e FLUXOS-PARTE-2.sql.
-- Migração aditiva: mantém fluxos e execuções já existentes.
begin;

alter table public.ta_flows
 add column if not exists description text not null default '',
 add column if not exists trigger jsonb not null default '{"type":"manual"}'::jsonb,
 add column if not exists settings jsonb not null default '{"pauseOnHuman":true,"maxTransitions":200}'::jsonb;
alter table public.ta_flows drop constraint if exists ta_flows_steps_check;
alter table public.ta_flows add constraint ta_flows_steps_check
 check(jsonb_typeof(steps)='array' and jsonb_array_length(steps) between 1 and 100);

alter table public.ta_flow_runs
 add column if not exists target jsonb not null default '{}'::jsonb,
 add column if not exists started_by text not null default 'manual',
 add column if not exists last_reply jsonb,
 add column if not exists transition_count integer not null default 0,
 add column if not exists send_started_at timestamptz,
 add column if not exists reply_after_message_id bigint;
alter table public.ta_flow_inbound add column if not exists payload jsonb not null default '{}'::jsonb;

create table if not exists public.ta_flow_leads (
 dialog_id text primary key,
 profile jsonb not null default '{}'::jsonb,
 first_seen_at timestamptz not null,
 last_seen_at timestamptz not null,
 inbound_count bigint not null default 1
);
create table if not exists public.ta_flow_updates (
 account_id text not null,
 dialog_id text not null,
 message_id bigint not null,
 message_at timestamptz not null,
 message_text text not null default '',
 message_type text not null default 'message',
 target jsonb not null default '{}'::jsonb,
 run_id uuid references public.ta_flow_runs(id),
 processed_at timestamptz not null default now(),
 primary key(account_id,dialog_id,message_id)
);
create index if not exists ta_flow_updates_dialog on public.ta_flow_updates(dialog_id,message_id desc);
create table if not exists public.ta_flow_outbound (
 dialog_id text not null,
 message_id bigint not null,
 message_at timestamptz not null default now(),
 run_id uuid references public.ta_flow_runs(id),
 automation boolean not null default false,
 processed boolean not null default false,
 primary key(dialog_id,message_id)
);
create index if not exists ta_flow_outbound_pending on public.ta_flow_outbound(run_id) where not processed and not automation;

create or replace function public.ta_flow_step_index(p_snapshot jsonb,p_step_id text,p_fallback integer)
returns integer language plpgsql immutable set search_path=public as $$
declare result integer;
begin
 if p_step_id is null or p_step_id='' then return p_fallback; end if;
 select (entry.ordinality-1)::integer into result
 from jsonb_array_elements(p_snapshot->'steps') with ordinality as entry(value,ordinality)
 where entry.value->>'id'=p_step_id limit 1;
 return coalesce(result,p_fallback);
end $$;

create or replace function public.ta_flow_begin(p_id uuid,p_flow uuid,p_dialog text,p_name text,p_target jsonb,
 p_started_by text,p_trigger_message bigint default null)
returns public.ta_flow_runs language plpgsql set search_path=public as $$
declare r ta_flow_runs; f ta_flows; safe_target jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_dialog,0));
 select * into r from ta_flow_runs where id=p_id;
 if found then
  if r.dialog_id<>p_dialog or r.flow_id<>p_flow then raise exception 'Identificador já usado em outra execução.'; end if;
  return r;
 end if;
 select * into r from ta_flow_runs where dialog_id=p_dialog and status in ('running','waiting','sending','uncertain','arming_reply','awaiting_reply','paused');
 if found then
  if r.flow_id<>p_flow then raise exception 'Já existe outro fluxo nesta conversa.'; end if;
  return r;
 end if;
 if p_started_by='manual' then
  select * into r from ta_flow_runs where dialog_id=p_dialog and flow_id=p_flow and started_at>now()-interval '30 seconds' order by started_at desc limit 1;
  if found then return r; end if;
 end if;
 select * into f from ta_flows where id=p_flow and active and deleted_at is null for share;
 if not found then raise exception 'Fluxo não encontrado ou desativado.'; end if;
 safe_target:=coalesce(p_target,'{}'::jsonb)||jsonb_build_object('id',p_dialog,'name',p_name);
 insert into ta_flow_runs(id,flow_id,dialog_id,target_name,target,started_by,snapshot,reply_after_message_id)
 values(p_id,p_flow,p_dialog,p_name,safe_target,left(coalesce(p_started_by,'manual'),80),
  jsonb_build_object('name',f.name,'description',f.description,'revision',f.revision,'trigger',f.trigger,'settings',f.settings,'steps',f.steps),p_trigger_message)
 returning * into r;
 insert into ta_flow_logs(run_id,step,event,detail) values(r.id,0,'started',left(coalesce(p_started_by,'manual'),220));
 if p_started_by like 'trigger:%' then insert into ta_flow_logs(run_id,step,event,detail) values(r.id,0,'trigger_matched',left(p_started_by,220)); end if;
 return r;
end $$;

create or replace function public.ta_flow_start(p_id uuid,p_flow uuid,p_dialog text,p_name text)
returns public.ta_flow_runs language sql set search_path=public as $$
 select public.ta_flow_begin(p_id,p_flow,p_dialog,p_name,jsonb_build_object('id',p_dialog,'name',p_name),'manual',null)
$$;
create or replace function public.ta_flow_start_v3(p_id uuid,p_flow uuid,p_dialog text,p_name text,p_target jsonb,p_started_by text)
returns public.ta_flow_runs language sql set search_path=public as $$
 select public.ta_flow_begin(p_id,p_flow,p_dialog,p_name,p_target,p_started_by,null)
$$;

create or replace function public.ta_flow_claim()
returns setof public.ta_flow_runs language plpgsql set search_path=public as $$
declare r ta_flow_runs; s jsonb; matched boolean; next_step integer; max_transitions integer;
begin
 -- Antes de dispatch não houve efeito externo: uma reserva abandonada pode ser retomada com segurança.
 for r in select * from ta_flow_runs where status='sending' and not send_started and updated_at<now()-interval '2 minutes' for update skip locked loop
  update ta_flow_runs set status='running',claim_token=null,due_at=now(),updated_at=now() where id=r.id;
  insert into ta_flow_logs(run_id,step,event,detail) values(r.id,r.current_step,'claim_recovered','Reserva recuperada antes do envio externo.');
 end loop;
 -- Depois de dispatch o resultado pode ser desconhecido e nunca é repetido automaticamente.
 for r in select * from ta_flow_runs where status='sending' and send_started and updated_at<now()-interval '10 minutes' for update skip locked loop
  update ta_flow_runs set status='uncertain',error='Envio sem confirmação. Confira a conversa.',updated_at=now() where id=r.id;
  insert into ta_flow_logs(run_id,step,event) values(r.id,r.current_step,'uncertain');
 end loop;
 for r in select * from ta_flow_runs where
  (status in ('running','waiting') and due_at<=now()) or
  (status='arming_reply' and due_at<=now() and (claim_token is null or updated_at<now()-interval '2 minutes'))
  order by due_at limit 20 for update skip locked loop
  if r.status='waiting' then
   insert into ta_flow_logs(run_id,step,event) values(r.id,r.current_step,'completed');
   r.current_step:=r.current_step+1;r.transition_count:=r.transition_count+1;r.reply_after_message_id:=null;
  end if;
  max_transitions:=greatest(20,least(1000,coalesce((r.snapshot->'settings'->>'maxTransitions')::integer,200)));
  if r.transition_count>=max_transitions then
   update ta_flow_runs set status='error',error='O fluxo excedeu o limite de transições e foi interrompido.',completed_at=now(),updated_at=now() where id=r.id;
   insert into ta_flow_logs(run_id,step,event,detail) values(r.id,r.current_step,'loop_guard','Limite de transições atingido.');
   continue;
  end if;
  s:=r.snapshot->'steps'->r.current_step;
  if s is null then
   update ta_flow_runs set current_step=r.current_step,transition_count=r.transition_count,status='done',completed_at=now(),updated_at=now() where id=r.id;
  elsif s->>'type'='wait' and r.dispatch_kind='step' then
   update ta_flow_runs set current_step=r.current_step,transition_count=r.transition_count,status='waiting',reply_after_message_id=null,
    due_at=now()+make_interval(secs=>(s->>'seconds')::integer),updated_at=now() where id=r.id;
   insert into ta_flow_logs(run_id,step,event,detail) values(r.id,r.current_step,'waiting',(s->>'seconds')||' segundos');
  elsif s->>'type'='reply' and r.dispatch_kind='step' then
   update ta_flow_runs set current_step=r.current_step,transition_count=r.transition_count,status='arming_reply',claim_token=gen_random_uuid(),updated_at=now() where id=r.id returning * into r;
   return next r;
  elsif s->>'type'='condition' and r.dispatch_kind='step' then
   matched:=case coalesce(s->>'operator','contains')
    when 'equals' then lower(trim(coalesce(r.last_reply->>'text','')))=lower(trim(coalesce(s->>'value','')))
    when 'starts_with' then lower(trim(coalesce(r.last_reply->>'text',''))) like lower(trim(coalesce(s->>'value','')))||'%'
    else position(lower(trim(coalesce(s->>'value',''))) in lower(trim(coalesce(r.last_reply->>'text',''))))>0 end;
   next_step:=ta_flow_step_index(r.snapshot,case when matched then s->>'thenStepId' else s->>'elseStepId' end,r.current_step+1);
   update ta_flow_runs set current_step=next_step,transition_count=r.transition_count+1,status='running',due_at=now(),
    reply_after_message_id=case when last_reply->>'id'~'^\d+$' then (last_reply->>'id')::bigint else reply_after_message_id end,updated_at=now()
   where id=r.id;
   insert into ta_flow_logs(run_id,step,event,detail) values(r.id,r.current_step,'condition_evaluated',jsonb_build_object('matched',matched,'nextStep',next_step)::text);
  elsif s->>'type'='handoff' and r.dispatch_kind='step' then
   update ta_flow_runs set current_step=r.current_step+1,transition_count=r.transition_count+1,status='paused',resume_status='running',
    human_takeover=true,claim_token=null,updated_at=now() where id=r.id;
   insert into ta_flow_logs(run_id,step,event,detail) values(r.id,r.current_step,'human_handoff','Transferência definida no fluxo.');
  elsif s->>'type'='end' and r.dispatch_kind='step' then
   update ta_flow_runs set status='done',transition_count=r.transition_count+1,completed_at=now(),updated_at=now() where id=r.id;
   insert into ta_flow_logs(run_id,step,event) values(r.id,r.current_step,'ended');
  else
   update ta_flow_runs set current_step=r.current_step,transition_count=r.transition_count,status='sending',send_started=false,
    send_started_at=null,claim_token=gen_random_uuid(),updated_at=now() where id=r.id returning * into r;
   insert into ta_flow_logs(run_id,step,event) values(r.id,r.current_step,'claimed');return next r;
  end if;
 end loop;
end $$;

create or replace function public.ta_flow_dispatch(p_id uuid,p_token uuid)
returns boolean language plpgsql set search_path=public as $$
begin
 update ta_flow_runs set send_started=true,send_started_at=now(),updated_at=now()
 where id=p_id and claim_token=p_token and status='sending' and not send_started and not pause_requested and not cancel_requested;
 return found;
end $$;

create or replace function public.ta_flow_activity(p_id uuid,p_token uuid,p_event text,p_detail text default null)
returns boolean language plpgsql set search_path=public as $$
declare r ta_flow_runs;
begin
 select * into r from ta_flow_runs where id=p_id and claim_token=p_token and status='sending' and not send_started;
 if not found then return false; end if;
 if p_event not in ('activity_started','activity_failed') then raise exception 'Evento de atividade inválido.'; end if;
 insert into ta_flow_logs(run_id,step,event,detail) values(r.id,r.current_step,p_event,left(p_detail,220));
 return true;
end $$;

create or replace function public.ta_flow_arm(p_id uuid,p_token uuid,p_cursor bigint,p_account text,p_error text default null)
returns public.ta_flow_runs language plpgsql set search_path=public as $$
declare r ta_flow_runs; seconds double precision; initial_cursor bigint;
begin
 select * into r from ta_flow_runs where id=p_id for update;
 if r.status<>'arming_reply' or r.claim_token is distinct from p_token then return r; end if;
 if p_error is not null then
  if r.error is distinct from left(p_error,220) then insert into ta_flow_logs(run_id,step,event,detail) values(r.id,r.current_step,'reply_error',left(p_error,220)); end if;
  update ta_flow_runs set error=left(p_error,220),claim_token=null,due_at=now()+interval '10 seconds',updated_at=now() where id=p_id returning * into r;return r;
 end if;
 if p_cursor<0 or p_cursor is null or p_account is null then raise exception 'Cursor de resposta inválido.'; end if;
 seconds:=coalesce(r.remaining_seconds,(r.snapshot->'steps'->r.current_step->>'timeoutSeconds')::double precision,0);
 initial_cursor:=coalesce(r.reply_after_message_id,p_cursor);
 update ta_flow_runs set status='awaiting_reply',wait_token=gen_random_uuid(),wait_started_at=now(),reply_cursor=initial_cursor,
  reply_account_id=p_account,reply_deadline=case when seconds>0 then now()+make_interval(secs=>seconds) else null end,
  remaining_seconds=null,reply_checked_at=null,poll_token=null,poll_until=null,claim_token=null,error=null,updated_at=now()
 where id=p_id returning * into r;
 insert into ta_flow_logs(run_id,step,event) values(r.id,r.current_step,'awaiting_reply');return r;
end $$;

create or replace function public.ta_flow_reply(p_id uuid,p_wait uuid,p_poll uuid,p_step integer,p_account text,p_dialog text,
 p_messages jsonb,p_cursor bigint,p_complete boolean,p_checked_at timestamptz,p_error text default null)
returns public.ta_flow_runs language plpgsql set search_path=public as $$
declare r ta_flow_runs; m jsonb; accepted jsonb; mid bigint; stamp timestamptz; matched boolean:=false; action text; next_step integer;
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
   and (r.reply_after_message_id is not null or stamp>=date_trunc('second',r.wait_started_at)) and stamp<=now()+interval '1 second'
   and (r.reply_deadline is null or stamp<=r.reply_deadline) then
   insert into ta_flow_inbound(account_id,dialog_id,message_id,run_id,step,wait_token,message_at,payload)
   values(p_account,r.dialog_id,mid,r.id,r.current_step,r.wait_token,stamp,m) on conflict do nothing;
   if found then accepted:=m;insert into ta_flow_logs(run_id,step,event,message_id,detail) values(r.id,r.current_step,'reply_received',mid::text,left(coalesce(m->>'text',''),220));matched:=true;exit; end if;
  end if;
 end loop;
 if matched then
  insert into ta_flow_logs(run_id,step,event) values(r.id,r.current_step,'completed'),(r.id,r.current_step,'resumed');
  update ta_flow_runs set current_step=current_step+1,transition_count=transition_count+1,
   status=case when current_step+1>=jsonb_array_length(snapshot->'steps') then 'done' else 'running' end,
   completed_at=case when current_step+1>=jsonb_array_length(snapshot->'steps') then now() else null end,
   due_at=now(),poll_token=null,poll_until=null,wait_token=null,last_reply=accepted,reply_after_message_id=mid,error=null,updated_at=now()
  where id=p_id returning * into r;
 elsif p_complete and r.reply_deadline is not null and p_checked_at>=r.reply_deadline+interval '1 second' and now()>=p_checked_at then
  action:=coalesce(r.snapshot->'steps'->r.current_step->>'timeoutAction','end');
  insert into ta_flow_logs(run_id,step,event) values(r.id,r.current_step,'reply_timeout');
  if action='followup' then
   update ta_flow_runs set status='running',dispatch_kind='followup',due_at=now(),wait_token=null,poll_token=null,poll_until=null,error=null,reply_after_message_id=null,updated_at=now() where id=p_id returning * into r;
  else
   next_step:=case when action='goto' then ta_flow_step_index(r.snapshot,r.snapshot->'steps'->r.current_step->>'timeoutStepId',r.current_step+1) else r.current_step+1 end;
   update ta_flow_runs set current_step=next_step,transition_count=transition_count+1,
    status=case when action='end' or next_step>=jsonb_array_length(snapshot->'steps') then 'done' else 'running' end,
    completed_at=case when action='end' or next_step>=jsonb_array_length(snapshot->'steps') then now() else null end,
    due_at=now(),wait_token=null,poll_token=null,poll_until=null,error=null,reply_after_message_id=null,updated_at=now() where id=p_id returning * into r;
  end if;
 else
  update ta_flow_runs set reply_cursor=greatest(reply_cursor,p_cursor),poll_token=null,poll_until=null,error=null where id=p_id returning * into r;
 end if;
 return r;
end $$;

create or replace function public.ta_flow_finish(p_id uuid,p_token uuid,p_status text,p_message text default null,p_error text default null)
returns public.ta_flow_runs language plpgsql set search_path=public as $$
declare r ta_flow_runs; message_number bigint; manual_pending boolean:=false; next_type text;
begin
 select * into r from ta_flow_runs where id=p_id for update;
 if not found then raise exception 'Execução não encontrada.'; end if;
 if r.claim_token is distinct from p_token or r.status not in ('sending','uncertain') then return r; end if;
 if p_status not in ('completed','error','uncertain') then raise exception 'Resultado inválido.'; end if;
 if p_message~'^\d+$' then message_number:=p_message::bigint; end if;
 if p_status='completed' and message_number is not null then
  insert into ta_flow_outbound(dialog_id,message_id,message_at,run_id,automation,processed)
  values(r.dialog_id,message_number,now(),r.id,true,true)
  on conflict(dialog_id,message_id) do update set run_id=excluded.run_id,automation=true,processed=true;
  select exists(select 1 from ta_flow_outbound where run_id=r.id and not automation and not processed
   and (r.send_started_at is null or message_at>=r.send_started_at-interval '1 second')) into manual_pending;
  update ta_flow_outbound set processed=true where run_id=r.id and not automation and not processed;
 end if;
 insert into ta_flow_logs(run_id,step,event,message_id,detail) values(r.id,r.current_step,
  case when p_status='completed' and r.dispatch_kind='followup' then 'followup_sent' else p_status end,p_message,p_error);
 if p_status='completed' then
  r.current_step:=r.current_step+1;r.transition_count:=r.transition_count+1;
  next_type:=r.snapshot->'steps'->r.current_step->>'type';
  r.status:=case when r.cancel_requested then 'cancelled' when r.pause_requested or manual_pending then 'paused'
   when r.current_step>=jsonb_array_length(r.snapshot->'steps') then 'done' else 'running' end;
 else r.status:=p_status; end if;
 update ta_flow_runs set current_step=r.current_step,transition_count=r.transition_count,status=r.status,error=p_error,
  completed_at=case when r.status in ('done','error','cancelled') then now() else null end,
  resume_status=case when r.status='paused' then 'running' else null end,
  human_takeover=case when manual_pending then true else human_takeover end,
  due_at=now(),updated_at=now(),claim_token=null,send_started=false,send_started_at=null,dispatch_kind='step',pause_requested=false,
  reply_after_message_id=case when p_status='completed' and next_type='reply' then message_number else null end
 where id=r.id returning * into r;
 if manual_pending then insert into ta_flow_logs(run_id,step,event,detail) values(r.id,greatest(0,r.current_step-1),'human_message_detected','Mensagem manual detectada durante o envio automático.'); end if;
 return r;
end $$;

create or replace function public.ta_flow_incoming(p_account text,p_dialog text,p_message bigint,p_date timestamptz,p_text text,p_type text,p_target jsonb)
returns public.ta_flow_runs language plpgsql set search_path=public as $$
declare r ta_flow_runs; f ta_flows; lead ta_flow_leads; first_message boolean:=false; new_conversation boolean:=false; inserted boolean:=false; matched boolean; op text; keyword text;
begin
 if p_account='' or p_message<=0 or p_date is null then raise exception 'Atualização recebida inválida.'; end if;
 insert into ta_flow_updates(account_id,dialog_id,message_id,message_at,message_text,message_type,target)
 values(p_account,p_dialog,p_message,p_date,left(coalesce(p_text,''),4096),left(coalesce(p_type,'message'),80),coalesce(p_target,'{}'::jsonb)) on conflict do nothing;
 inserted:=found;
 if not inserted then select * into r from ta_flow_runs where dialog_id=p_dialog and status in ('running','waiting','sending','uncertain','arming_reply','awaiting_reply','paused') order by started_at desc limit 1;return r; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_dialog,0));
 select * into lead from ta_flow_leads where dialog_id=p_dialog for update;
 first_message:=not found;
 if first_message then
  new_conversation:=true;
  insert into ta_flow_leads(dialog_id,profile,first_seen_at,last_seen_at) values(p_dialog,coalesce(p_target,'{}'::jsonb),p_date,p_date);
 else
  new_conversation:=lead.last_seen_at<p_date-interval '24 hours';
  update ta_flow_leads set profile=coalesce(p_target,profile),last_seen_at=greatest(last_seen_at,p_date),inbound_count=inbound_count+1 where dialog_id=p_dialog;
 end if;
 select * into r from ta_flow_runs where dialog_id=p_dialog and status='awaiting_reply' for update;
 if found and r.reply_account_id=p_account and p_message>r.reply_cursor
  and (r.reply_after_message_id is not null or p_date>=date_trunc('second',r.wait_started_at))
  and (r.reply_deadline is null or p_date<=r.reply_deadline) then
  insert into ta_flow_inbound(account_id,dialog_id,message_id,run_id,step,wait_token,message_at,payload)
  values(p_account,p_dialog,p_message,r.id,r.current_step,r.wait_token,p_date,jsonb_build_object('id',p_message,'date',extract(epoch from p_date)::bigint,'dialogId',p_dialog,'senderId',p_dialog,'text',left(coalesce(p_text,''),4096),'type',p_type)) on conflict do nothing;
  if found then
   insert into ta_flow_logs(run_id,step,event,message_id,detail) values(r.id,r.current_step,'reply_received',p_message::text,left(coalesce(p_text,''),220));
   insert into ta_flow_logs(run_id,step,event) values(r.id,r.current_step,'completed'),(r.id,r.current_step,'resumed');
   update ta_flow_runs set current_step=current_step+1,transition_count=transition_count+1,
    status=case when current_step+1>=jsonb_array_length(snapshot->'steps') then 'done' else 'running' end,
    completed_at=case when current_step+1>=jsonb_array_length(snapshot->'steps') then now() else null end,due_at=now(),
    poll_token=null,poll_until=null,wait_token=null,last_reply=jsonb_build_object('id',p_message,'date',p_date,'text',left(coalesce(p_text,''),4096),'type',p_type),
    reply_after_message_id=p_message,error=null,updated_at=now() where id=r.id returning * into r;
   update ta_flow_updates set run_id=r.id where account_id=p_account and dialog_id=p_dialog and message_id=p_message;return r;
  end if;
 end if;
 select * into r from ta_flow_runs where dialog_id=p_dialog and status in ('running','waiting','sending','uncertain','arming_reply','awaiting_reply','paused') order by started_at desc limit 1;
 if found then return r; end if;
 for f in select * from ta_flows where active and deleted_at is null and coalesce(trigger->>'type','manual')<>'manual'
  order by case when trigger->>'type'='keyword' then 0 else 1 end,created_at loop
  matched:=false;
  if f.trigger->>'type'='first_message' then matched:=first_message;
  elsif f.trigger->>'type'='new_conversation' then matched:=new_conversation;
  elsif f.trigger->>'type'='keyword' and coalesce(p_text,'')<>'' then
   op:=coalesce(f.trigger->>'operator','contains');
   for keyword in select value from jsonb_array_elements_text(coalesce(f.trigger->'keywords','[]'::jsonb)) loop
    matched:=case op when 'equals' then lower(trim(p_text))=lower(trim(keyword)) when 'starts_with' then lower(trim(p_text)) like lower(trim(keyword))||'%' else position(lower(trim(keyword)) in lower(trim(p_text)))>0 end;
    exit when matched;
   end loop;
  end if;
  if matched then
   r:=ta_flow_begin(gen_random_uuid(),f.id,p_dialog,coalesce(nullif(p_target->>'name',''),p_dialog),p_target,'trigger:'||coalesce(f.trigger->>'type','manual'),p_message);
   update ta_flow_updates set run_id=r.id where account_id=p_account and dialog_id=p_dialog and message_id=p_message;return r;
  end if;
 end loop;
 return null;
end $$;

create or replace function public.ta_flow_outgoing(p_dialog text,p_message bigint,p_date timestamptz)
returns public.ta_flow_runs language plpgsql set search_path=public as $$
declare r ta_flow_runs; e ta_flow_outbound;
begin
 if p_message<=0 or p_date is null then raise exception 'Atualização enviada inválida.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_dialog,0));
 insert into ta_flow_outbound(dialog_id,message_id,message_at) values(p_dialog,p_message,p_date) on conflict do nothing;
 select * into e from ta_flow_outbound where dialog_id=p_dialog and message_id=p_message;
 select * into r from ta_flow_runs where dialog_id=p_dialog and status in ('running','waiting','sending','uncertain','arming_reply','awaiting_reply','paused') order by started_at desc limit 1 for update;
 if not found or e.automation then return r; end if;
 update ta_flow_outbound set run_id=r.id where dialog_id=p_dialog and message_id=p_message;
 if coalesce((r.snapshot->'settings'->>'pauseOnHuman')::boolean,true)=false then
  update ta_flow_outbound set processed=true where dialog_id=p_dialog and message_id=p_message;return r;
 end if;
 if r.status='sending' and r.send_started then
  insert into ta_flow_logs(run_id,step,event,message_id,detail) values(r.id,r.current_step,'human_message_pending',p_message::text,'Pausa será aplicada após confirmar o envio em andamento.');return r;
 end if;
 if r.status<>'paused' then
  update ta_flow_runs set status='paused',resume_status=case when status='sending' then 'running' else status end,
   remaining_seconds=case when status='waiting' then greatest(0.001,extract(epoch from due_at-now())) when status='awaiting_reply' and reply_deadline is not null then greatest(0.001,extract(epoch from reply_deadline-now())) else remaining_seconds end,
   human_takeover=true,claim_token=null,poll_token=null,wait_token=null,updated_at=now() where id=r.id returning * into r;
 else update ta_flow_runs set human_takeover=true where id=r.id returning * into r;
 end if;
 update ta_flow_outbound set processed=true where dialog_id=p_dialog and message_id=p_message;
 insert into ta_flow_logs(run_id,step,event,message_id,detail) values(r.id,r.current_step,'human_message_detected',p_message::text,'Automação pausada por mensagem manual.');return r;
end $$;

-- Atualiza apenas o trecho de reinício/pulo para preservar perfil e contagem da Parte 3.
create or replace function public.ta_flow_control(p_id uuid,p_request uuid,p_action text,p_version bigint)
returns public.ta_flow_runs language plpgsql set search_path=public as $$
declare r ta_flow_runs; c ta_flow_commands; n ta_flow_runs; next_status text;
begin
 select * into r from ta_flow_runs where id=p_id;if not found then raise exception 'Execução não encontrada.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(r.dialog_id,0));select * into r from ta_flow_runs where id=p_id for update;
 select * into c from ta_flow_commands where request_id=p_request;
 if found then if c.run_id<>p_id or c.action<>p_action then raise exception 'Comando já utilizado.'; end if;select * into n from ta_flow_runs where id=c.result_id;return n;end if;
 if r.control_version<>p_version then raise exception 'Execução mudou. Atualize antes de repetir o comando.'; end if;
 if p_action in ('pause','human') then
  if r.status not in ('running','waiting','sending','arming_reply','awaiting_reply','paused') then raise exception 'Não é possível pausar este estado.'; end if;
  if r.status='sending' and r.send_started then update ta_flow_runs set pause_requested=true,human_takeover=(p_action='human' or human_takeover),updated_at=now() where id=p_id returning * into r;
  elsif r.status<>'paused' then update ta_flow_runs set status='paused',resume_status=case when status='sending' then 'running' else status end,
   remaining_seconds=case when status='waiting' then greatest(0.001,extract(epoch from due_at-now())) when status='awaiting_reply' and reply_deadline is not null then greatest(0.001,extract(epoch from reply_deadline-now())) else remaining_seconds end,
   human_takeover=(p_action='human' or human_takeover),claim_token=null,poll_token=null,wait_token=null,updated_at=now() where id=p_id returning * into r;
  else update ta_flow_runs set human_takeover=(p_action='human' or human_takeover) where id=p_id returning * into r;end if;
 elsif p_action='resume' then
  if r.status<>'paused' then raise exception 'O fluxo não está pausado.'; end if;
  next_status:=case when r.resume_status in ('awaiting_reply','arming_reply') then 'arming_reply' when r.resume_status='waiting' then 'waiting' else 'running' end;
  update ta_flow_runs set status=next_status,due_at=case when next_status='waiting' then now()+make_interval(secs=>coalesce(remaining_seconds,0)) else now() end,
   human_takeover=false,pause_requested=false,remaining_seconds=case when next_status='arming_reply' then remaining_seconds else null end,claim_token=null,updated_at=now() where id=p_id returning * into r;
 elsif p_action in ('cancel','restart','skip') then
  if r.status='sending' and r.send_started and p_action<>'cancel' then raise exception 'Aguarde o envio em andamento antes de pular ou reiniciar.'; end if;
  if p_action='cancel' then
   if r.status not in ('done','error','cancelled') then update ta_flow_runs set cancel_requested=true,status=case when status='sending' and send_started then 'sending' else 'cancelled' end,
    completed_at=case when status='sending' and send_started then null else now() end,poll_token=null,wait_token=null,updated_at=now() where id=p_id returning * into r;end if;
  elsif p_action='skip' then
   if r.status not in ('running','waiting','arming_reply','awaiting_reply','paused','sending') then raise exception 'Não é possível pular este estado.'; end if;
   update ta_flow_runs set current_step=current_step+1,transition_count=transition_count+1,status=case when status='paused' then 'paused' when current_step+1>=jsonb_array_length(snapshot->'steps') then 'done' else 'running' end,
    completed_at=case when status<>'paused' and current_step+1>=jsonb_array_length(snapshot->'steps') then now() else null end,resume_status='running',remaining_seconds=null,
    claim_token=null,poll_token=null,wait_token=null,dispatch_kind='step',reply_after_message_id=null,due_at=now(),updated_at=now() where id=p_id returning * into r;
  else
   if r.status='uncertain' then raise exception 'Confira e cancele o envio incerto antes de reiniciar.'; end if;
   if r.restarted_to is not null then select * into n from ta_flow_runs where id=r.restarted_to;return n;end if;
   if exists(select 1 from ta_flow_runs where dialog_id=r.dialog_id and id<>p_id and status in ('running','waiting','sending','uncertain','arming_reply','awaiting_reply','paused')) then raise exception 'Outro fluxo ocupa esta conversa.'; end if;
   update ta_flow_runs set status='cancelled',completed_at=now(),claim_token=null,poll_token=null,wait_token=null,updated_at=now() where id=p_id;
   insert into ta_flow_runs(id,flow_id,dialog_id,target_name,target,started_by,snapshot,restarted_from)
   values(p_request,r.flow_id,r.dialog_id,r.target_name,r.target,'manual:restart',r.snapshot,r.id) returning * into n;
   update ta_flow_runs set restarted_to=n.id where id=p_id;
   insert into ta_flow_logs(run_id,step,event,detail) values(n.id,0,'started','Reinício da execução '||p_id),(p_id,r.current_step,'restarted',n.id::text);
   insert into ta_flow_commands(request_id,run_id,action,result_id) values(p_request,p_id,p_action,n.id);return n;
  end if;
 else raise exception 'Comando inválido.';end if;
 insert into ta_flow_logs(run_id,step,event) values(p_id,case when p_action='skip' then greatest(0,r.current_step-1) else r.current_step end,p_action);
 insert into ta_flow_commands(request_id,run_id,action,result_id) values(p_request,p_id,p_action,p_id);return r;
end $$;

create or replace function public.ta_flow_capabilities() returns jsonb language sql as $$
 select '{"version":3,"activityIndicators":{"typing":true,"recordAudio":true,"uploadAudio":true,"uploadPhoto":true,"uploadVideo":true,"uploadDocument":true}}'::jsonb
$$;

alter table public.ta_flow_leads enable row level security;
alter table public.ta_flow_updates enable row level security;
alter table public.ta_flow_outbound enable row level security;
revoke all on public.ta_flow_leads,public.ta_flow_updates,public.ta_flow_outbound from anon,authenticated;
grant select,insert,update,delete on public.ta_flow_leads,public.ta_flow_updates,public.ta_flow_outbound to service_role;
do $$declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'ta_flow_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
