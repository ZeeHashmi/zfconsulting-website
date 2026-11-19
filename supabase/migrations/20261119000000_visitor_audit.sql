create table if not exists public.visitor_audit_events (
  id bigint generated always as identity primary key,
  visitor_id uuid not null,
  visited_path text not null check (length(visited_path) between 1 and 300),
  browser text not null check (length(browser) <= 80),
  operating_system text not null check (length(operating_system) <= 80),
  device_type text not null check (length(device_type) <= 40),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  ip_fingerprint text check (ip_fingerprint is null or ip_fingerprint ~ '^[0-9a-f]{12}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create index if not exists visitor_audit_events_created_at
  on public.visitor_audit_events (created_at desc);
create index if not exists visitor_audit_events_expires_at
  on public.visitor_audit_events (expires_at);

create table if not exists public.visitor_audit_rate_limits (
  ip_hash text primary key check (ip_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0)
);

alter table public.visitor_audit_events enable row level security;
alter table public.visitor_audit_rate_limits enable row level security;
revoke all on table public.visitor_audit_events from public, anon, authenticated;
revoke all on table public.visitor_audit_rate_limits from public, anon, authenticated;

create or replace function public.can_record_visitor_audit(p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_count integer;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  insert into public.visitor_audit_rate_limits (ip_hash, window_started_at, request_count)
  values (p_ip_hash, now(), 1)
  on conflict (ip_hash) do update
  set window_started_at = case
        when public.visitor_audit_rate_limits.window_started_at <= now() - interval '1 hour'
        then now()
        else public.visitor_audit_rate_limits.window_started_at
      end,
      request_count = case
        when public.visitor_audit_rate_limits.window_started_at <= now() - interval '1 hour'
        then 1
        else public.visitor_audit_rate_limits.request_count + 1
      end
  returning request_count into current_count;

  return current_count <= 20;
end;
$function$;

revoke all on function public.can_record_visitor_audit(text) from public, anon, authenticated;
grant execute on function public.can_record_visitor_audit(text) to service_role;
