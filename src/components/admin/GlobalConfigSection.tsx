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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Check, Copy, Eye, EyeOff, KeyRound, Loader2, Plus, RefreshCw, Save, Settings, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import PlaceholdersConfigSection from "./PlaceholdersConfigSection";
import { getGlobalConfig, updateGlobalConfig } from "@/services/configApi";

type Environment = "development" | "staging" | "production";
type LogLevel = "debug" | "info" | "warn" | "error";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
    processingPage: {
      verticalStepBarTopText: string;
      [key: string]: unknown;
    };
    maxFileSizeMB: number;
    maxFilesCount: number;
  };
  logging: {
    enabled: boolean;
    level: LogLevel;
  };
}

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
    processingPage: {
      verticalStepBarTopText: "",
    },
    maxFileSizeMB: 50,
    maxFilesCount: 10,
  },
  logging: {
    enabled: true,
    level: "info",
  },
};

interface OidcProviderClient {
  id: string;
  name: string;
  client_id: string;
  client_secret: string;
  shared_issuer_id: string | null;
  redirect_uris: string[];
  audience: string | null;
  token_expiry_seconds: number;
  is_active: boolean;
  created_at: string;
}

interface OidcProviderKeyInfo {
  kid: string;
  created_at: string;
}

interface OidcSharedIssuer {
  id: string;
  slug: string;
  name: string;
  created_by_organization_id: string;
  created_at: string;
}

interface GlobalConfigSectionProps {
  section?: "all" | "general" | "oidc-provider";
}

