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

const ExternalOidcCallbackPage = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"working" | "success" | "error">("working");
  const [message, setMessage] = useState("Completing external OIDC connection...");

  useEffect(() => {
    const run = async () => {
      const callbackParams = getCallbackParams();
      const code = callbackParams.get("code");
      const state = callbackParams.get("state");
      const error = callbackParams.get("error");
      const errorDescription = callbackParams.get("error_description");

      if (error) {
        setStatus("error");
        setMessage(errorDescription || error);
        return;
      }

      const savedState = readExternalOidcAuthState();
      if (!code || !state || !savedState) {
        setStatus("error");
        setMessage("Missing authorization code or saved callback state. Check that the provider redirects back with `response_type=code` and `response_mode=query`.");
        return;
      }

      if (savedState.state !== state) {
        clearExternalOidcAuthState();
        setStatus("error");
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
          throw new Error((data as { error: string }).error);
        }

        clearExternalOidcAuthState();
        setStatus("success");
        setMessage("External OIDC connection completed successfully.");
      } catch (err) {
        clearExternalOidcAuthState();
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Failed to exchange authorization code.");
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
              <AlertDescription>{message}</AlertDescription>
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
