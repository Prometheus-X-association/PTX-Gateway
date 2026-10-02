# Private browser access

In **Admin dashboard → Global settings → Organization**, add at least one browser credential, then enable **Private browser access only** and save the organization settings.

Visitors opening `/<organization-slug>` must enter a managed username and password. Browser credentials are separate from Supabase administrator accounts. Each credential supports editing, password replacement, optional start/end dates, revocation/restoration, and deletion. Date inputs use the administrator's browser time zone and are stored in UTC. Editing or revoking credentials invalidates existing sessions. Passwords use bcrypt and are never returned to the browser.

Browser sessions are stored in session storage and last at most eight hours, capped by the credential's end date. Visitors can sign out. The page rechecks access every 30 seconds and on window focus; processing, chat, insights, and workflow requests verify session validity on each request. Existing public processing tokens stop working when private access is enabled.

Embeds and web components continue to use their existing embed tokens. The processing-token endpoint validates the embed token server-side rather than trusting iframe detection or a query flag. Public discovery is independent of private browser access: an organization may be discoverable while still requiring credentials to enter its browser gateway. This controls entry to the gateway and its processing endpoints; existing public catalog/database read policies are unchanged.

The Organization page displays and downloads the latest 1,000 browser access events as JSON Lines. Events include access granted/denied, successful/failed sign-ins, sign-outs, and credential changes. Logs retain time, username when known, forwarded source IP when available, browser user agent, gateway URL, and referrer. URLs exclude query strings and fragments to avoid storing tokens. Logs remain after deleting a credential. IP accuracy depends on the deployment's proxy forwarding configuration. Sign-in attempts are limited to ten failures per organization/source IP in 15 minutes; when the proxy supplies no IP, the username is used instead.

## Deployment

1. Apply `supabase/migrations/20261002120000_browser_private_access.sql`.
2. Deploy `browser-access`, `pdc-auth`, `pdc-execute`, `chat-with-result`, `llm-insights`, and `workflow-api-request` with the shared helper. The new function uses the standard `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment variables. Its JWT gateway verification is disabled in `supabase/config.toml`; administrator actions verify the Supabase user, active membership, and organization super admin role inside the function.
3. Deploy the frontend. Add credentials and enable private browser access for the desired organization.

Credential, session, and log tables have RLS enabled with no client policies. Only the service-role edge function can read or write them. Password RPCs also grant execution only to the service role. Credentials and sessions are excluded from existing organization-settings backups because they live in separate tables.

## Validation

Run `npm run test:browser-access` for organization scoping, token hashes, expiry, scheduled/revoked credentials, deleted sessions, database failures, public-token invalidation, and browser/embed processing-token issuance. Run `npm run build` for the frontend build.
