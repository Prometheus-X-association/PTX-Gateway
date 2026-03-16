-- Bootstrap base dataspace schema for fresh local databases.
-- Later migrations in this repository assume these objects already exist.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'resource_type'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.resource_type AS ENUM ('software', 'data', 'service_chain');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.dataspace_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  pdc_url TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dataspace_params (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID REFERENCES public.dataspace_configs(id) ON DELETE CASCADE,
  resource_type public.resource_type NOT NULL,
  resource_url TEXT NOT NULL,
  resource_name TEXT,
  resource_description TEXT,
  provider TEXT,
  service_offering TEXT,
  contract_url TEXT NOT NULL,
  parameters JSONB DEFAULT '[]'::jsonb,
  api_response_representation JSONB DEFAULT '{}'::jsonb,
  upload_file BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.service_chains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID REFERENCES public.dataspace_configs(id) ON DELETE CASCADE,
  catalog_id TEXT NOT NULL,
  contract_url TEXT NOT NULL,
  basis_information JSONB DEFAULT '{}'::jsonb,
  services JSONB DEFAULT '[]'::jsonb,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pdc_execution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID REFERENCES public.dataspace_configs(id) ON DELETE SET NULL,
  trace_id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  payload JSONB NOT NULL,
  pdc_response JSONB,
  status_code INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

