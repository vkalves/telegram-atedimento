-- Central de atendimento 6.2. Execute após CONFIGURAR.sql. Repetível, sem apagar dados.
begin;
create table if not exists public.ta_leads (
  account_id text not null,
  dialog_id text not null,
  name text not null default 'Conversa',
  username text,
  status text not null default 'open' check (status in ('open','waiting','snoozed','done')),
  status_changed_at timestamptz,
  priority integer not null default 0 check (priority between 0 and 2),
  tags text[] not null default '{}',
  notes text not null default '',
  owner text not null default '',
  due_at timestamptz,
  needs_reply boolean not null default false,
  waiting_since timestamptz,
  last_message_id bigint not null default 0,
  last_message_at timestamptz,
  last_preview text not null default '',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id,dialog_id)
);
alter table public.ta_leads add column if not exists status_changed_at timestamptz;
create index if not exists ta_leads_queue on public.ta_leads(account_id,status,priority desc,due_at,waiting_since);
create index if not exists ta_leads_reply on public.ta_leads(account_id,needs_reply,waiting_since);
create table if not exists public.ta_quick_replies (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'Geral',
  body text not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.ta_leads enable row level security;
alter table public.ta_quick_replies enable row level security;
revoke all on public.ta_leads,public.ta_quick_replies from anon,authenticated;
grant select,insert,update,delete on public.ta_leads,public.ta_quick_replies to service_role;

-- NewMessage and import may arrive concurrently or out of order. An older event
-- must never undo a reply, a snooze or a manual change. Notes/priority are preserved.
create or replace function public.ta_support_ingest(p_account text,p_dialog text,p_name text,p_username text,
 p_message bigint default 0,p_date timestamptz default null,p_incoming boolean default false,p_preview text default '')
returns public.ta_leads language plpgsql set search_path=public as $$
declare result public.ta_leads;
begin
 if p_account !~ '^[1-9][0-9]{0,19}$' or p_dialog !~ '^[1-9][0-9]{0,19}$' then raise exception 'Conversa inválida.'; end if;
 insert into ta_leads(account_id,dialog_id,name,username,last_message_id,last_message_at,needs_reply,waiting_since,last_preview,status)
 values(p_account,p_dialog,left(coalesce(nullif(p_name,''),'Conversa'),120),p_username,p_message,p_date,p_incoming,
 case when p_incoming then coalesce(p_date,now()) end,left(p_preview,160),case when p_message>0 and not p_incoming then 'waiting' else 'open' end)
 on conflict(account_id,dialog_id) do update set
 name=case when p_name<>'' then left(p_name,120) else ta_leads.name end,
 username=coalesce(p_username,ta_leads.username),
 last_message_id=greatest(ta_leads.last_message_id,p_message),
 last_message_at=case when p_message>ta_leads.last_message_id then p_date else ta_leads.last_message_at end,
 last_preview=case when p_message>ta_leads.last_message_id then left(p_preview,160) else ta_leads.last_preview end,
 needs_reply=case when p_message>ta_leads.last_message_id and (ta_leads.status_changed_at is null or p_date>ta_leads.status_changed_at) then p_incoming else ta_leads.needs_reply end,
 waiting_since=case when p_message>ta_leads.last_message_id and (ta_leads.status_changed_at is null or p_date>ta_leads.status_changed_at) then
   case when p_incoming then coalesce(ta_leads.waiting_since,p_date,now()) else null end else ta_leads.waiting_since end,
 status=case when p_message>ta_leads.last_message_id and (ta_leads.status_changed_at is null or p_date>ta_leads.status_changed_at) then
   case when p_incoming then 'open' when ta_leads.status='open' then 'waiting' else ta_leads.status end else ta_leads.status end,
 due_at=case when p_message>ta_leads.last_message_id and (ta_leads.status_changed_at is null or p_date>ta_leads.status_changed_at) and p_incoming and ta_leads.status in ('snoozed','done') then null else ta_leads.due_at end,
 version=ta_leads.version+1,updated_at=now()
 where p_message>ta_leads.last_message_id or (p_name<>'' and p_name<>ta_leads.name) or (p_username is not null and p_username is distinct from ta_leads.username)
 returning * into result;
 if result is null then select * into result from ta_leads where account_id=p_account and dialog_id=p_dialog; end if;
 return result;
end $$;

create or replace function public.ta_support_queue(p_account text,p_filter text default 'focus',p_search text default '',p_offset integer default 0,p_limit integer default 50)
returns jsonb language plpgsql stable set search_path=public as $$
declare result jsonb; needle text := '%'||replace(replace(replace(lower(p_search),'\','\\'),'%','\%'),'_','\_')||'%';
begin
 with filtered as (
 select * from ta_leads where account_id=p_account
 and (p_search='' or lower(name||' '||coalesce(username,'')||' '||owner||' '||array_to_string(tags,' ')) like needle)
 and case p_filter
 when 'focus' then status='open' or (status<>'done' and due_at<=now())
 when 'reply' then needs_reply and status<>'done' and (status<>'snoozed' or due_at<=now())
 when 'due' then status<>'done' and due_at<=now()
 when 'priority' then priority=2 and status<>'done'
 when 'all' then true else status=p_filter end
 ), page as (select * from filtered order by priority desc,due_at asc nulls last,waiting_since asc nulls last,updated_at asc,dialog_id asc
 limit least(greatest(p_limit,1),100) offset greatest(p_offset,0))
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb),'total',(select count(*) from filtered),
 'stats',(select jsonb_build_object('open',count(*) filter(where status='open'),'reply',count(*) filter(where needs_reply and status<>'done' and (status<>'snoozed' or due_at<=now())),
 'due',count(*) filter(where due_at<=now() and status<>'done'),'waiting',count(*) filter(where status='waiting'),'snoozed',count(*) filter(where status='snoozed'),
 'done',count(*) filter(where status='done'),'total',count(*)) from ta_leads where account_id=p_account)) into result;
 return result;
end $$;
revoke all on function public.ta_support_ingest(text,text,text,text,bigint,timestamptz,boolean,text) from public,anon,authenticated;
revoke all on function public.ta_support_queue(text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.ta_support_ingest(text,text,text,text,bigint,timestamptz,boolean,text) to service_role;
grant execute on function public.ta_support_queue(text,text,text,integer,integer) to service_role;
commit;
