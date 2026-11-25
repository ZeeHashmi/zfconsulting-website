create table if not exists public.zf_visitor_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.zf_visitor_admins enable row level security;
revoke all on table public.zf_visitor_admins from public, anon, authenticated;

create or replace function public.get_zf_visitor_dashboard(p_days smallint default 30)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_start_date date;
begin
  if v_user_id is null or not exists (
    select 1
    from public.zf_visitor_admins as admin
    where admin.user_id = v_user_id
  ) then
    raise exception using errcode = '42501', message = 'Dashboard access denied';
  end if;

  if p_days < 7 or p_days > 90 then
    raise exception using errcode = '22023', message = 'Date range must be between 7 and 90 days';
  end if;

  v_start_date := current_date - (p_days - 1);

  return jsonb_build_object(
    'generated_at', to_jsonb(now()),
    'start_date', to_jsonb(v_start_date),
    'days', to_jsonb(p_days),
    'daily', coalesce((
      select jsonb_agg(to_jsonb(daily_row) order by daily_row.visit_date)
      from public.zf_visitor_daily_overview as daily_row
      where daily_row.visit_date >= v_start_date
    ), '[]'::jsonb),
    'pages', coalesce((
      select jsonb_agg(to_jsonb(page_row) order by page_row.interest_actions desc, page_row.page_views desc)
      from (
        select
          page.page_path,
          sum(page.page_views) as page_views,
          sum(page.anonymous_sessions) as anonymous_sessions,
          sum(page.interest_actions) as interest_actions,
          sum(page.pricing_clicks) as pricing_clicks,
          sum(page.contact_clicks) as contact_clicks,
          sum(page.email_clicks) as email_clicks,
          sum(page.phone_clicks) as phone_clicks
        from public.zf_visitor_page_interest as page
        where page.visit_date >= v_start_date
        group by page.page_path
      ) as page_row
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(to_jsonb(source_row) order by source_row.interest_actions desc, source_row.page_views desc)
      from (
        select
          source.source,
          sum(source.page_views) as page_views,
          sum(source.anonymous_sessions) as anonymous_sessions,
          sum(source.interest_actions) as interest_actions
        from public.zf_visitor_traffic_sources as source
        where source.visit_date >= v_start_date
        group by source.source
        order by sum(source.interest_actions) desc, sum(source.page_views) desc
        limit 12
      ) as source_row
    ), '[]'::jsonb),
    'countries', coalesce((
      select jsonb_agg(to_jsonb(country_row) order by country_row.interest_actions desc, country_row.page_views desc)
      from (
        select
          country.country_code,
          sum(country.page_views) as page_views,
          sum(country.anonymous_sessions) as anonymous_sessions,
          sum(country.interest_actions) as interest_actions
        from public.zf_visitor_country_trends as country
        where country.visit_date >= v_start_date
        group by country.country_code
        order by sum(country.interest_actions) desc, sum(country.page_views) desc
        limit 12
      ) as country_row
    ), '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.get_zf_visitor_dashboard(smallint) from public, anon;
grant execute on function public.get_zf_visitor_dashboard(smallint) to authenticated;
