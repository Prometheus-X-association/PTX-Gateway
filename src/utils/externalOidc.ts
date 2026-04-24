export interface ExternalOidcClientConfig {
  grantType: "client_credentials" | "authorization_code";
  authorizationEndpoint: string;
  loginEndpoint: string;
  discoveryUrl: string;
  issuerUrl: string;
  clientId: string;
  provider: string;
  scope: string;
  audience: string;
  resource: string;
  responseType: string;
  responseMode: string;
}

export interface ExternalOidcAuthState {
  organizationId: string;
  state: string;
  codeVerifier: string;
  redirectUri: string;
  createdAt: number;
}

const STORAGE_KEY = "ptx_external_oidc_auth_state";

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const randomBase64Url = (length = 32): string => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
};

export const createExternalOidcRedirectUri = (): string =>
  `${window.location.origin}/oidc/callback`;

export const createExternalOidcAuthState = async (organizationId: string) => {
  const state = randomBase64Url(24);
  const codeVerifier = randomBase64Url(48);
  const redirectUri = createExternalOidcRedirectUri();
  const data = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const codeChallenge = toBase64Url(new Uint8Array(digest));

  const payload: ExternalOidcAuthState = {
    organizationId,
    state,
    codeVerifier,
    redirectUri,
    createdAt: Date.now(),
  };

  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

  return {
    ...payload,
    codeChallenge,
  };
};

export const readExternalOidcAuthState = (): ExternalOidcAuthState | null => {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ExternalOidcAuthState;
  } catch {
    return null;
  }
};

export const clearExternalOidcAuthState = () => {
  sessionStorage.removeItem(STORAGE_KEY);
};

export const buildExternalOidcConnectUrl = ({
  config,
  state,
  codeChallenge,
  redirectUri,
}: {
  config: ExternalOidcClientConfig;
  state: string;
  codeChallenge: string;
  redirectUri: string;
}): string => {
  const baseUrl = config.loginEndpoint || config.authorizationEndpoint;
  if (!baseUrl) {
    throw new Error("External OIDC login endpoint or authorization endpoint is required");
  }

  const url = new URL(baseUrl);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  if (config.provider) url.searchParams.set("provider", config.provider);
  if (config.clientId) url.searchParams.set("client_id", config.clientId);
  if (config.responseType) url.searchParams.set("response_type", config.responseType);
  if (config.scope) url.searchParams.set("scope", config.scope);
  if (config.responseMode) url.searchParams.set("response_mode", config.responseMode);
  if (config.audience) url.searchParams.set("audience", config.audience);
  if (config.resource) url.searchParams.set("resource", config.resource);

  return url.toString();
};
