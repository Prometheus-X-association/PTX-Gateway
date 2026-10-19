import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Built-in generators that don't need custom code
function resolveBuiltIn(generatorType: string): string {
  switch (generatorType) {
    case "uuid":
      return crypto.randomUUID();
    case "session_id":
      return `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    case "timestamp":
      return String(Date.now());
    case "date_iso":
      return new Date().toISOString();
    case "random_string":
      return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    default:
      throw new Error(`Unknown generator type: ${generatorType}`);
  }
}

// Execute custom function code in a controlled manner
async function executeCustomFunction(code: string, context: Record<string, unknown>): Promise<string> {
  try {
    // The code should be an async function body that returns a string
    // We wrap it in an AsyncFunction constructor
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction("context", "fetch", code);
    const result = await fn(context, fetch);
    
    if (result === undefined || result === null) {
      throw new Error("Function returned null or undefined");
    }
    
    return String(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Custom function execution failed: ${msg}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { placeholder_id, organization_id, test_only, resolve_runtime } = await req.json();

    if ((!placeholder_id && !resolve_runtime) || !organization_id) {
      return new Response(
        JSON.stringify({ error: "organization_id and placeholder_id or resolve_runtime are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let runtimeParameterValues: string[] = [];
    if (resolve_runtime) {
      const [{ data: resources, error: resourcesError }, { data: chains, error: chainsError }] = await Promise.all([
        supabase
          .from("dataspace_params")
          .select("parameters,result_query_params")
          .eq("organization_id", organization_id)
          .eq("is_visible", true),
        supabase
          .from("service_chains")
          .select("embedded_resources,result_query_params")
          .eq("organization_id", organization_id)
          .eq("is_visible", true),
      ]);
      if (resourcesError || chainsError) {
        throw new Error(resourcesError?.message || chainsError?.message || "Failed to inspect runtime parameters");
      }

      const collectParameterValues = (value: unknown): void => {
        if (typeof value === "string") {
          if (value.includes("#")) runtimeParameterValues.push(value);
          return;
        }
        if (Array.isArray(value)) {
          value.forEach(collectParameterValues);
          return;
        }
        if (value && typeof value === "object") {
          Object.values(value as Record<string, unknown>).forEach(collectParameterValues);
        }
      };
      collectParameterValues(resources || []);
      collectParameterValues(chains || []);

      if (runtimeParameterValues.length === 0) {
        return new Response(
          JSON.stringify({ values: {}, errors: {}, test_only: !!test_only }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    let placeholderQuery = supabase
      .from("param_placeholders")
      .select("*")
      .eq("organization_id", organization_id);

    if (placeholder_id) placeholderQuery = placeholderQuery.eq("id", placeholder_id);

    const { data: fetchedPlaceholders, error: fetchError } = await placeholderQuery;

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const placeholders = resolve_runtime
      ? (fetchedPlaceholders || []).filter((placeholder) =>
          runtimeParameterValues.some((value) => value.includes(String(placeholder.placeholder_key)))
        )
      : fetchedPlaceholders;

    if (!placeholders || placeholders.length === 0) {
      if (resolve_runtime) {
        return new Response(
          JSON.stringify({ values: {}, test_only: !!test_only }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: "Placeholder not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resolveDefinition = async (placeholder: Record<string, unknown>): Promise<string> => {
      if (placeholder.placeholder_type === "static") return String(placeholder.static_value || "");
      if (placeholder.generator_type === "custom_function") {
        if (!placeholder.custom_function_code) throw new Error("No custom function code defined");
        return executeCustomFunction(String(placeholder.custom_function_code), {
          organizationId: organization_id,
          placeholderKey: placeholder.placeholder_key,
          timestamp: Date.now(),
          isoDate: new Date().toISOString(),
        });
      }
      return resolveBuiltIn(String(placeholder.generator_type || "uuid"));
    };

    if (resolve_runtime) {
      const values: Record<string, string> = {};
      const errors: Record<string, string> = {};
      for (const placeholder of placeholders) {
        const key = String(placeholder.placeholder_key);
        try {
          values[key] = await resolveDefinition(placeholder);
        } catch (error: unknown) {
          errors[key] = error instanceof Error ? error.message : String(error);
        }
      }
      return new Response(
        JSON.stringify({ values, errors, test_only: !!test_only }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const placeholder = placeholders[0];
    const resolvedValue = await resolveDefinition(placeholder);

    return new Response(
      JSON.stringify({
        value: resolvedValue,
        placeholder_key: placeholder.placeholder_key,
        test_only: !!test_only,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
