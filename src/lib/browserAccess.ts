import { supabase } from "@/integrations/supabase/client";
export const browserAccessKey = (slug: string) => `ptx_browser_access_${slug.toLowerCase()}`;
export const getBrowserAccessToken = (slug: string) => sessionStorage.getItem(browserAccessKey(slug));
export async function browserAccessRequest(orgSlug: string, body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("browser-access", { body: { ...body, org_slug: orgSlug, url: window.location.href, referrer: document.referrer } });
  if (error) {
    let message = "Unable to complete access request";
    try { message = (await error.context.json()).error || message; } catch { /* Network errors have no response body. */ }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
