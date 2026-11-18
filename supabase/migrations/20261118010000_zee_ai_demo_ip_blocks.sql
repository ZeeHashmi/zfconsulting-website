create table if not exists public.zee_ai_demo_ip_blocks (
  ip_hash text primary key check (ip_hash ~ '^[0-9a-f]{64}$'),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  blocked_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at > blocked_at)
);

create index if not exists zee_ai_demo_ip_blocks_expires_at
  on public.zee_ai_demo_ip_blocks (expires_at);

alter table public.zee_ai_demo_ip_blocks enable row level security;
revoke all on table public.zee_ai_demo_ip_blocks from public, anon, authenticated;

create or replace function public.is_zee_ai_demo_ip_blocked(p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_ip_hash is null
    or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid IP block identifier';
  end if;

  delete from public.zee_ai_demo_ip_blocks
  where expires_at <= now();

  return exists (
    select 1
    from public.zee_ai_demo_ip_blocks as blocked_ip
    where blocked_ip.ip_hash = p_ip_hash
      and blocked_ip.expires_at > now()
  );
end;
$function$;

create or replace function public.remember_zee_ai_demo_ip_block(
  p_ip_hash text,
  p_country_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_ip_hash is null
    or p_country_code is null
    or p_ip_hash !~ '^[0-9a-f]{64}$'
    or p_country_code !~ '^[A-Z]{2}$'
    or p_country_code = 'AU' then
    raise exception using errcode = '22023', message = 'Invalid IP block';
  end if;

  delete from public.zee_ai_demo_ip_blocks
  where expires_at <= now();

  insert into public.zee_ai_demo_ip_blocks (
    ip_hash,
    country_code,
    blocked_at,
    expires_at
  )
  values (
    p_ip_hash,
    p_country_code,
    now(),
    now() + interval '30 days'
  )
  on conflict (ip_hash) do update
  set country_code = excluded.country_code,
      blocked_at = excluded.blocked_at,
      expires_at = excluded.expires_at;
end;
$function$;

revoke all on function public.is_zee_ai_demo_ip_blocked(text)
  from public, anon, authenticated;
revoke all on function public.remember_zee_ai_demo_ip_block(text, text)
  from public, anon, authenticated;
grant execute on function public.is_zee_ai_demo_ip_blocked(text) to service_role;
grant execute on function public.remember_zee_ai_demo_ip_block(text, text)
  to service_role;