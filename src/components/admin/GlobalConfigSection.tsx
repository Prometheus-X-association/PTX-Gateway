import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, LockKeyhole, Save, Settings } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import PlaceholdersConfigSection from "./PlaceholdersConfigSection";
import {
  getExternalOidcSecretStatus,
  getGlobalConfig,
  updateExternalOidcSecret,
  updateGlobalConfig,
} from "@/services/configApi";
import {
  buildExternalOidcConnectUrl,
  createExternalOidcAuthState,
} from "@/utils/externalOidc";

type Environment = "development" | "staging" | "production";
type LogLevel = "debug" | "info" | "warn" | "error";
type ClientAuthMethod = "client_secret_basic" | "client_secret_post";

interface ExternalOidcConfig {
  enabled: boolean;
  grantType: "client_credentials" | "authorization_code";
  authorizationEndpoint: string;
  loginEndpoint: string;
  tokenEndpoint: string;
  discoveryUrl: string;
  issuerUrl: string;
  clientId: string;
  provider: string;
  scope: string;
  audience: string;
  resource: string;
  responseType: string;
  responseMode: string;
  clientAuthMethod: ClientAuthMethod;
  additionalTokenParams: string;
}

interface GlobalConfigState {
  id?: string;
  app_name: string;
  app_version: string;
  environment: Environment;
  features: {
    enableFileUpload: boolean;
    enableApiConnections: boolean;
    enableTextInput: boolean;
    enableCustomApi: boolean;
    allowContinueOnPdcError: boolean;
    llmInsights: {
      enabled: boolean;
      provider: "openai" | "custom";
      apiBaseUrl: string;
      apiKey: string;
      model: string;
      promptTemplate: string;
    };
    externalOidc: ExternalOidcConfig;
    maxFileSizeMB: number;
    maxFilesCount: number;
  };
  logging: {
    enabled: boolean;
    level: LogLevel;
  };
}

const DEFAULT_EXTERNAL_OIDC: ExternalOidcConfig = {
  enabled: false,
  grantType: "client_credentials",
  authorizationEndpoint: "",
  loginEndpoint: "",
  tokenEndpoint: "",
  discoveryUrl: "",
  issuerUrl: "",
  clientId: "",
  provider: "",
  scope: "",
  audience: "",
  resource: "",
  responseType: "code",
  responseMode: "",
  clientAuthMethod: "client_secret_basic",
  additionalTokenParams: "",
};

const DEFAULT_CONFIG: GlobalConfigState = {
  app_name: "Data Analytics Platform",
  app_version: "1.0.0",
  environment: "production",
  features: {
    enableFileUpload: true,
    enableApiConnections: true,
    enableTextInput: true,
    enableCustomApi: true,
    allowContinueOnPdcError: false,
    llmInsights: {
      enabled: false,
      provider: "openai",
      apiBaseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "gpt-4o-mini",
      promptTemplate:
        "Analyze the JSON data and return JSON only. Required keys: summary (string), insights (string[]), visualization (object). Choose the best type from: 'bar'|'line'|'area'|'scatter'|'pie'|'radial'|'treemap'|'network'|'map'. Provide matching structure: data[] for cartesian/pie/radial, nodes[]+links[] for network, hierarchy for treemap, and data[] with lat/lng for map. Keep labels concise and aggregate long-tail items as 'Other'. User can switch to another compatible chart type in UI.",
    },
    externalOidc: DEFAULT_EXTERNAL_OIDC,
    maxFileSizeMB: 50,
    maxFilesCount: 10,
  },
  logging: {
    enabled: true,
    level: "info",
  },
};

