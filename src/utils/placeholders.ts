import { supabase } from "@/integrations/supabase/client";
import { GEN_SESSION_ID } from "@/utils/paramSanitizer";

export type PlaceholderValues = Record<string, string>;

export const resolveRuntimePlaceholder = (
  value: string,
  sessionId: string,
  placeholderValues?: PlaceholderValues,
): string => {
  const replacements: Array<[string, string]> = [
    [GEN_SESSION_ID, sessionId],
    ...Object.entries(placeholderValues || {}),
  ].sort(([left], [right]) => right.length - left.length);

  let resolved = "";
  let replaced = false;
  let offset = 0;
  while (offset < value.length) {
    const match = replacements.find(([placeholder]) =>
      placeholder.length > 0 && value.startsWith(placeholder, offset)
    );
    if (match) {
      resolved += match[1];
      offset += match[0].length;
      replaced = true;
    } else {
      resolved += value[offset];
      offset += 1;
    }
  }

  // Square brackets can be used to explicitly mark the complete value as a
  // placeholder template. They are delimiters and are not sent downstream.
  if (replaced && resolved.startsWith("[") && resolved.endsWith("]")) {
    return resolved.slice(1, -1);
  }

  return resolved;
};

export const resolveOrganizationPlaceholders = async (
  organizationId?: string | null,
): Promise<PlaceholderValues> => {
  if (!organizationId) return {};
  const { data, error } = await supabase.functions.invoke("resolve-placeholder", {
    body: { organization_id: organizationId, resolve_runtime: true },
  });
  if (error) throw error;
  if (data?.error) throw new Error(String(data.error));
  if (data?.errors && Object.keys(data.errors).length > 0) {
    console.warn("Some organization placeholders could not be resolved:", data.errors);
  }
  return data?.values && typeof data.values === "object" ? data.values as PlaceholderValues : {};
};
