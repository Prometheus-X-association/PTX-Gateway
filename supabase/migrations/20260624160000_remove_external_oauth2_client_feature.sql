-- The "OAuth2 Client" admin settings page has been removed entirely. It was
-- never wired into any execution path (no edge function ever read it), so
-- this is purely cleanup: strip the now-unused "externalOauth2Client" key
-- from the features JSONB blob on global_configs. No other keys in that
-- JSONB column, and no other tables, are touched.

UPDATE public.global_configs
SET features = features - 'externalOauth2Client'
WHERE features ? 'externalOauth2Client';
