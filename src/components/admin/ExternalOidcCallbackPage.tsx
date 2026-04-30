import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import {
  clearExternalOidcAuthState,
  readExternalOidcAuthState,
} from "@/utils/externalOidc";

const getCallbackParams = (): URLSearchParams => {
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashParams = new URLSearchParams(hash);
  const searchParams = new URLSearchParams(window.location.search);
  const merged = new URLSearchParams();

  for (const [key, value] of hashParams.entries()) {
    merged.set(key, value);
  }

  for (const [key, value] of searchParams.entries()) {
    merged.set(key, value);
  }

  return merged;
};

interface OidcFailureDetails {
  summary: string;
  received: string[];
  guidance: string[];
}

const buildGenericGuidance = (): string[] => [
  "Verify the callback URL is exactly registered as `${PTX_ORIGIN}/oidc/callback` on the partner side.",
  "Confirm `grant_type=authorization_code`, `response_type=code`, `response_mode=query`, and PKCE are enabled for this client.",
  "Check Client ID, Client Secret, Authorization Endpoint, and Token Endpoint/Discovery URL in Admin > External OIDC.",
];

const buildFailureFromCallback = (params: {
  error: string;
  errorDescription: string | null;
  errorUri: string | null;
}): OidcFailureDetails => {
  const { error, errorDescription, errorUri } = params;
  const guidance = [...buildGenericGuidance()];

  if (error === "access_denied") {
    guidance.unshift("The partner denied access or login was cancelled. Retry login and ensure the selected account is allowed for this client.");
  } else if (error === "unauthorized_client") {
    guidance.unshift("Enable `authorization_code` for this client and confirm this callback URL is on the partner's allowlist.");
  } else if (error === "unsupported_response_type") {
    guidance.unshift("Set PTX response type to `code` and confirm partner supports authorization-code flow.");
  } else if (error === "invalid_scope") {
    guidance.unshift("Adjust scope to exactly match the partner-allowed scopes for this client.");
  } else if (error === "invalid_request") {
    guidance.unshift("Confirm required authorize params are accepted by the partner, especially redirect URI and response mode.");
  }

  return {
    summary: "The partner authorization endpoint returned an OAuth/OIDC error before code exchange.",
    received: [
      `error: ${error}`,
      errorDescription ? `error_description: ${errorDescription}` : "error_description: (not provided)",
      errorUri ? `error_uri: ${errorUri}` : "error_uri: (not provided)",
    ],
    guidance,
  };
};

const toReadableDetails = (details: unknown): string[] => {
  if (!details || typeof details !== "object") return [];
  const record = details as Record<string, unknown>;
  const rows: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    rows.push(`${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  }
  return rows;
};

const buildFailureFromExchangeResponse = (payload: unknown): OidcFailureDetails => {
  const data = (payload ?? {}) as { error?: string; details?: unknown };
  const detailRows = toReadableDetails(data.details);
  const providerError =
    typeof data.details === "object" && data.details !== null
      ? (data.details as Record<string, unknown>).error
      : undefined;

  const guidance = [...buildGenericGuidance()];
  if (providerError === "invalid_grant") {
    guidance.unshift("`invalid_grant` usually means redirect URI mismatch, reused/expired code, or PKCE verifier mismatch. Retry immediately and verify callback + PKCE setup.");
  } else if (providerError === "invalid_client") {
    guidance.unshift("`invalid_client` indicates wrong client credentials or auth method. Check Client ID, secret, and token auth method (`client_secret_basic` vs `client_secret_post`).");
  } else if (providerError === "invalid_scope") {
    guidance.unshift("`invalid_scope` indicates unsupported scope(s). Use only the scope values the partner issued for this client.");
  }

  return {
    summary: typeof data.error === "string" ? data.error : "Failed to exchange authorization code.",
    received: detailRows.length > 0 ? detailRows : ["No structured provider details were returned by the token endpoint."],
    guidance,
  };
};

const buildFailureFromMessage = (message: string): OidcFailureDetails => ({
  summary: message,
  received: ["No additional structured details were captured."],
  guidance: buildGenericGuidance(),
});

const ExternalOidcCallbackPage = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"working" | "success" | "error">("working");
  const [message, setMessage] = useState("Completing external OIDC connection...");
  const [failure, setFailure] = useState<OidcFailureDetails | null>(null);

  useEffect(() => {
    const run = async () => {
      const callbackParams = getCallbackParams();
      const code = callbackParams.get("code");
      const state = callbackParams.get("state");
      const error = callbackParams.get("error");
      const errorDescription = callbackParams.get("error_description");
      const errorUri = callbackParams.get("error_uri");

      if (error) {
        setStatus("error");
        setFailure(buildFailureFromCallback({ error, errorDescription, errorUri }));
        setMessage(errorDescription || error);
        return;
      }

      const savedState = readExternalOidcAuthState();
      if (!code || !state || !savedState) {
        setStatus("error");
        const summary = "Missing authorization code or saved callback state.";
        setFailure(
          buildFailureFromMessage(
            `${summary} Check that the provider redirects back with response_type=code and response_mode=query.`,
          ),
        );
        setMessage(summary);
        return;
      }

      if (savedState.state !== state) {
        clearExternalOidcAuthState();
        setStatus("error");
        setFailure(
          buildFailureFromMessage("OIDC state mismatch. This can happen if callback comes from a different login attempt or tab."),
        );
        setMessage("OIDC state mismatch. Please retry the connection flow.");
        return;
      }

      try {
        const { data, error: invokeError } = await supabase.functions.invoke("external-oidc-auth", {
          body: {
            action: "exchange_code",
            organizationId: savedState.organizationId,
            code,
            redirectUri: savedState.redirectUri,
            codeVerifier: savedState.codeVerifier,
          },
        });

        if (invokeError) {
          throw invokeError;
        }

        if ((data as { error?: string } | null)?.error) {
          setStatus("error");
          setFailure(buildFailureFromExchangeResponse(data));
          setMessage((data as { error: string }).error);
          clearExternalOidcAuthState();
          return;
        }

        clearExternalOidcAuthState();
        setStatus("success");
        setMessage("External OIDC connection completed successfully.");
      } catch (err) {
        clearExternalOidcAuthState();
        setStatus("error");
        const fallbackMessage = err instanceof Error ? err.message : "Failed to exchange authorization code.";
        setFailure(buildFailureFromMessage(fallbackMessage));
        setMessage(fallbackMessage);
      }
    };

    void run();
  }, []);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>External OIDC Callback</CardTitle>
          <CardDescription>
            This page completes the partner authorization-code flow for the selected organization.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === "working" ? (
            <div className="flex items-center gap-3 rounded-lg border p-4">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">{message}</p>
            </div>
          ) : null}

          {status === "success" ? (
            <Alert>
              <AlertTitle>Connected</AlertTitle>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ) : null}

          {status === "error" ? (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Connection failed</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>{failure?.summary || message}</p>
                {failure?.received?.length ? (
                  <div>
                    <p className="font-medium">What PTX received</p>
                    <ul className="list-disc pl-5 text-xs">
                      {failure.received.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {failure?.guidance?.length ? (
                  <div>
                    <p className="font-medium">How to fix</p>
                    <ul className="list-disc pl-5 text-xs">
                      {failure.guidance.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex gap-2">
            <Button onClick={() => navigate("/admin", { replace: true })}>Back To Admin</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ExternalOidcCallbackPage;
