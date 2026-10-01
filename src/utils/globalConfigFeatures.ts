import { supabase } from "@/integrations/supabase/client";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const readGlobalFeatures = async (organizationId: string): Promise<Record<string, unknown>> => {
  const { data, error } = await supabase
    .from("global_configs")
    .select("features")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throw error;
  return isRecord(data?.features) ? data.features : {};
};

export const upsertGlobalFeatures = async (
  organizationId: string,
  nextFeatures: Record<string, unknown>,
): Promise<string | null> => {
  const { data, error } = await supabase
    .from("global_configs")
    .upsert({
      organization_id: organizationId,
      features: nextFeatures,
    }, { onConflict: "organization_id" })
    .select("id")
    .single();

  if (error) throw error;
  return data?.id ?? null;
};

export const mergeGlobalFeatureSection = async (
  organizationId: string,
  buildNextFeatures: (currentFeatures: Record<string, unknown>) => Record<string, unknown>,
): Promise<string | null> => {
  const currentFeatures = await readGlobalFeatures(organizationId);
  return upsertGlobalFeatures(organizationId, buildNextFeatures(currentFeatures));
};
