ALTER TABLE public.dataspace_params
ADD COLUMN IF NOT EXISTS visible_for_software_ids UUID[] DEFAULT '{}';
