create table if not exists public.zee_ai_demo_usage (
  identifier_kind text not null check (identifier_kind in ('browser', 'ip')),
  identifier_hash text not null check (identifier_hash ~ '^[0-9a-f]{64}$'),
  usage_date date not null,
  request_count smallint not null default 0 check (request_count between 0 and 10),
  primary key (identifier_kind, identifier_hash, usage_date)
);

create table if not exists public.zee_ai_demo_reservations (
  request_id uuid primary key,
  browser_hash text not null check (browser_hash ~ '^[0-9a-f]{64}$'),
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  usage_date date not null,
  created_at timestamptz not null default now()
);

create index if not exists zee_ai_demo_reservations_browser_daily
  on public.zee_ai_demo_reservations (browser_hash, usage_date);
create index if not exists zee_ai_demo_reservations_ip_daily
  on public.zee_ai_demo_reservations (ip_hash, usage_date);

alter table public.zee_ai_demo_usage enable row level security;
alter table public.zee_ai_demo_reservations enable row level security;
revoke all on table public.zee_ai_demo_usage from public, anon, authenticated;
revoke all on table public.zee_ai_demo_reservations from public, anon, authenticated;

drop function if exists public.consume_zee_ai_demo_request(text, text);

create or replace function public.reserve_zee_ai_demo_request(
  p_request_id uuid,
  p_browser_hash text,
  p_ip_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_usage_date date := (now() at time zone 'utc')::date;
  v_browser_count integer;
  v_ip_count integer;
  v_browser_pending bigint;
  v_ip_pending bigint;
begin
  if p_request_id is null
    or p_browser_hash !~ '^[0-9a-f]{64}$'
    or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid rate-limit identifier';
  end if;

  insert into public.zee_ai_demo_usage (
    identifier_kind,
    identifier_hash,
    usage_date,
    request_count
  )
  values
    ('browser', p_browser_hash, v_usage_date, 0),
    ('ip', p_ip_hash, v_usage_date, 0)
  on conflict do nothing;

  perform 1
  from public.zee_ai_demo_usage as usage
  where usage.usage_date = v_usage_date
    and (
      (usage.identifier_kind = 'browser' and usage.identifier_hash = p_browser_hash)
      or (usage.identifier_kind = 'ip' and usage.identifier_hash = p_ip_hash)
    )
  order by usage.identifier_kind, usage.identifier_hash
  for update;

  delete from public.zee_ai_demo_reservations
  where created_at < now() - interval '5 minutes';

  delete from public.zee_ai_demo_usage as usage
  where usage.usage_date < v_usage_date
    and not exists (
      select 1
      from public.zee_ai_demo_reservations as reservation
      where reservation.usage_date = usage.usage_date
        and (
          (usage.identifier_kind = 'browser'
            and reservation.browser_hash = usage.identifier_hash)
          or (usage.identifier_kind = 'ip'
            and reservation.ip_hash = usage.identifier_hash)
        )
    );

  select usage.request_count
  into v_browser_count
  from public.zee_ai_demo_usage as usage
  where usage.identifier_kind = 'browser'
    and usage.identifier_hash = p_browser_hash
    and usage.usage_date = v_usage_date;

  select usage.request_count
  into v_ip_count
  from public.zee_ai_demo_usage as usage
  where usage.identifier_kind = 'ip'
    and usage.identifier_hash = p_ip_hash
    and usage.usage_date = v_usage_date;

  select count(*)
  into v_browser_pending
  from public.zee_ai_demo_reservations as reservation
  where reservation.browser_hash = p_browser_hash
    and reservation.usage_date = v_usage_date;

  select count(*)
  into v_ip_pending
  from public.zee_ai_demo_reservations as reservation
  where reservation.ip_hash = p_ip_hash
    and reservation.usage_date = v_usage_date;

  if v_browser_count + v_browser_pending >= 10
    or v_ip_count + v_ip_pending >= 10 then
    return false;
  end if;

  insert into public.zee_ai_demo_reservations (
    request_id,
    browser_hash,
    ip_hash,
    usage_date
  )
  values (p_request_id, p_browser_hash, p_ip_hash, v_usage_date)
  on conflict do nothing;

  return found;
end;
$function$;

create or replace function public.complete_zee_ai_demo_request(
  p_request_id uuid,
  p_browser_hash text,
  p_ip_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_usage_date date;
  v_updated_rows integer;
begin
  if p_request_id is null
    or p_browser_hash !~ '^[0-9a-f]{64}$'
    or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid rate-limit identifier';
  end if;

  select reservation.usage_date
  into v_usage_date
  from public.zee_ai_demo_reservations as reservation
  where reservation.request_id = p_request_id
    and reservation.browser_hash = p_browser_hash
    and reservation.ip_hash = p_ip_hash;

  if not found then
    return false;
  end if;

  perform 1
  from public.zee_ai_demo_usage as usage
  where usage.usage_date = v_usage_date
    and (
      (usage.identifier_kind = 'browser' and usage.identifier_hash = p_browser_hash)
      or (usage.identifier_kind = 'ip' and usage.identifier_hash = p_ip_hash)
    )
  order by usage.identifier_kind, usage.identifier_hash
  for update;

  perform 1
  from public.zee_ai_demo_reservations as reservation
  where reservation.request_id = p_request_id
    and reservation.browser_hash = p_browser_hash
    and reservation.ip_hash = p_ip_hash
  for update;

  if not found then
    return false;
  end if;

  update public.zee_ai_demo_usage as usage
  set request_count = usage.request_count + 1
  where usage.usage_date = v_usage_date
    and (
      (usage.identifier_kind = 'browser' and usage.identifier_hash = p_browser_hash)
      or (usage.identifier_kind = 'ip' and usage.identifier_hash = p_ip_hash)
    );

  get diagnostics v_updated_rows = row_count;
  if v_updated_rows <> 2 then
    raise exception using errcode = 'P0001', message = 'Rate-limit usage counters are missing';
  end if;

  delete from public.zee_ai_demo_reservations
  where request_id = p_request_id;

  return true;
end;
$function$;

create or replace function public.release_zee_ai_demo_request(
  p_request_id uuid,
  p_browser_hash text,
  p_ip_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_usage_date date;
begin
  if p_request_id is null
    or p_browser_hash !~ '^[0-9a-f]{64}$'
    or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid rate-limit identifier';
  end if;

  select reservation.usage_date
  into v_usage_date
  from public.zee_ai_demo_reservations as reservation
  where reservation.request_id = p_request_id
    and reservation.browser_hash = p_browser_hash
    and reservation.ip_hash = p_ip_hash;

  if not found then
    return false;
  end if;

  perform 1
  from public.zee_ai_demo_usage as usage
  where usage.usage_date = v_usage_date
    and (
      (usage.identifier_kind = 'browser' and usage.identifier_hash = p_browser_hash)
      or (usage.identifier_kind = 'ip' and usage.identifier_hash = p_ip_hash)
    )
  order by usage.identifier_kind, usage.identifier_hash
  for update;

  delete from public.zee_ai_demo_reservations
  where request_id = p_request_id
    and browser_hash = p_browser_hash
    and ip_hash = p_ip_hash;

  return found;
end;
$function$;

revoke all on function public.reserve_zee_ai_demo_request(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.complete_zee_ai_demo_request(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.release_zee_ai_demo_request(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.reserve_zee_ai_demo_request(uuid, text, text)
  to service_role;
grant execute on function public.complete_zee_ai_demo_request(uuid, text, text)
  to service_role;
grant execute on function public.release_zee_ai_demo_request(uuid, text, text)
  to service_role;
