/**
 * URL Validation Utility
 * Provides security controls for URL fetching to prevent SSRF attacks
 */

// Allowed domains for contract URL fetching
// Add trusted domains here
const ALLOWED_DOMAINS = [
  'visionstrust.com',
  'contract.visionstrust.com',
  'api.visionstrust.com',
  'catalog.visionstrust.com',
  // Add more trusted domains as needed
];

/**
 * Validates a URL for security before fetching
 * @param url The URL to validate
 * @returns Object with isValid boolean and optional error message
 */
export function validateFetchUrl(url: string): { isValid: boolean; error?: string } {
  try {
    const parsedUrl = new URL(url);
    
    // Only allow HTTPS
    if (parsedUrl.protocol !== 'https:') {
      return { isValid: false, error: 'Only HTTPS URLs are allowed for security reasons' };
    }
    
    // Check against allowed domains
    const hostname = parsedUrl.hostname.toLowerCase();
    const isAllowedDomain = ALLOWED_DOMAINS.some(domain => 
      hostname === domain || hostname.endsWith(`.${domain}`)
    );
    
    if (!isAllowedDomain) {
      return { 
        isValid: false, 
        error: `Domain "${hostname}" is not in the allowed list. Allowed domains: ${ALLOWED_DOMAINS.join(', ')}` 
      };
    }
    
    // Block private IP ranges (additional SSRF protection)
    const privatePatterns = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^192\.168\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^::1$/,
      /^0\./,
      /\.local$/i,
      /\.internal$/i,
    ];
    
    for (const pattern of privatePatterns) {
      if (pattern.test(hostname)) {
        return { isValid: false, error: 'Private/internal URLs are not allowed' };
      }
    }
    
    return { isValid: true };
  } catch {
    return { isValid: false, error: 'Invalid URL format' };
  }
}

/**
 * Fetch with security validation and timeout
 * @param url URL to fetch
 * @param options Fetch options
 * @param timeoutMs Timeout in milliseconds (default 15000)
 */
export async function secureFetch(
  url: string, 
  options?: RequestInit,
  timeoutMs: number = 15000
): Promise<Response> {
  const validation = validateFetchUrl(url);
  if (!validation.isValid) {
    throw new Error(validation.error);
  }
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Sanitize error messages to prevent information leakage
 */
export function sanitizeNetworkError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return 'Request timed out. Please try again.';
    }
    // Generic message to prevent network topology leakage
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      return 'Unable to connect to the server. Please check your connection.';
    }
  }
  return 'An unexpected error occurred while fetching data.';
}