const GlobalConfigSection = ({ section = "all" }: GlobalConfigSectionProps) => {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [config, setConfig] = useState<GlobalConfigState>(DEFAULT_CONFIG);

  // OIDC Provider state
  const [oidcKeyInfo, setOidcKeyInfo] = useState<OidcProviderKeyInfo | null>(null);
  const [oidcClients, setOidcClients] = useState<OidcProviderClient[]>([]);
  const [isOidcActionPending, setIsOidcActionPending] = useState(false);
  const [isClientDialogOpen, setIsClientDialogOpen] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [clientFormName, setClientFormName] = useState("");
  const [clientFormClientId, setClientFormClientId] = useState("");
  const [clientFormAudience, setClientFormAudience] = useState("");
  const [clientFormExpirySeconds, setClientFormExpirySeconds] = useState(3600);
  const [clientFormSharedIssuerId, setClientFormSharedIssuerId] = useState<string>("");
  const [clientFormRedirectUris, setClientFormRedirectUris] = useState<string>("");
  const [visibleSecretIds, setVisibleSecretIds] = useState<Set<string>>(new Set());
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [deleteClientId, setDeleteClientId] = useState<string | null>(null);
  const [isRotateKeyDialogOpen, setIsRotateKeyDialogOpen] = useState(false);
  const [testingClient, setTestingClient] = useState<OidcProviderClient | null>(null);
  const [isTestingToken, setIsTestingToken] = useState(false);
  const [testTokenResult, setTestTokenResult] = useState<unknown>(null);
  const [testTokenError, setTestTokenError] = useState<string | null>(null);

  // Shared issuer state
  const [sharedIssuers, setSharedIssuers] = useState<OidcSharedIssuer[]>([]);
  const [isCreateSharedIssuerDialogOpen, setIsCreateSharedIssuerDialogOpen] = useState(false);
  const [sharedIssuerName, setSharedIssuerName] = useState("");
  const [sharedIssuerSlug, setSharedIssuerSlug] = useState("");
  const [slugAvailability, setSlugAvailability] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [isJoinSharedIssuerDialogOpen, setIsJoinSharedIssuerDialogOpen] = useState(false);
  const [joinSlug, setJoinSlug] = useState("");
  const [leaveSharedIssuerId, setLeaveSharedIssuerId] = useState<string | null>(null);
  const [deleteSharedIssuerId, setDeleteSharedIssuerId] = useState<string | null>(null);

  // Discovery document — fetched live so the displayed URLs always reflect the
  // OIDC_PUBLIC_BASE_URL that the edge function is actually using, rather than
  // being built from VITE_SUPABASE_URL which may differ (e.g. when ngrok is active).
  const [discoveryDoc, setDiscoveryDoc] = useState<Record<string, string> | null>(null);

  const orgSlug = user?.organization?.slug || "";
  // Local base URL: used only to reach the discovery endpoint from this browser.
  const localBase = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/oidc-provider`;
  // issuerUrl falls back to the local-computed value until the discovery doc loads.
  const issuerUrl = discoveryDoc?.issuer
    || (orgSlug ? `${localBase}/${orgSlug}` : "");
  const buildSharedIssuerUrl = (slug: string) => {
    // Prefer the public base from the discovery doc if available.
    const pubBase = discoveryDoc?.issuer
      ? discoveryDoc.issuer.replace(/\/[^/]+$/, "")  // strip org-slug segment
      : localBase;
    return `${pubBase}/shared/${slug}`;
  };

  const callOidcProviderAdmin = async <T = unknown,>(action: string, extra?: Record<string, unknown>): Promise<T> => {
    if (!user?.organization?.id) throw new Error("Missing organization context");
    const { data, error } = await supabase.functions.invoke("oidc-provider/admin", {
      body: { action, organizationId: user.organization.id, ...extra },
    });
    if (error) throw error;
    const payload = data as { data?: T; error?: string } | null;
    if (payload?.error) throw new Error(payload.error);
    return payload?.data as T;
  };

  // Fetch the live discovery document so the displayed URLs always reflect
  // what the edge function is publishing (OIDC_PUBLIC_BASE_URL), not what the
  // frontend compile-time env (VITE_SUPABASE_URL) happens to be.
  const fetchDiscoveryDoc = async () => {
    if (!orgSlug) return;
    try {
      const res = await fetch(`${localBase}/${orgSlug}/.well-known/openid-configuration`);
      if (res.ok) {
        const doc = await res.json() as Record<string, string>;
        setDiscoveryDoc(doc);
      }
    } catch {
      // non-fatal: fall back to computed issuerUrl
    }
  };

  const loadOidcProviderData = async () => {
    if (!user?.organization?.id) return;
    try {
      const [keyInfo, clients, issuers] = await Promise.all([
        callOidcProviderAdmin<OidcProviderKeyInfo>("get_or_create_key"),
        callOidcProviderAdmin<OidcProviderClient[]>("list_clients"),
        callOidcProviderAdmin<OidcSharedIssuer[]>("list_shared_issuers"),
      ]);
      setOidcKeyInfo(keyInfo);
      setOidcClients(clients || []);
      setSharedIssuers(issuers || []);
      // Non-blocking: fetch discovery doc to get the real public URLs.
      fetchDiscoveryDoc();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load OIDC provider settings");
    }
  };

  useEffect(() => {
    const load = async () => {
      if (!user?.organization?.id) return;

      setIsLoading(true);
      try {
        const { data, error } = await getGlobalConfig(user.organization.id);
        if (error) throw error;

        if (data) {
          const features = data.features || {};
          const llmInsights = features.llmInsights || DEFAULT_CONFIG.features.llmInsights;
          const processingPage = isRecord(features.processingPage) ? features.processingPage : {};

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
              processingPage: {
                ...processingPage,
                verticalStepBarTopText:
                  typeof processingPage.verticalStepBarTopText === "string"
                    ? processingPage.verticalStepBarTopText
                    : "",
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

        await loadOidcProviderData();
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

  const handleCopy = async (value: string, field: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField((current) => (current === field ? null : current)), 1500);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };

  const handleRotateKey = async () => {
    setIsOidcActionPending(true);
    try {
      const keyInfo = await callOidcProviderAdmin<OidcProviderKeyInfo>("rotate_key");
      setOidcKeyInfo(keyInfo);
      setIsRotateKeyDialogOpen(false);
      toast.success("Signing key rotated. Previously issued tokens can no longer be verified.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rotate signing key");
    } finally {
      setIsOidcActionPending(false);
    }
  };

  const handleOpenCreateSharedIssuer = () => {
    setSharedIssuerName("");
    setSharedIssuerSlug("");
    setSlugAvailability("idle");
    setIsCreateSharedIssuerDialogOpen(true);
  };

  const handleSlugChange = (value: string) => {
    const normalized = value.toLowerCase();
    setSharedIssuerSlug(normalized);
    setSlugAvailability("idle");
  };

  const handleCheckSlugAvailability = async () => {
    if (!sharedIssuerSlug.trim()) return;
    setSlugAvailability("checking");
    try {
      const result = await callOidcProviderAdmin<{ available: boolean; reason?: string }>("check_shared_issuer_slug", {
        slug: sharedIssuerSlug.trim(),
      });
      setSlugAvailability(result.available ? "available" : "taken");
      if (!result.available && result.reason) {
        toast.error(result.reason);
      }
    } catch (err) {
      setSlugAvailability("idle");
      toast.error(err instanceof Error ? err.message : "Failed to check slug availability");
    }
  };

  const handleCreateSharedIssuer = async () => {
    if (!sharedIssuerName.trim() || !sharedIssuerSlug.trim()) {
      toast.error("Name and slug are required");
      return;
    }

    setIsOidcActionPending(true);
    try {
      const created = await callOidcProviderAdmin<OidcSharedIssuer>("create_shared_issuer", {
        name: sharedIssuerName.trim(),
        slug: sharedIssuerSlug.trim(),
      });
      setSharedIssuers((current) => [created, ...current]);
      setIsCreateSharedIssuerDialogOpen(false);
      toast.success("Shared issuer created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create shared issuer");
    } finally {
      setIsOidcActionPending(false);
    }
  };

  const handleOpenJoinSharedIssuer = () => {
    setJoinSlug("");
    setIsJoinSharedIssuerDialogOpen(true);
  };

  const handleJoinSharedIssuer = async () => {
    if (!joinSlug.trim()) {
      toast.error("Slug is required");
      return;
    }

    setIsOidcActionPending(true);
    try {
      const issuer = await callOidcProviderAdmin<OidcSharedIssuer>("join_shared_issuer", { slug: joinSlug.trim() });
      setSharedIssuers((current) => (current.some((i) => i.id === issuer.id) ? current : [issuer, ...current]));
      setIsJoinSharedIssuerDialogOpen(false);
      toast.success(`Joined shared issuer "${issuer.name}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to join shared issuer");
    } finally {
      setIsOidcActionPending(false);
    }
  };

  const handleConfirmLeaveSharedIssuer = async () => {
    if (!leaveSharedIssuerId) return;
    setIsOidcActionPending(true);
    try {
      await callOidcProviderAdmin("leave_shared_issuer", { id: leaveSharedIssuerId });
      setSharedIssuers((current) => current.filter((i) => i.id !== leaveSharedIssuerId));
      setLeaveSharedIssuerId(null);
      toast.success("Left shared issuer");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to leave shared issuer");
    } finally {
      setIsOidcActionPending(false);
    }
  };

  const handleRotateSharedIssuerKey = async (issuer: OidcSharedIssuer) => {
    setIsOidcActionPending(true);
    try {
      await callOidcProviderAdmin("rotate_shared_issuer_key", { id: issuer.id });
      toast.success(`Signing key rotated for "${issuer.name}". Previously issued tokens can no longer be verified.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rotate shared issuer key");
    } finally {
      setIsOidcActionPending(false);
    }
  };

  const handleConfirmDeleteSharedIssuer = async () => {
    if (!deleteSharedIssuerId) return;
    setIsOidcActionPending(true);
    try {
      await callOidcProviderAdmin("delete_shared_issuer", { id: deleteSharedIssuerId });
      setSharedIssuers((current) => current.filter((i) => i.id !== deleteSharedIssuerId));
      setDeleteSharedIssuerId(null);
      toast.success("Shared issuer deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete shared issuer");
    } finally {
      setIsOidcActionPending(false);
    }
  };

  const toggleSecretVisibility = (clientId: string) => {
    setVisibleSecretIds((current) => {
      const next = new Set(current);
      if (next.has(clientId)) {
        next.delete(clientId);
      } else {
        next.add(clientId);
      }
      return next;
    });
  };

  const handleOpenAddClient = () => {
    setEditingClientId(null);
    setClientFormName("");
    setClientFormClientId("");
    setClientFormAudience("");
    setClientFormExpirySeconds(3600);
    setClientFormSharedIssuerId("");
    setClientFormRedirectUris("");
    setIsClientDialogOpen(true);
  };

  const handleOpenEditClient = (client: OidcProviderClient) => {
    setEditingClientId(client.id);
    setClientFormName(client.name);
    setClientFormClientId(client.client_id);
    setClientFormAudience(client.audience || "");
    setClientFormExpirySeconds(client.token_expiry_seconds);
    setClientFormSharedIssuerId(client.shared_issuer_id || "");
    setClientFormRedirectUris((client.redirect_uris || []).join("\n"));
    setIsClientDialogOpen(true);
  };

  const handleSubmitClientForm = async () => {
    if (!clientFormName.trim()) {
      toast.error("Client name is required");
      return;
    }
    if (clientFormClientId.trim() && !/^[A-Za-z0-9_.-]{3,100}$/.test(clientFormClientId.trim())) {
      toast.error("Client ID must be 3-100 characters and contain only letters, numbers, '.', '_' or '-'");
      return;
    }
    const redirectUris = clientFormRedirectUris
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    setIsOidcActionPending(true);
    try {
      if (editingClientId) {
        const updated = await callOidcProviderAdmin<OidcProviderClient>("update_client", {
          id: editingClientId,
          name: clientFormName.trim(),
          clientId: clientFormClientId.trim() || undefined,
          audience: clientFormAudience.trim() || undefined,
          tokenExpirySeconds: clientFormExpirySeconds,
          sharedIssuerId: clientFormSharedIssuerId || null,
          redirectUris,
        });
        setOidcClients((current) => current.map((c) => (c.id === updated.id ? updated : c)));
        toast.success("Client updated");
      } else {
        const created = await callOidcProviderAdmin<OidcProviderClient>("create_client", {
          name: clientFormName.trim(),
          clientId: clientFormClientId.trim() || undefined,
          audience: clientFormAudience.trim() || undefined,
          tokenExpirySeconds: clientFormExpirySeconds,
          sharedIssuerId: clientFormSharedIssuerId || undefined,
          redirectUris,
        });
        setOidcClients((current) => [created, ...current]);
        setVisibleSecretIds((current) => new Set(current).add(created.id));
        toast.success("OIDC provider client created");
      }
      setIsClientDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save client");
    } finally {
      setIsOidcActionPending(false);
    }
  };

  const handleRegenerateSecret = async (client: OidcProviderClient) => {
    setIsOidcActionPending(true);
    try {
      const updated = await callOidcProviderAdmin<OidcProviderClient>("regenerate_secret", {
        id: client.id,
      });
      setOidcClients((current) => current.map((c) => (c.id === client.id ? updated : c)));
      setVisibleSecretIds((current) => new Set(current).add(updated.id));
      toast.success("Client secret regenerated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to regenerate secret");
    } finally {
      setIsOidcActionPending(false);
    }
  };

  const handleToggleClient = async (client: OidcProviderClient) => {
    setIsOidcActionPending(true);
    try {
      const updated = await callOidcProviderAdmin<OidcProviderClient>("toggle_client", {
        id: client.id,
        isActive: !client.is_active,
      });
      setOidcClients((current) => current.map((c) => (c.id === client.id ? updated : c)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update client status");
    } finally {
      setIsOidcActionPending(false);
    }
  };

  const handleConfirmDeleteClient = async () => {
    if (!deleteClientId) return;
    setIsOidcActionPending(true);
    try {
      await callOidcProviderAdmin("delete_client", { id: deleteClientId });
      setOidcClients((current) => current.filter((c) => c.id !== deleteClientId));
      setDeleteClientId(null);
      toast.success("Client deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete client");
    } finally {
      setIsOidcActionPending(false);
    }
  };

  const handleOpenTestToken = (client: OidcProviderClient) => {
    setTestingClient(client);
    setTestTokenResult(null);
    setTestTokenError(null);
  };

  const handleTestToken = async () => {
    if (!testingClient) return;
    const sharedIssuer = testingClient.shared_issuer_id
      ? sharedIssuers.find((i) => i.id === testingClient.shared_issuer_id)
      : null;
    const targetIssuerUrl = sharedIssuer ? buildSharedIssuerUrl(sharedIssuer.slug) : issuerUrl;
    if (!targetIssuerUrl) return;
    setIsTestingToken(true);
    setTestTokenResult(null);
    setTestTokenError(null);
    try {
      const response = await fetch(`${targetIssuerUrl}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: testingClient.client_id,
          client_secret: testingClient.client_secret,
        }).toString(),
      });
      const json = await response.json();
      setTestTokenResult(json);
      if (response.ok) {
        toast.success("Token issued successfully");
      } else {
        toast.error("Token request returned an error");
      }
    } catch (err) {
      setTestTokenError(err instanceof Error ? err.message : "Failed to request a test token");
    } finally {
      setIsTestingToken(false);
    }
  };

  const deleteClient = oidcClients.find((c) => c.id === deleteClientId);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  const activeSection = section === "oidc-provider" ? "oidc-provider" : "general";

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
          <Tabs defaultValue={activeSection} className="w-full">
            {section === "all" && (
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="general">General</TabsTrigger>
                <TabsTrigger value="oidc-provider">OIDC Provider</TabsTrigger>
              </TabsList>
            )}

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
                  <div className="space-y-2 md:col-span-3">
                    <Label>Vertical Step Bar Top Text</Label>
                    <Input
                      value={config.features.processingPage.verticalStepBarTopText}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          features: {
                            ...config.features,
                            processingPage: {
                              ...config.features.processingPage,
                              verticalStepBarTopText: e.target.value,
                            },
                          },
                        })
                      }
                      placeholder="Organization Name"
                    />
                    <p className="text-xs text-muted-foreground">
                      Shown above the vertical step bar on gateway pages. Leave blank to use the organization name.
                    </p>
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

            <TabsContent value="oidc-provider" className="space-y-6 pt-4">
              <Alert>
                <KeyRound className="h-4 w-4" />
                <AlertDescription>
                  This makes PTX Gateway issue its own signed access tokens (JWT) for external platforms to consume,
                  similar to a minimal Keycloak realm. PTX Gateway is a pure token-minting service here: it issues
                  tokens but does not itself validate or gate access to any resource with them.
                </AlertDescription>
              </Alert>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Issuer Endpoints</CardTitle>
                  <CardDescription>
                    Share these URLs with the external platform so it can discover this issuer, fetch the public key, and request tokens.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { label: "Issuer", value: discoveryDoc?.issuer || issuerUrl, field: "issuer" },
                    { label: "Discovery URL", value: discoveryDoc?.issuer ? `${discoveryDoc.issuer}/.well-known/openid-configuration` : (issuerUrl ? `${issuerUrl}/.well-known/openid-configuration` : ""), field: "discovery" },
                    { label: "JWKS URL", value: discoveryDoc?.jwks_uri || (issuerUrl ? `${issuerUrl}/.well-known/jwks.json` : ""), field: "jwks" },
                    { label: "Token URL", value: discoveryDoc?.token_endpoint || (issuerUrl ? `${issuerUrl}/token` : ""), field: "token" },
                  ].map((row) => (
                    <div key={row.field} className="space-y-1">
                      <Label className="text-xs">{row.label}</Label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">{row.value || "Unavailable"}</code>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!row.value}
                          onClick={() => handleCopy(row.value, row.field)}
                        >
                          {copiedField === row.field ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                  ))}

                  <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
                    <div className="text-sm">
                      <p className="font-medium">Signing Key</p>
                      <p className="text-xs text-muted-foreground">
                        {oidcKeyInfo
                          ? `Key ID: ${oidcKeyInfo.kid} • Created: ${new Date(oidcKeyInfo.created_at).toLocaleString()}`
                          : "No signing key yet"}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setIsRotateKeyDialogOpen(true)}
                      disabled={isOidcActionPending}
                    >
                      <RefreshCw className="h-4 w-4 mr-1" />
                      Rotate Key
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">Shared Discovery URLs</CardTitle>
                      <CardDescription>
                        A shared discovery URL several organizations can use as one issuer. Create one with a custom slug, or join an
                        existing one if you know its slug. Clients can then be attached to a shared issuer instead of this organization's
                        private one.
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={handleOpenJoinSharedIssuer}>
                        Join by Slug
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={handleOpenCreateSharedIssuer}>
                        <Plus className="h-4 w-4 mr-1" />
                        Create Shared Issuer
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {sharedIssuers.length === 0 ? (
                    <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
                      Not part of any shared issuer yet.
                    </div>
                  ) : (
                    <div className="rounded-lg border overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Slug</TableHead>
                            <TableHead>Discovery URL</TableHead>
                            <TableHead>Owner</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sharedIssuers.map((sharedIssuer) => {
                            const isOwner = sharedIssuer.created_by_organization_id === user?.organization?.id;
                            const discoveryUrl = `${buildSharedIssuerUrl(sharedIssuer.slug)}/.well-known/openid-configuration`;
                            return (
                              <TableRow key={sharedIssuer.id}>
                                <TableCell className="font-medium">{sharedIssuer.name}</TableCell>
                                <TableCell><code className="text-xs">{sharedIssuer.slug}</code></TableCell>
                                <TableCell className="max-w-[260px]">
                                  <div className="flex items-center gap-2">
                                    <code className="text-xs truncate">{discoveryUrl}</code>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleCopy(discoveryUrl, `shared-discovery-${sharedIssuer.id}`)}
                                    >
                                      {copiedField === `shared-discovery-${sharedIssuer.id}` ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                    </Button>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge variant={isOwner ? "default" : "secondary"}>
                                    {isOwner ? "Your organization" : "Another organization"}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <div className="flex justify-end gap-2">
                                    {isOwner ? (
                                      <>
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          disabled={isOidcActionPending}
                                          onClick={() => handleRotateSharedIssuerKey(sharedIssuer)}
                                        >
                                          Rotate Key
                                        </Button>
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          disabled={isOidcActionPending}
                                          onClick={() => setDeleteSharedIssuerId(sharedIssuer.id)}
                                        >
                                          <Trash2 className="h-4 w-4 mr-1 text-destructive" />
                                          Delete
                                        </Button>
                                      </>
                                    ) : (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setLeaveSharedIssuerId(sharedIssuer.id)}
                                      >
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                      </Button>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Dialog open={isCreateSharedIssuerDialogOpen} onOpenChange={setIsCreateSharedIssuerDialogOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create Shared Issuer</DialogTitle>
                    <DialogDescription>
                      Other organizations can join this issuer later just by knowing its slug.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <Label className="text-xs">Name</Label>
                      <Input
                        value={sharedIssuerName}
                        onChange={(e) => setSharedIssuerName(e.target.value)}
                        placeholder="Partner Network Issuer"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Slug</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          value={sharedIssuerSlug}
                          onChange={(e) => handleSlugChange(e.target.value)}
                          placeholder="partner-network"
                        />
                        <Button type="button" variant="outline" size="sm" onClick={handleCheckSlugAvailability} disabled={slugAvailability === "checking"}>
                          {slugAvailability === "checking" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check"}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Lowercase letters, numbers, and hyphens only. Appears in the discovery URL, so other org admins will share this exact slug to join.
                      </p>
                      {slugAvailability === "available" && (
                        <p className="text-xs text-emerald-600">Slug is available.</p>
                      )}
                      {slugAvailability === "taken" && (
                        <p className="text-xs text-destructive">Slug is already in use.</p>
                      )}
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsCreateSharedIssuerDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleCreateSharedIssuer} disabled={isOidcActionPending}>
                      {isOidcActionPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      Create
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={isJoinSharedIssuerDialogOpen} onOpenChange={setIsJoinSharedIssuerDialogOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Join Shared Issuer</DialogTitle>
                    <DialogDescription>
                      Enter the slug another organization shared with you. Your organization will then be able to attach clients to it.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-1">
                    <Label className="text-xs">Slug</Label>
                    <Input
                      value={joinSlug}
                      onChange={(e) => setJoinSlug(e.target.value.toLowerCase())}
                      placeholder="partner-network"
                    />
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsJoinSharedIssuerDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleJoinSharedIssuer} disabled={isOidcActionPending}>
                      {isOidcActionPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      Join
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={Boolean(leaveSharedIssuerId)} onOpenChange={(open) => !open && setLeaveSharedIssuerId(null)}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Leave Shared Issuer?</DialogTitle>
                    <DialogDescription>
                      Your organization will no longer be able to attach clients to this shared issuer. This is blocked if any of your
                      clients still use it.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setLeaveSharedIssuerId(null)}>
                      Cancel
                    </Button>
                    <Button variant="destructive" onClick={handleConfirmLeaveSharedIssuer} disabled={isOidcActionPending}>
                      {isOidcActionPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      Leave
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={Boolean(deleteSharedIssuerId)} onOpenChange={(open) => !open && setDeleteSharedIssuerId(null)}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Delete Shared Issuer?</DialogTitle>
                    <DialogDescription>
                      This permanently deletes the shared issuer for every organization using it, not just yours. Any clients attached to
                      it (yours and other organizations') fall back to their own private issuer rather than being deleted. This cannot be
                      undone.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDeleteSharedIssuerId(null)}>
                      Cancel
                    </Button>
                    <Button variant="destructive" onClick={handleConfirmDeleteSharedIssuer} disabled={isOidcActionPending}>
                      {isOidcActionPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      Delete
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">Clients</CardTitle>
                      <CardDescription>
                        Each client gets its own client_id/client_secret pair for the external platform to request tokens with.
                      </CardDescription>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={handleOpenAddClient}>
                      <Plus className="h-4 w-4 mr-1" />
                      Add Client
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {oidcClients.length === 0 ? (
                    <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
                      No clients created yet.
                    </div>
                  ) : (
                    <div className="rounded-lg border overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Client ID</TableHead>
                            <TableHead>Client Secret</TableHead>
                            <TableHead>Issuer</TableHead>
                            <TableHead>Token Expiry</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {oidcClients.map((client) => {
                            const isSecretVisible = visibleSecretIds.has(client.id);
                            return (
                            <TableRow key={client.id}>
                              <TableCell className="font-medium">{client.name}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <code className="text-xs">{client.client_id}</code>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleCopy(client.client_id, `client-id-${client.id}`)}
                                  >
                                    {copiedField === `client-id-${client.id}` ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                  </Button>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <code className="text-xs">
                                    {isSecretVisible ? client.client_secret : "•".repeat(16)}
                                  </code>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => toggleSecretVisibility(client.id)}
                                  >
                                    {isSecretVisible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleCopy(client.client_secret, `client-secret-${client.id}`)}
                                  >
                                    {copiedField === `client-secret-${client.id}` ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                  </Button>
                                </div>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {client.shared_issuer_id
                                  ? sharedIssuers.find((i) => i.id === client.shared_issuer_id)?.name || "Shared issuer"
                                  : "Private"}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">{client.token_expiry_seconds}s</TableCell>
                              <TableCell>
                                <Badge variant={client.is_active ? "default" : "secondary"}>
                                  {client.is_active ? "Active" : "Inactive"}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <div className="flex justify-end gap-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleOpenEditClient(client)}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleOpenTestToken(client)}
                                  >
                                    Test Token
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={isOidcActionPending}
                                    onClick={() => handleToggleClient(client)}
                                  >
                                    {client.is_active ? "Deactivate" : "Activate"}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={isOidcActionPending}
                                    onClick={() => handleRegenerateSecret(client)}
                                  >
                                    Regenerate Secret
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setDeleteClientId(client.id)}
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Dialog open={isClientDialogOpen} onOpenChange={setIsClientDialogOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{editingClientId ? "Edit OIDC Provider Client" : "Add OIDC Provider Client"}</DialogTitle>
                    <DialogDescription>
                      {editingClientId
                        ? "Renaming or changing the Client ID immediately affects any external platform already configured with the previous value."
                        : "Issues a new client_id/client_secret pair the external platform will use to request tokens."}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <Label className="text-xs">Name</Label>
                      <Input
                        value={clientFormName}
                        onChange={(e) => setClientFormName(e.target.value)}
                        placeholder="Partner LMS Integration"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Client ID</Label>
                      <Input
                        value={clientFormClientId}
                        onChange={(e) => setClientFormClientId(e.target.value)}
                        placeholder="Leave blank to auto-generate (e.g. ptx_xxxxxxxxxxxx)"
                      />
                      <p className="text-xs text-muted-foreground">
                        Letters, numbers, '.', '_' or '-' only. {editingClientId ? "Changing this breaks existing integrations until they're updated." : "Leave blank to auto-generate."}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Discovery URL</Label>
                      <Select value={clientFormSharedIssuerId || "__private__"} onValueChange={(value) => setClientFormSharedIssuerId(value === "__private__" ? "" : value)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__private__">This organization (private)</SelectItem>
                          {sharedIssuers.map((sharedIssuer) => (
                            <SelectItem key={sharedIssuer.id} value={sharedIssuer.id}>
                              {sharedIssuer.name} ({sharedIssuer.slug})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Choose a shared issuer to let other organizations' clients authenticate through the same discovery URL.
                      </p>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Audience (optional)</Label>
                      <Input
                        value={clientFormAudience}
                        onChange={(e) => setClientFormAudience(e.target.value)}
                        placeholder="https://api.partner.example.com"
                      />
                      <p className="text-xs text-muted-foreground">
                        Included as the token's <code>aud</code> claim. Defaults to the issuer URL when left blank.
                      </p>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Token Expiry (seconds)</Label>
                      <Input
                        type="number"
                        value={clientFormExpirySeconds}
                        onChange={(e) => setClientFormExpirySeconds(parseInt(e.target.value, 10) || 3600)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Redirect URIs (one per line, optional)</Label>
                      <Textarea
                        value={clientFormRedirectUris}
                        onChange={(e) => setClientFormRedirectUris(e.target.value)}
                        rows={3}
                        placeholder={"https://partner.example.com/callback"}
                      />
                      <p className="text-xs text-muted-foreground">
                        Required only for the <code>authorization_code</code> grant. The partner's redirect URL must exactly match one of these.
                      </p>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsClientDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleSubmitClientForm} disabled={isOidcActionPending}>
                      {isOidcActionPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      {editingClientId ? "Save Changes" : "Create Client"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog
                open={Boolean(testingClient)}
                onOpenChange={(open) => {
                  if (!open) {
                    setTestingClient(null);
                    setTestTokenResult(null);
                    setTestTokenError(null);
                  }
                }}
              >
                <DialogContent className="max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Test Token</DialogTitle>
                    <DialogDescription>
                      Requests a real access token from the public token endpoint using "{testingClient?.name}"'s credentials.
                    </DialogDescription>
                  </DialogHeader>
                  {testingClient && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <Button type="button" variant="outline" size="sm" disabled={isTestingToken} onClick={handleTestToken}>
                          {isTestingToken ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Testing...
                            </>
                          ) : (
                            "Request Token"
                          )}
                        </Button>
                      </div>
                      {testTokenError && (
                        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                          {testTokenError}
                        </p>
                      )}
                      {testTokenResult !== null && (
                        <div className="rounded-md border bg-muted/30 p-3">
                          <Label className="text-xs">Token Response</Label>
                          <pre className="mt-1 max-h-64 w-full overflow-y-auto overflow-x-hidden text-xs font-mono whitespace-pre-wrap break-all">
                            {JSON.stringify(testTokenResult, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setTestingClient(null)}>Close</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={Boolean(deleteClientId)} onOpenChange={(open) => !open && setDeleteClientId(null)}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Delete Client?</DialogTitle>
                    <DialogDescription>
                      "{deleteClient?.name || "This client"}" will no longer be able to request tokens from this issuer. This cannot be undone.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDeleteClientId(null)}>
                      Cancel
                    </Button>
                    <Button variant="destructive" onClick={handleConfirmDeleteClient} disabled={isOidcActionPending}>
                      {isOidcActionPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      Delete
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={isRotateKeyDialogOpen} onOpenChange={setIsRotateKeyDialogOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Rotate Signing Key?</DialogTitle>
                    <DialogDescription>
                      All previously issued tokens for this issuer will become unverifiable by external platforms, since
                      they were signed with the old key. Clients themselves are unaffected and can request new tokens
                      immediately with the new key.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsRotateKeyDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button variant="destructive" onClick={handleRotateKey} disabled={isOidcActionPending}>
                      {isOidcActionPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      Rotate Key
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
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

      {section === "all" && <PlaceholdersConfigSection />}
    </div>
  );
};

export default GlobalConfigSection;
