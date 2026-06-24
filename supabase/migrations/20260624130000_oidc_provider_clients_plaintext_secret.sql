-- Admins need to view and copy an OIDC provider client's secret again later,
-- not just once at creation time. Store it as plaintext instead of a one-way
-- hash, consistent with how other outbound credentials (e.g.
-- organization_pdc_secrets.bearer_token) are already stored in this codebase.
-- Access remains locked down: RLS is enabled with no policies, and only the
-- service-role oidc-provider edge function (gated by org-admin checks) reads it.

ALTER TABLE public.oidc_provider_clients RENAME COLUMN client_secret_hash TO client_secret;
