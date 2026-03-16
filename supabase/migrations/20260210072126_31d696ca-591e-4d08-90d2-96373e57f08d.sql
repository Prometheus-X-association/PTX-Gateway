
-- Create param_placeholders table for custom automatic value definitions
CREATE TABLE public.param_placeholders (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  placeholder_key text NOT NULL, -- e.g. "#genSessionId", "#myCustomValue"
  placeholder_type text NOT NULL DEFAULT 'static', -- 'static' or 'dynamic'
  static_value text, -- Used when type is 'static'
  generator_type text, -- Used when type is 'dynamic': 'uuid', 'timestamp', 'random_string', 'session_id', 'date_iso'
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, placeholder_key)
);

-- Enable RLS
ALTER TABLE public.param_placeholders ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Members can read org placeholders"
  ON public.param_placeholders FOR SELECT
  USING (is_org_member(auth.uid(), organization_id));

CREATE POLICY "Admins can insert org placeholders"
  ON public.param_placeholders FOR INSERT
  WITH CHECK (is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can update org placeholders"
  ON public.param_placeholders FOR UPDATE
  USING (is_org_admin(auth.uid(), organization_id));

CREATE POLICY "Admins can delete org placeholders"
  ON public.param_placeholders FOR DELETE
  USING (is_org_admin(auth.uid(), organization_id));

-- Timestamp trigger
CREATE TRIGGER update_param_placeholders_updated_at
  BEFORE UPDATE ON public.param_placeholders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Seed built-in placeholders will be handled per-org in the application layer
