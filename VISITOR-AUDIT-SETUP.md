# ZF Digital Visitor Audit deployment

This feature is intentionally isolated on the `feature/digital-visitor-audit` branch. It is not live until the database migration and Edge Function are deployed and the branch is reviewed and merged.

## Design and privacy controls

- The public visitor record is a local browser preview. It does not display an IP address and does not claim to identify a person or create a legal signature.
- A visitor event is submitted only after the visitor presses **Agree and create my record**.
- The Edge Function derives browser, operating system and device type from the request User-Agent. It reads the connecting IP only in memory, converts it to a keyed HMAC, and stores only the first 12 hex characters as a network reference. The raw IP is not written to the audit table.
- Country is recorded only when a valid `cf-ipcountry` header is present.
- Events become unavailable to the dashboard after 30 days. Expired rows are purged on subsequent API activity; configure a daily Supabase scheduled cleanup before production. The public endpoint is origin-restricted and rate-limited to 20 events per IP per hour.
- The admin endpoint requires a valid Supabase Auth access token and an exact email match against `VISITOR_AUDIT_ADMIN_EMAIL`. Only the Edge Function service role can read the audit table. Never put a service-role key in website JavaScript.
- This is an operational audit record, not a digital signature, identity verification, fraud determination or legal evidence of who used a device.

## Supabase setup (manual deployment required)

1. Review and apply `supabase/migrations/20261119000000_visitor_audit.sql` to the existing Supabase project.
2. Set Edge Function secrets:
   - `VISITOR_AUDIT_HMAC_SECRET`: a newly generated random secret of at least 32 characters.
   - `VISITOR_AUDIT_ADMIN_EMAIL`: the exact email address of the administrator's Supabase Auth account.
   - Existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied by Supabase to Edge Functions.
3. Add the function configuration in `supabase/config.toml` with `verify_jwt = false`. The function performs its own allowlist check for the admin GET route. The public POST route is protected by consent, origin checks, payload validation and database rate limiting; origin checks are not authentication.
4. Deploy `supabase/functions/visitor-audit/index.ts` as the `visitor-audit` Edge Function.
5. Create or confirm the administrator's Supabase Auth account and enable MFA for it. Set the Auth site's allowed redirect URLs and password policy appropriately.
6. Configure a daily Supabase Cron job to delete rows from `public.visitor_audit_events` where `expires_at <= now()` and rate-limit rows where `window_started_at <= now() - interval '24 hours'`. Confirm the job runs successfully.
7. Test a consented visit, test that an unauthenticated GET is rejected, test that a non-allowlisted account is rejected, and verify that the raw IP is absent from the database.
8. Review the Privacy Policy and retention approach against the organisation's actual practices before merging and publishing.

## Local preview

Open `visitor-audit.html` from the deployed preview or a local web server. The page can render the local visitor details before the backend is deployed. Submitting the event will fail safely until the Edge Function and migration are deployed.

## Admin page

After deployment, open `visitor-admin.html` and sign in with the configured administrator account. The access token is held in memory only. The admin page is not linked from public navigation and is marked `noindex,nofollow`; this is not a substitute for authentication.
