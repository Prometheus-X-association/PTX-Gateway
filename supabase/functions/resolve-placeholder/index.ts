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
    const { placeholder_id, organization_id, test_only } = await req.json();

    if (!placeholder_id || !organization_id) {
      return new Response(
        JSON.stringify({ error: "placeholder_id and organization_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch the placeholder definition
    const { data: placeholder, error: fetchError } = await supabase
      .from("param_placeholders")
      .select("*")
      .eq("id", placeholder_id)
      .eq("organization_id", organization_id)
      .single();

    if (fetchError || !placeholder) {
      return new Response(
        JSON.stringify({ error: "Placeholder not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let resolvedValue: string;

    if (placeholder.placeholder_type === "static") {
      resolvedValue = placeholder.static_value || "";
    } else if (placeholder.generator_type === "custom_function") {
      if (!placeholder.custom_function_code) {
        return new Response(
          JSON.stringify({ error: "No custom function code defined" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const context = {
        organizationId: organization_id,
        placeholderKey: placeholder.placeholder_key,
        timestamp: Date.now(),
        isoDate: new Date().toISOString(),
      };

      resolvedValue = await executeCustomFunction(placeholder.custom_function_code, context);
    } else {
      resolvedValue = resolveBuiltIn(placeholder.generator_type || "uuid");
    }

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
