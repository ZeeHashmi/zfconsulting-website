create table if not exists public.zf_visitor_events (
  event_id uuid primary key,
  occurred_at timestamptz not null default now(),
  session_hash text not null check (session_hash ~ '^[0-9a-f]{64}$'),
  event_type text not null check (event_type in ('page_view', 'interest_click')),
  page_path text not null,
  signal text check (signal in ('email', 'phone', 'pricing', 'contact')),
  referrer_domain text,
  country_code char(2),
  utm_source text,
  utm_medium text,
  utm_campaign text,
  constraint zf_visitor_signal_matches_event check (
    (event_type = 'page_view' and signal is null)
    or (event_type = 'interest_click' and signal is not null)
  )
);

create index if not exists zf_visitor_events_daily
  on public.zf_visitor_events (occurred_at desc, page_path, event_type);
create index if not exists zf_visitor_events_session_daily
  on public.zf_visitor_events ((occurred_at::date), session_hash);

create table if not exists public.zf_visitor_rate_limits (
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  bucket timestamptz not null,
  event_count integer not null default 0 check (event_count >= 0),
  primary key (ip_hash, bucket)
);

alter table public.zf_visitor_events enable row level security;
alter table public.zf_visitor_rate_limits enable row level security;
revoke all on table public.zf_visitor_events from public, anon, authenticated;
revoke all on table public.zf_visitor_rate_limits from public, anon, authenticated;

create or replace function public.record_zf_visitor_event(
  p_event_id uuid,
  p_session_hash text,
  p_ip_hash text,
  p_event_type text,
  p_page_path text,
  p_signal text,
  p_referrer_domain text,
  p_country_code text,
  p_utm_source text,
  p_utm_medium text,
  p_utm_campaign text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_bucket timestamptz := date_trunc('hour', now()) + (extract(minute from now())::integer / 5) * interval '5 minutes';
  v_count integer;
begin
  if p_session_hash !~ '^[0-9a-f]{64}$'
    or p_ip_hash !~ '^[0-9a-f]{64}$'
    or p_event_type not in ('page_view', 'interest_click') then
    raise exception using errcode = '22023', message = 'Invalid visitor event';
  end if;

  insert into public.zf_visitor_rate_limits (ip_hash, bucket, event_count)
  values (p_ip_hash, v_bucket, 0)
  on conflict (ip_hash, bucket) do nothing;

  delete from public.zf_visitor_rate_limits
  where bucket < now() - interval '15 minutes';

  select rate.event_count
  into v_count
  from public.zf_visitor_rate_limits as rate
  where rate.ip_hash = p_ip_hash and rate.bucket = v_bucket
  for update;

  if v_count >= 120 then
    return false;
  end if;

  insert into public.zf_visitor_events (
    event_id,
    session_hash,
    event_type,
    page_path,
    signal,
    referrer_domain,
    country_code,
    utm_source,
    utm_medium,
    utm_campaign
  ) values (
    p_event_id,
    p_session_hash,
    p_event_type,
    p_page_path,
    p_signal,
    p_referrer_domain,
    nullif(p_country_code, ''),
    p_utm_source,
    p_utm_medium,
    p_utm_campaign
  ) on conflict (event_id) do nothing;

  if found then
    update public.zf_visitor_rate_limits
    set event_count = event_count + 1
    where ip_hash = p_ip_hash and bucket = v_bucket;
  end if;

  delete from public.zf_visitor_events
  where occurred_at < now() - interval '90 days';

  return true;
end;
$function$;

revoke all on function public.record_zf_visitor_event(
  uuid, text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;

create or replace view public.zf_visitor_daily_overview
with (security_invoker = true) as
select
  occurred_at::date as visit_date,
  count(*) filter (where event_type = 'page_view') as page_views,
  count(distinct session_hash) filter (where event_type = 'page_view') as anonymous_sessions,
  count(*) filter (where event_type = 'interest_click') as interest_actions,
  count(distinct session_hash) filter (where event_type = 'interest_click') as interested_sessions,
  count(distinct country_code) filter (where country_code is not null) as countries
from public.zf_visitor_events
group by occurred_at::date;

create or replace view public.zf_visitor_page_interest
with (security_invoker = true) as
select
  occurred_at::date as visit_date,
  page_path,
  count(*) filter (where event_type = 'page_view') as page_views,
  count(distinct session_hash) filter (where event_type = 'page_view') as anonymous_sessions,
  count(*) filter (where event_type = 'interest_click') as interest_actions,
  count(*) filter (where signal = 'pricing') as pricing_clicks,
  count(*) filter (where signal = 'contact') as contact_clicks,
  count(*) filter (where signal = 'email') as email_clicks,
  count(*) filter (where signal = 'phone') as phone_clicks
from public.zf_visitor_events
group by occurred_at::date, page_path;

create or replace view public.zf_visitor_traffic_sources
with (security_invoker = true) as
select
  occurred_at::date as visit_date,
  coalesce(utm_source, referrer_domain, 'direct / unknown') as source,
  coalesce(utm_medium, 'unclassified') as medium,
  coalesce(utm_campaign, 'none') as campaign,
  count(*) filter (where event_type = 'page_view') as page_views,
  count(distinct session_hash) filter (where event_type = 'page_view') as anonymous_sessions,
  count(*) filter (where event_type = 'interest_click') as interest_actions
from public.zf_visitor_events
group by occurred_at::date, utm_source, referrer_domain, utm_medium, utm_campaign;

create or replace view public.zf_visitor_country_trends
with (security_invoker = true) as
select
  occurred_at::date as visit_date,
  coalesce(country_code, 'ZZ') as country_code,
  count(*) filter (where event_type = 'page_view') as page_views,
  count(distinct session_hash) filter (where event_type = 'page_view') as anonymous_sessions,
  count(*) filter (where event_type = 'interest_click') as interest_actions
from public.zf_visitor_events
group by occurred_at::date, country_code;

revoke all on public.zf_visitor_daily_overview from public, anon, authenticated;
revoke all on public.zf_visitor_page_interest from public, anon, authenticated;
revoke all on public.zf_visitor_traffic_sources from public, anon, authenticated;
revoke all on public.zf_visitor_country_trends from public, anon, authenticated;
