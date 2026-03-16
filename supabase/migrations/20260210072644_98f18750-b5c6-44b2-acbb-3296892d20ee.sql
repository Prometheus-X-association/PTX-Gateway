
-- Add custom_function_code column to param_placeholders
ALTER TABLE public.param_placeholders
  ADD COLUMN custom_function_code text;
