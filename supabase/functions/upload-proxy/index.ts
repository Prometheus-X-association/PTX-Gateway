import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-upload-url, x-upload-authorization',
};

/**
 * Validate upload URL format (must be valid HTTPS URL)
 */
function isValidUploadUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    // Only allow HTTPS for security
    return parsedUrl.protocol === 'https:';
  } catch {
    return false;
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get target URL and authorization from headers
    const uploadUrl = req.headers.get('x-upload-url');
    const uploadAuth = req.headers.get('x-upload-authorization');
    const contentType = req.headers.get('content-type');

    console.log('Upload proxy request received:', {
      method: req.method,
      hasUploadUrl: !!uploadUrl,
      hasUploadAuth: !!uploadAuth,
      contentType: contentType,
    });

    if (!uploadUrl) {
      return new Response(
        JSON.stringify({ error: 'Missing x-upload-url header' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate upload URL format
    if (!isValidUploadUrl(uploadUrl)) {
      console.warn('Invalid upload URL format:', uploadUrl);
      return new Response(
        JSON.stringify({ error: 'Invalid upload URL. Must be a valid HTTPS URL.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Read the raw request body - don't parse FormData, just forward it
    const body = await req.arrayBuffer();
    console.log('Request body size:', body.byteLength);

    // Log the upload request (without sensitive data)
    console.log('Processing upload request:', {
      targetDomain: new URL(uploadUrl).hostname,
      timestamp: new Date().toISOString(),
      bodySize: body.byteLength,
    });

    // Create headers for the proxied request - preserve content-type for multipart boundary
    const proxyHeaders = new Headers();
    if (contentType) {
      proxyHeaders.set('Content-Type', contentType);
    }
    if (uploadAuth) {
      proxyHeaders.set('Authorization', uploadAuth);
    }

    // Forward the request to the target URL with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 1 minute timeout

    try {
      console.log('Forwarding request to:', uploadUrl);
      
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: proxyHeaders,
        body: body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      console.log('Target server response:', {
        status: response.status,
        statusText: response.statusText,
      });

      const result = await response.text();
      console.log('Response body length:', result.length);

      return new Response(
        JSON.stringify({
          status: response.status,
          statusText: response.statusText,
          body: result,
        }),
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
          JSON.stringify({ error: 'Upload request timed out' }),
          { status: 504, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ 
          error: 'Failed to forward request to target server',
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
