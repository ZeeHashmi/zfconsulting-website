# Zee AI demo setup

The public website uses the Supabase publishable key in
`supabase-demo-config.js`. It selects the production project only on
`zfconsulting.com.au` and `www.zfconsulting.com.au`; all other hosts use the
local Supabase URL and require a local publishable key. Never put the OpenAI
key or Supabase service-role key in the browser or repository.

## Configure the Supabase project

1. In the target Supabase database, run these migrations in timestamp order:
   `migrations/20261118000000_zee_ai_demo_rate_limits.sql` and
   `migrations/20261118010000_zee_ai_demo_ip_blocks.sql`.
2. Set `ZEE_AI_ENV=production` in the production Edge Function environment.
   The production function allows only the two production website origins.
3. Add these Edge Function secrets in the production Supabase project settings:
   - `OPENAI_API_KEY`: an API key from your OpenAI account.
   - `RATE_LIMIT_SECRET`: a private random value of at least 32 characters.
4. Deploy the `zee-ai-demo` Edge Function and the project's function config.
   Supabase CLI is required for deployment. Do not put either secret in this
   repository or in the browser.
5. Confirm the function works before publishing the website changes.

For local development, start the local Supabase stack and serve the function
with `supabase functions serve zee-ai-demo --env-file supabase/.env.local`.
Keep that environment file local-only. Set `ZEE_AI_ENV=development`,
`SUPABASE_URL=http://127.0.0.1:54321`, the local
`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, and `RATE_LIMIT_SECRET`. The
development config uses `http://127.0.0.1:54321`; set its local publishable
key in the development entry of `supabase-demo-config.js` while testing. The
publishable key is public; never use the service-role key there. The development function
allows only `http://localhost:8004` and `http://127.0.0.1:8004`. Do not use
development credentials in production or production credentials for local
testing.

## ZF Visitor Intelligence

Run `migrations/20261125000000_zf_visitor_intelligence.sql`, set the private
`VISITOR_INTELLIGENCE_SECRET` Edge Function secret to a random value of at
least 32 characters, then deploy `zf-visitor-intelligence`. `RATE_LIMIT_SECRET`
is accepted as a fallback but a separate secret is preferred. The function is
configured as public (`verify_jwt = false`) so the static website can submit
strictly validated analytics events, while the underlying tables, functions and
reporting views remain inaccessible to `anon` and `authenticated` roles.

Run `migrations/20261125010000_zf_visitor_dashboard.sql` after the event
migration. In Supabase Authentication, create the administrator account with
email/password sign-in enabled. Copy that account's UUID from the Users table
and authorize it in the SQL editor:

```sql
insert into public.zf_visitor_admins (user_id)
values ('REPLACE_WITH_ADMIN_USER_UUID')
on conflict do nothing;
```

The private dashboard is `visitor-intelligence.html`. It uses Supabase
Authentication and an aggregate-only RPC; it does not expose event rows,
session hashes, rate-limit hashes or a service-role key. The authenticated RPC
rejects any user not present in `zf_visitor_admins`. Keep the dashboard URL
unlinked from public navigation and prevent search indexing at the host level
if an additional indexing control is available.

Query the private aggregate views from the Supabase SQL editor or an
admin server-side tool: `zf_visitor_daily_overview`, `zf_visitor_page_interest`,
`zf_visitor_traffic_sources` and `zf_visitor_country_trends`. Do not grant
browser roles access to raw event or rate-limit tables. Event records are
deleted after 90 days during subsequent accepted writes; rate-limit hashes are
removed after 15 minutes. No raw IP address, email address, chat content or form
content is stored.

The function uses OpenAI's `gpt-4o-mini` by default; set `OPENAI_MODEL` as an
Edge Function secret to select another compatible model.

## Country access gate

The widget starts hidden and calls the Edge Function's `/access` route before
showing the chat launcher. The function checks the trusted Supabase
`cf-ipcountry` header first; it does not accept a country code from the browser body.
If that country is missing or unknown, the function uses the gateway's
`cf-connecting-ip` address for a server-side lookup with ipapi.co. That provider
receives the visitor IP only for this fallback lookup. Only country code `AU`
is allowed. If both sources fail, access fails closed without creating a block.
Confirm ipapi.co terms and request limits for production use. Australian
requests remain allowed even if a stale
block row exists. Other country codes are denied before any OpenAI request and
the function stores only an HMAC-SHA-256 IP hash and country code in
`zee_ai_demo_ip_blocks` for 30 days. The function checks the block table before
reserving any AI request. Expired block records are removed during a later
access check or when a new block is recorded. The function uses the gateway's
`cf-connecting-ip` header for IP hashing and `cf-ipcountry` for country; it
never trusts browser-supplied location data. Missing or malformed IP headers
fail closed. Do not expose the block table or its RPCs to anonymous clients.

## Demo limits and data

Each API request contains one new user message plus separate, validated prior
conversation context. The database reserves a slot before calling OpenAI and
counts it only after a valid AI response is ready. Failed requests release
their reservation; abandoned reservations expire after five minutes. The
limit is 10 successful messages per browser and 10 per IP address per UTC day.
The function reads the client IP only from Supabase gateway's
`cf-connecting-ip` header, then stores HMAC SHA-256 hashes and counts—not raw IP addresses or
chat content. Previous-day counters are deleted on a subsequent valid demo
request. The browser identifier is stored in local storage and can be reset
by clearing site data; the IP limit still applies.

OpenAI receives the current conversation context to generate a reply. The
website does not save chat messages in Supabase. Visitors must be told not to
enter confidential or sensitive information.