const GlobalConfigSection = () => {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingSecret, setIsSavingSecret] = useState(false);
  const [isConnectingExternalOidc, setIsConnectingExternalOidc] = useState(false);
  const [config, setConfig] = useState<GlobalConfigState>(DEFAULT_CONFIG);
  const [externalOidcSecret, setExternalOidcSecret] = useState("");
  const [externalOidcSecretConfigured, setExternalOidcSecretConfigured] = useState(false);
  const [externalOidcConnection, setExternalOidcConnection] = useState<{
    connected: boolean;
    expiresAt: string | null;
    subject: string | null;
    scope: string | null;
  }>({
    connected: false,
    expiresAt: null,
    subject: null,
    scope: null,
  });

  useEffect(() => {
    const load = async () => {
      if (!user?.organization?.id) return;

      setIsLoading(true);
      try {
        const [{ data, error }, { data: secretStatus, error: secretError }] = await Promise.all([
          getGlobalConfig(user.organization.id),
          getExternalOidcSecretStatus(user.organization.id),
        ]);

        if (error) throw error;
        if (secretError) throw secretError;

        if (data) {
          const features = data.features || {};
          const llmInsights = features.llmInsights || DEFAULT_CONFIG.features.llmInsights;
          const externalOidc = features.externalOidc || DEFAULT_EXTERNAL_OIDC;

          setConfig({
            id: data.id,
            app_name: data.app_name || DEFAULT_CONFIG.app_name,
            app_version: data.app_version || DEFAULT_CONFIG.app_version,
            environment: data.environment || DEFAULT_CONFIG.environment,
            features: {
              ...DEFAULT_CONFIG.features,
              ...features,
              llmInsights: {
                ...DEFAULT_CONFIG.features.llmInsights,
                ...llmInsights,
              },
              externalOidc: {
                ...DEFAULT_EXTERNAL_OIDC,
                ...externalOidc,
              },
            },
            logging: {
              ...DEFAULT_CONFIG.logging,
              ...(data.logging || {}),
            },
          });
        } else {
          setConfig(DEFAULT_CONFIG);
        }

        setExternalOidcSecretConfigured(Boolean(secretStatus?.configured));

        const { data: oidcStatusData, error: oidcStatusError } = await supabase.functions.invoke("external-oidc-auth", {
          body: {
            action: "status",
            organizationId: user.organization.id,
          },
        });

        if (oidcStatusError) throw oidcStatusError;

        const statusPayload = (oidcStatusData as { data?: typeof externalOidcConnection } | null)?.data;
        if (statusPayload) {
          setExternalOidcConnection({
            connected: Boolean(statusPayload.connected),
            expiresAt: statusPayload.expiresAt ?? null,
            subject: statusPayload.subject ?? null,
            scope: statusPayload.scope ?? null,
          });
        }
      } catch {
        toast.error("Failed to load global configuration");
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [user?.organization?.id]);

  const handleSave = async () => {
    if (!user?.organization?.id) return;

    setIsSaving(true);
    try {
      const { error } = await updateGlobalConfig({
        app_name: config.app_name,
        app_version: config.app_version,
        environment: config.environment,
        features: config.features,
        logging: config.logging,
      }, user.organization.id);

      if (error) throw error;

      toast.success("Configuration saved");
    } catch {
      toast.error("Failed to save configuration");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveSecret = async () => {
    if (!user?.organization?.id) return;

    if (!externalOidcSecret.trim()) {
      toast.error("Enter a client secret before saving");
      return;
    }

    setIsSavingSecret(true);
    try {
      const { data, error } = await updateExternalOidcSecret({ clientSecret: externalOidcSecret }, user.organization.id);
      if (error) throw error;

      setExternalOidcSecret("");
      setExternalOidcSecretConfigured(Boolean(data?.configured));
      toast.success("External OIDC client secret saved");
    } catch {
      toast.error("Failed to save external OIDC client secret");
    } finally {
      setIsSavingSecret(false);
    }
  };

  const handleClearSecret = async () => {
    if (!user?.organization?.id) return;

    setIsSavingSecret(true);
    try {
      const { data, error } = await updateExternalOidcSecret({ clearSecret: true }, user.organization.id);
      if (error) throw error;

      setExternalOidcSecret("");
      setExternalOidcSecretConfigured(Boolean(data?.configured));
      toast.success("External OIDC client secret cleared");
    } catch {
      toast.error("Failed to clear external OIDC client secret");
    } finally {
      setIsSavingSecret(false);
    }
  };

  const setExternalOidc = (next: Partial<ExternalOidcConfig>) => {
    setConfig((current) => ({
      ...current,
      features: {
        ...current.features,
        externalOidc: {
          ...current.features.externalOidc,
          ...next,
        },
      },
    }));
  };

  const handleConnectAuthorizationCode = async () => {
    if (!user?.organization?.id) return;

    const externalOidc = config.features.externalOidc;
    if (!externalOidc.clientId) {
      toast.error("Client ID is required before starting authorization-code login");
      return;
    }

    if (!externalOidc.loginEndpoint && !externalOidc.authorizationEndpoint) {
      toast.error("Login Endpoint or Authorization Endpoint is required before connecting");
      return;
    }

    setIsConnectingExternalOidc(true);
    try {
      const authState = await createExternalOidcAuthState(user.organization.id);
      const connectUrl = buildExternalOidcConnectUrl({
        config: externalOidc,
        state: authState.state,
        codeChallenge: authState.codeChallenge,
        redirectUri: authState.redirectUri,
      });

      window.location.assign(connectUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start external OIDC login");
      setIsConnectingExternalOidc(false);
    }
  };

  const handleDisconnectAuthorizationCode = async () => {
    if (!user?.organization?.id) return;

    setIsConnectingExternalOidc(true);
    try {
      const { data, error } = await supabase.functions.invoke("external-oidc-auth", {
        body: {
          action: "disconnect",
          organizationId: user.organization.id,
        },
      });

      if (error) throw error;
      if ((data as { error?: string } | null)?.error) {
        throw new Error((data as { error: string }).error);
      }

      setExternalOidcConnection({
        connected: false,
        expiresAt: null,
        subject: null,
        scope: null,
      });
      toast.success("External OIDC connection cleared");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to disconnect external OIDC");
    } finally {
      setIsConnectingExternalOidc(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Global Settings
          </CardTitle>
          <CardDescription>
            Configure application-wide behavior and per-organization external platform authentication.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs defaultValue="general" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="external-oidc">External OIDC</TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="space-y-6 pt-4">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Application</h3>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>App Name</Label>
                    <Input
                      value={config.app_name}
                      onChange={(e) => setConfig({ ...config, app_name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Version</Label>
                    <Input
                      value={config.app_version}
                      onChange={(e) => setConfig({ ...config, app_version: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Environment</Label>
                    <Select
                      value={config.environment}
                      onValueChange={(value) =>
                        setConfig({ ...config, environment: value as Environment })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="development">Development</SelectItem>
                        <SelectItem value="staging">Staging</SelectItem>
                        <SelectItem value="production">Production</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Features</h3>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div>
                      <p className="font-medium">File Upload</p>
                      <p className="text-sm text-muted-foreground">Allow users to upload files</p>
                    </div>
                    <Switch
                      checked={config.features.enableFileUpload}
                      onCheckedChange={(value) =>
                        setConfig({
                          ...config,
                          features: { ...config.features, enableFileUpload: value },
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div>
                      <p className="font-medium">API Connections</p>
                      <p className="text-sm text-muted-foreground">Enable API data sources</p>
                    </div>
                    <Switch
                      checked={config.features.enableApiConnections}
                      onCheckedChange={(value) =>
                        setConfig({
                          ...config,
                          features: { ...config.features, enableApiConnections: value },
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div>
                      <p className="font-medium">Text Input</p>
                      <p className="text-sm text-muted-foreground">Allow manual text input</p>
                    </div>
                    <Switch
                      checked={config.features.enableTextInput}
                      onCheckedChange={(value) =>
                        setConfig({
                          ...config,
                          features: { ...config.features, enableTextInput: value },
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div>
                      <p className="font-medium">Custom API</p>
                      <p className="text-sm text-muted-foreground">Enable custom API URLs</p>
                    </div>
                    <Switch
                      checked={config.features.enableCustomApi}
                      onCheckedChange={(value) =>
                        setConfig({
                          ...config,
                          features: { ...config.features, enableCustomApi: value },
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-4 md:col-span-2">
                    <div>
                      <p className="font-medium">Continue On PDC Error</p>
                      <p className="text-sm text-muted-foreground">
                        Allow users to continue to Results with dummy data when PDC execution fails
                      </p>
                    </div>
                    <Switch
                      checked={config.features.allowContinueOnPdcError}
                      onCheckedChange={(value) =>
                        setConfig({
                          ...config,
                          features: { ...config.features, allowContinueOnPdcError: value },
                        })
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Max File Size (MB)</Label>
                    <Input
                      type="number"
                      value={config.features.maxFileSizeMB}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          features: {
                            ...config.features,
                            maxFileSizeMB: parseInt(e.target.value, 10) || 50,
                          },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Max Files Count</Label>
                    <Input
                      type="number"
                      value={config.features.maxFilesCount}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          features: {
                            ...config.features,
                            maxFilesCount: parseInt(e.target.value, 10) || 10,
                          },
                        })
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Logging</h3>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div>
                      <p className="font-medium">Enable Logging</p>
                      <p className="text-sm text-muted-foreground">Log application events</p>
                    </div>
                    <Switch
                      checked={config.logging.enabled}
                      onCheckedChange={(value) =>
                        setConfig({
                          ...config,
                          logging: { ...config.logging, enabled: value },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Log Level</Label>
                    <Select
                      value={config.logging.level}
                      onValueChange={(value) =>
                        setConfig({
                          ...config,
                          logging: { ...config.logging, level: value as LogLevel },
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="debug">Debug</SelectItem>
                        <SelectItem value="info">Info</SelectItem>
                        <SelectItem value="warn">Warning</SelectItem>
                        <SelectItem value="error">Error</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="external-oidc" className="space-y-6 pt-4">
              <Alert>
                <LockKeyhole className="h-4 w-4" />
                <AlertDescription>
                  Use this when the external platform requires PTX Gateway to obtain an access token from an OIDC token endpoint before every outbound call. This does not change how users log in to PTX Gateway.
                </AlertDescription>
              </Alert>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="font-medium">Enable External OIDC For PDC Calls</p>
                  <p className="text-sm text-muted-foreground">
                    When enabled, the gateway uses OAuth 2.0 client credentials against the configured OIDC provider instead of the legacy static bearer token.
                  </p>
                </div>
                <Switch
                  checked={config.features.externalOidc.enabled}
                  onCheckedChange={(value) => setExternalOidc({ enabled: value })}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Grant Type</Label>
                  <Select
                    value={config.features.externalOidc.grantType}
                    onValueChange={(value) =>
                      setExternalOidc({ grantType: value as "client_credentials" | "authorization_code" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="client_credentials">client_credentials</SelectItem>
                      <SelectItem value="authorization_code">authorization_code</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Client ID</Label>
                  <Input
                    value={config.features.externalOidc.clientId}
                    onChange={(e) => setExternalOidc({ clientId: e.target.value })}
                    placeholder="ptx-gateway-org-a"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Login Endpoint</Label>
                  <Input
                    value={config.features.externalOidc.loginEndpoint}
                    onChange={(e) => setExternalOidc({ loginEndpoint: e.target.value })}
                    placeholder="https://partner.example.com/idm/oidc/login"
                  />
                  <p className="text-xs text-muted-foreground">
                    Use this when the partner requires a custom login entrypoint like <code>/oidc/login?redirect_uri=...&provider=...</code>.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Authorization Endpoint</Label>
                  <Input
                    value={config.features.externalOidc.authorizationEndpoint}
                    onChange={(e) => setExternalOidc({ authorizationEndpoint: e.target.value })}
                    placeholder="https://partner.example.com/idm/oidc/auth"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Provider</Label>
                  <Input
                    value={config.features.externalOidc.provider}
                    onChange={(e) => setExternalOidc({ provider: e.target.value })}
                    placeholder="ptx-gateway"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Client Auth Method</Label>
                  <Select
                    value={config.features.externalOidc.clientAuthMethod}
                    onValueChange={(value) =>
                      setExternalOidc({ clientAuthMethod: value as ClientAuthMethod })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="client_secret_basic">client_secret_basic</SelectItem>
                      <SelectItem value="client_secret_post">client_secret_post</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Response Type</Label>
                  <Input
                    value={config.features.externalOidc.responseType}
                    onChange={(e) => setExternalOidc({ responseType: e.target.value })}
                    placeholder="code"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Response Mode</Label>
                  <Input
                    value={config.features.externalOidc.responseMode}
                    onChange={(e) => setExternalOidc({ responseMode: e.target.value })}
                    placeholder="query"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Token Endpoint</Label>
                  <Input
                    value={config.features.externalOidc.tokenEndpoint}
                    onChange={(e) => setExternalOidc({ tokenEndpoint: e.target.value })}
                    placeholder="https://idp.partner.example.com/oauth2/token"
                  />
                  <p className="text-xs text-muted-foreground">
                    Use this when the partner gives you the exact token endpoint. If you leave it blank, the gateway can resolve it from Discovery URL or Issuer URL.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Discovery URL</Label>
                  <Input
                    value={config.features.externalOidc.discoveryUrl}
                    onChange={(e) => setExternalOidc({ discoveryUrl: e.target.value })}
                    placeholder="https://idp.partner.example.com/.well-known/openid-configuration"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Issuer URL</Label>
                  <Input
                    value={config.features.externalOidc.issuerUrl}
                    onChange={(e) => setExternalOidc({ issuerUrl: e.target.value })}
                    placeholder="https://idp.partner.example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Scope</Label>
                  <Input
                    value={config.features.externalOidc.scope}
                    onChange={(e) => setExternalOidc({ scope: e.target.value })}
                    placeholder="pdc.execute pdc.read"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Audience</Label>
                  <Input
                    value={config.features.externalOidc.audience}
                    onChange={(e) => setExternalOidc({ audience: e.target.value })}
                    placeholder="https://api.partner.example.com"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Resource</Label>
                  <Input
                    value={config.features.externalOidc.resource}
                    onChange={(e) => setExternalOidc({ resource: e.target.value })}
                    placeholder="api://partner-platform"
                  />
                  <p className="text-xs text-muted-foreground">
                    Some identity providers need <code>resource</code> instead of or in addition to <code>audience</code>.
                  </p>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Additional Token Params JSON</Label>
                  <Textarea
                    value={config.features.externalOidc.additionalTokenParams}
                    onChange={(e) => setExternalOidc({ additionalTokenParams: e.target.value })}
                    rows={4}
                    placeholder={'{"tenant":"edge-skills","custom_claim":"org-a"}'}
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional. Provide a JSON object only when the other platform requires extra token request fields.
                  </p>
                </div>
              </div>

              <Card className="border-dashed">
                <CardHeader>
                  <CardTitle className="text-base">Client Secret</CardTitle>
                  <CardDescription>
                    Stored server-side only. The UI never reads the current secret value back.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                    Current status: {externalOidcSecretConfigured ? "Configured" : "Not configured"}
                  </div>
                  <div className="space-y-2">
                    <Label>New Client Secret</Label>
                    <Input
                      type="password"
                      value={externalOidcSecret}
                      onChange={(e) => setExternalOidcSecret(e.target.value)}
                      placeholder="Enter new secret"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={handleSaveSecret} disabled={isSavingSecret}>
                      {isSavingSecret ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Saving Secret...
                        </>
                      ) : (
                        "Save Secret"
                      )}
                    </Button>
                    <Button type="button" variant="outline" onClick={handleClearSecret} disabled={isSavingSecret}>
                      Clear Secret
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-dashed">
                <CardHeader>
                  <CardTitle className="text-base">Authorization-Code Connection</CardTitle>
                  <CardDescription>
                    PTX Gateway will open the partner login page, receive a code on <code>/oidc/callback</code>, and exchange it server-side.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {config.features.externalOidc.grantType !== "authorization_code" ? (
                    <Alert>
                      <AlertDescription>
                        Set <strong>Grant Type</strong> to <code>authorization_code</code> to enable partner login and show the connect action.
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                    Connection status: {externalOidcConnection.connected ? "Connected" : "Not connected"}
                    {externalOidcConnection.subject ? ` | Subject: ${externalOidcConnection.subject}` : ""}
                    {externalOidcConnection.expiresAt ? ` | Expires: ${new Date(externalOidcConnection.expiresAt).toLocaleString()}` : ""}
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p>Callback URL to register with the partner:</p>
                    <p className="rounded bg-muted px-2 py-1 font-mono text-xs">
                      {typeof window !== "undefined" ? `${window.location.origin}/oidc/callback` : "/oidc/callback"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      onClick={handleConnectAuthorizationCode}
                      disabled={isConnectingExternalOidc || config.features.externalOidc.grantType !== "authorization_code"}
                    >
                      {isConnectingExternalOidc ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Connecting...
                        </>
                      ) : (
                        "Connect With Partner Login"
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleDisconnectAuthorizationCode}
                      disabled={isConnectingExternalOidc || config.features.externalOidc.grantType !== "authorization_code"}
                    >
                      Disconnect Session
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Example: Other Platform Is The Identity Provider</CardTitle>
                    <CardDescription>
                      Most common outbound integration. The partner platform owns the IdP and registers PTX Gateway as an OIDC client.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <p>Configure in PTX Gateway:</p>
                    <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
{`Enable External OIDC: on
Client ID: ptx-gateway-org-a
Client Secret: <provided by partner>
Discovery URL: https://idp.partner.example.com/.well-known/openid-configuration
Scope: pdc.execute
Audience: https://api.partner.example.com
Client Auth Method: client_secret_basic`}
                    </pre>
                    <p>Ask the other platform to provide:</p>
                    <p className="text-muted-foreground">
                      issuer or discovery URL, token endpoint if custom, client ID, client secret, required scopes, required audience or resource value, and the exact authentication method they expect at the token endpoint.
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Example: PTX Gateway Team Coordinates Client Creation</CardTitle>
                    <CardDescription>
                      PTX Gateway is still the client, but your team leads the registration process with the other platform.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <p>Share these values with the other platform admin:</p>
                    <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
{`Client display name: PTX Gateway - Org A
Grant type: client_credentials
Token usage: server-to-server PDC execution
Expected API audience: https://api.partner.example.com
Requested scopes: pdc.execute pdc.read`}
                    </pre>
                    <p>After they create the client, copy back into PTX Gateway:</p>
                    <p className="text-muted-foreground">
                      client ID, client secret, discovery URL or issuer URL, plus any mandatory scope, audience, resource, or custom token parameters.
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Alert>
                <AlertDescription>
                  If the other platform asks PTX Gateway to act as a full identity provider for them, that is a different integration pattern and is not implemented here. This page configures PTX Gateway as an OIDC client for outbound communication only.
                </AlertDescription>
              </Alert>
            </TabsContent>
          </Tabs>

          <div className="pt-4">
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Configuration
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <PlaceholdersConfigSection />
    </div>
  );
};

export default GlobalConfigSection;
