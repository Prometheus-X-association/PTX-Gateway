import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-result-url, x-result-authorization, x-result-method',
};

/**
 * Validate URL format (allows HTTP for development endpoints)
 */
function isValidUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:';
  } catch {
    return false;
  }
}

function normalizeAuthorizationHeader(value: string | null): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const withoutPrefix = trimmed.replace(/^authorization\s*:\s*/i, "").trim();

  if (/^(bearer|basic)\s+/i.test(withoutPrefix)) {
    return withoutPrefix;
  }

  return `Bearer ${withoutPrefix}`;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get target URL and authorization from headers
    const resultUrl = req.headers.get('x-result-url');
    const resultAuth = normalizeAuthorizationHeader(req.headers.get('x-result-authorization'));
    const resultMethod = req.headers.get('x-result-method') || 'GET';

    console.log('Result proxy request received:', {
      method: req.method,
      targetMethod: resultMethod,
      hasResultUrl: !!resultUrl,
      hasResultAuth: !!resultAuth,
    });

    if (!resultUrl) {
      return new Response(
        JSON.stringify({ error: 'Missing x-result-url header' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate URL format
    if (!isValidUrl(resultUrl)) {
      console.warn('Invalid result URL format:', resultUrl);
      return new Response(
        JSON.stringify({ error: 'Invalid result URL. Must be a valid HTTP/HTTPS URL.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log the request (without sensitive data)
    console.log('Processing result fetch request:', {
      targetDomain: new URL(resultUrl).hostname,
      targetPath: new URL(resultUrl).pathname,
      timestamp: new Date().toISOString(),
    });

    // Create headers for the proxied request
    const proxyHeaders = new Headers();
    proxyHeaders.set('Accept', 'application/json');
    proxyHeaders.set('Content-Type', 'application/json');
    
    if (resultAuth) {
      proxyHeaders.set('Authorization', resultAuth);
    }

    // Forward the request to the target URL with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      console.log('Forwarding request to:', resultUrl);
      
      const fetchOptions: RequestInit = {
        method: resultMethod,
        headers: proxyHeaders,
        signal: controller.signal,
      };

      // Add body for POST requests
      if (resultMethod === 'POST') {
        const body = await req.text();
        if (body) {
          fetchOptions.body = body;
        }
      }

      const response = await fetch(resultUrl, fetchOptions);

      clearTimeout(timeoutId);

      console.log('Target server response:', {
        status: response.status,
        statusText: response.statusText,
      });

      // Try to parse as JSON, fall back to text
      const contentType = response.headers.get('content-type');
      let result: unknown;
      
      if (contentType?.includes('application/json')) {
        result = await response.json();
      } else {
        const textResult = await response.text();
        // Try to parse as JSON anyway
        try {
          result = JSON.parse(textResult);
        } catch {
          result = { rawResponse: textResult };
        }
      }

      console.log('Response processed successfully');

      return new Response(
        JSON.stringify(result),
        {
          status: response.ok ? 200 : response.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      console.error('Fetch error:', {
        name: (fetchError as Error).name,
        message: (fetchError as Error).message,
      });
      
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        return new Response(
          JSON.stringify({ error: 'Result fetch request timed out' }),
          { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ 
          error: 'Failed to fetch result from target server',
          details: fetchError instanceof Error ? fetchError.message : 'Unknown error'
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error: unknown) {
    console.error('Proxy error:', {
      name: (error as Error).name,
      message: (error as Error).message,
      stack: (error as Error).stack,
    });
    const errorMessage = error instanceof Error ? error.message : 'Proxy request failed';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
