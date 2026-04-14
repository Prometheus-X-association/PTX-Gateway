import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, ShieldCheck, Plus, Trash2, KeyRound, Copy } from "lucide-react";
import { BookOpen } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface EmbedSettingsState {
  embed_enabled: boolean;
  allowed_origins: string[];
}

interface PersistentTokenInfo {
  id: string;
  label: string;
  origin: string;
  created_at: string;
  revoked_at?: string | null;
}

interface IssuedTokenHistoryItem {
  id: string;
  token: string;
  token_type: "temporary" | "persistent";
  token_id?: string;
  origin: string;
  label?: string;
  created_at: string;
}

interface TokenRow {
  id: string;
  token: string;
  token_type: "temporary" | "persistent";
  token_id?: string;
  origin: string;
  label?: string;
  created_at: string;
  revoked_at?: string | null;
}

const DEFAULT_EMBED_SETTINGS: EmbedSettingsState = {
  embed_enabled: true,
  allowed_origins: [],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getIssuedTokensStorageKey = (orgId: string) => `ptx_embed_issued_tokens_${orgId}`;

const EmbedAccessSection = () => {
  const { user, refreshAuth } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isIssuingToken, setIsIssuingToken] = useState(false);
  const [settings, setSettings] = useState<EmbedSettingsState>(DEFAULT_EMBED_SETTINGS);
  const [persistentTokens, setPersistentTokens] = useState<PersistentTokenInfo[]>([]);
  const [tokenOrigin, setTokenOrigin] = useState("");
  const [tokenTtl, setTokenTtl] = useState("3600");
  const [tokenType, setTokenType] = useState<"temporary" | "persistent">("temporary");
  const [persistentLabel, setPersistentLabel] = useState("Trusted Internal Embed");
  const [issuedToken, setIssuedToken] = useState("");
  const [issuedTokenType, setIssuedTokenType] = useState<"temporary" | "persistent">("temporary");
  const [issuedTokenHistory, setIssuedTokenHistory] = useState<IssuedTokenHistoryItem[]>([]);
  const [selectedIssuedTokenId, setSelectedIssuedTokenId] = useState<string>("");
  const [newOrigin, setNewOrigin] = useState("");
  const [revokingTokenId, setRevokingTokenId] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [gatewayBaseUrl, setGatewayBaseUrl] = useState(
    typeof window !== "undefined" ? window.location.origin : "https://your-gateway-domain.com"
  );

  const orgSlug = user?.organization?.slug || "";

  const normalizedGatewayOrigin = useMemo(() => {
    try {
      return new URL(gatewayBaseUrl).origin;
    } catch {
      return typeof window !== "undefined" ? window.location.origin : "https://your-gateway-domain.com";
    }
  }, [gatewayBaseUrl]);

  const fetchSettings = async () => {
    if (!user?.organization?.id) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("organizations")
        .select("settings")
        .eq("id", user.organization.id)
        .single();
      if (error) throw error;

      const rawSettings = isRecord(data?.settings) ? data.settings : {};
      const rawEmbed = isRecord(rawSettings.embed) ? rawSettings.embed : {};

      const allowedOrigins = Array.isArray(rawEmbed.allowed_origins)
        ? rawEmbed.allowed_origins.map((o) => String(o))
        : [];
      const rawPersistent = Array.isArray(rawEmbed.persistent_tokens) ? rawEmbed.persistent_tokens : [];
      const parsedPersistent: PersistentTokenInfo[] = rawPersistent
        .filter((item): item is Record<string, unknown> => isRecord(item))
        .map((item) => ({
          id: String(item.id || ""),
          label: String(item.label || "Persistent Token"),
          origin: String(item.origin || ""),
          created_at: String(item.created_at || ""),
          revoked_at: item.revoked_at ? String(item.revoked_at) : null,
        }))
        .filter((item) => item.id && item.origin);

      setSettings({
        embed_enabled: rawEmbed.embed_enabled !== false,
        allowed_origins: allowedOrigins,
      });
      setPersistentTokens(parsedPersistent);
      if (allowedOrigins.length > 0) {
        setTokenOrigin((prev) => prev || allowedOrigins[0]);
      }
    } catch {
      toast.error("Failed to load embed settings");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, [user?.organization?.id]);

  useEffect(() => {
    const orgId = user?.organization?.id;
    if (!orgId || typeof window === "undefined") {
      setIssuedTokenHistory([]);
      setSelectedIssuedTokenId("");
      return;
    }

    try {
      const raw = localStorage.getItem(getIssuedTokensStorageKey(orgId));
      if (!raw) {
        setIssuedTokenHistory([]);
        setSelectedIssuedTokenId("");
        return;
      }
      const parsed = JSON.parse(raw) as IssuedTokenHistoryItem[];
      if (!Array.isArray(parsed)) {
        setIssuedTokenHistory([]);
        setSelectedIssuedTokenId("");
        return;
      }
      const valid = parsed.filter((item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.token === "string" &&
        (item.token_type === "temporary" || item.token_type === "persistent") &&
        typeof item.origin === "string"
      );
      setIssuedTokenHistory(valid);
      if (valid.length > 0) {
        setSelectedIssuedTokenId(valid[0].id);
        setIssuedToken(valid[0].token);
        setIssuedTokenType(valid[0].token_type);
      } else {
        setSelectedIssuedTokenId("");
        setIssuedToken("");
      }
    } catch {
      setIssuedTokenHistory([]);
      setSelectedIssuedTokenId("");
    }
  }, [user?.organization?.id]);

  const persistIssuedTokenHistory = (orgId: string, list: IssuedTokenHistoryItem[]) => {
    if (typeof window === "undefined") return;
    localStorage.setItem(getIssuedTokensStorageKey(orgId), JSON.stringify(list.slice(0, 30)));
  };

  const handleSave = async () => {
    if (!user?.organization?.id) return;
    setIsSaving(true);
    try {
      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .select("settings")
        .eq("id", user.organization.id)
        .single();
      if (orgError) throw orgError;

      const currentSettings = isRecord(org?.settings) ? org.settings : {};
      const merged = {
        ...currentSettings,
        embed: {
          ...(isRecord(currentSettings.embed) ? currentSettings.embed : {}),
          embed_enabled: settings.embed_enabled,
          allowed_origins: settings.allowed_origins,
        },
      };

      const { error } = await supabase
        .from("organizations")
        .update({ settings: merged })
        .eq("id", user.organization.id);
      if (error) throw error;

      toast.success("Embed settings saved");
      await refreshAuth();
      await fetchSettings();
    } catch {
      toast.error("Failed to save embed settings");
    } finally {
      setIsSaving(false);
    }
  };

  const addOrigin = () => {
    try {
      const normalized = new URL(newOrigin).origin;
      if (settings.allowed_origins.includes(normalized)) {
        toast.error("Origin already exists");
        return;
      }
      setSettings({
        ...settings,
        allowed_origins: [...settings.allowed_origins, normalized],
      });
      setTokenOrigin((prev) => prev || normalized);
      setNewOrigin("");
    } catch {
      toast.error("Please enter a valid origin URL (for example: https://app.example.com)");
    }
  };

  const removeOrigin = (origin: string) => {
    const next = settings.allowed_origins.filter((o) => o !== origin);
    setSettings({ ...settings, allowed_origins: next });
    if (tokenOrigin === origin) {
      setTokenOrigin(next[0] || "");
    }
  };

  const handleIssueToken = async () => {
    if (!orgSlug) return;
    if (!tokenOrigin) {
      toast.error("Select an origin to issue token");
      return;
    }
    setIsIssuingToken(true);
    try {
      const ttl = parseInt(tokenTtl, 10);
      const { data, error } = await supabase.functions.invoke("embed-auth", {
        body: {
          action: "issue",
          org_slug: orgSlug,
          origin: tokenOrigin,
          token_type: tokenType,
          label: tokenType === "persistent" ? persistentLabel : undefined,
          ttl_seconds: Number.isFinite(ttl) ? ttl : 3600,
        },
      });
      if (error || !data?.ok) {
        throw new Error(data?.error || error?.message || "Failed to issue token");
      }

      const tokenValue = data.token as string;
      const tokenKind = (data.token_type as "temporary" | "persistent") || tokenType;
      const newItem: IssuedTokenHistoryItem = {
        id: crypto.randomUUID(),
        token: tokenValue,
        token_type: tokenKind,
        token_id: typeof data.token_id === "string" ? data.token_id : undefined,
        origin: tokenOrigin,
        label: tokenType === "persistent" ? persistentLabel : undefined,
        created_at: new Date().toISOString(),
      };

      const orgId = user?.organization?.id;
      setIssuedTokenHistory((prev) => {
        const next = [newItem, ...prev];
        if (orgId) persistIssuedTokenHistory(orgId, next);
        return next.slice(0, 30);
      });
      setSelectedIssuedTokenId(newItem.id);
      setIssuedToken(tokenValue);
      setIssuedTokenType(tokenKind);

      if (tokenType === "persistent") {
        await fetchSettings();
      }
      toast.success(`${tokenType === "persistent" ? "Persistent" : "Temporary"} embed token issued`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to issue token");
    } finally {
      setIsIssuingToken(false);
    }
  };

  const handleRevokePersistentToken = async (tokenId: string) => {
    if (!orgSlug) return;
    setRevokingTokenId(tokenId);
    try {
      const { data, error } = await supabase.functions.invoke("embed-auth", {
        body: {
          action: "revoke_persistent",
          org_slug: orgSlug,
          token_id: tokenId,
        },
      });
      if (error || !data?.ok) {
        throw new Error(data?.error || error?.message || "Failed to revoke token");
      }
      toast.success("Persistent token revoked");
      await fetchSettings();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke token");
    } finally {
      setRevokingTokenId(null);
    }
  };

  const iframeSnippet = useMemo(() => {
    if (!orgSlug || !issuedToken) return "";
    const src = `${normalizedGatewayOrigin}/embed?org=${encodeURIComponent(orgSlug)}&theme=dark&token=${encodeURIComponent(issuedToken)}`;
    return `<iframe src="${src}" width="100%" height="800" style="border:0;" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  }, [issuedToken, orgSlug, normalizedGatewayOrigin]);

  const webComponentSnippet = useMemo(() => {
    if (!orgSlug || !issuedToken) return "";
    return `<pdc-gateway org-slug="${orgSlug}" theme="dark" token="${issuedToken}" gateway-origin="${normalizedGatewayOrigin}" height="800"></pdc-gateway>`;
  }, [issuedToken, orgSlug, normalizedGatewayOrigin]);

  const webComponentScriptSnippet = useMemo(() => {
    return `<script src="${normalizedGatewayOrigin}/pdc-gateway.js" crossorigin="anonymous"></script>`;
  }, [normalizedGatewayOrigin]);

  const fullWebComponentExample = useMemo(() => {
    if (!webComponentSnippet) return "";
    return `${webComponentScriptSnippet}

${webComponentSnippet}`;
  }, [webComponentScriptSnippet, webComponentSnippet]);

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Failed to copy ${label.toLowerCase()}`);
    }
  };

  const handleSelectIssuedToken = (id: string) => {
    setSelectedIssuedTokenId(id);
    const selected = tokenRows.find((item) => item.id === id);
    if (selected) {
      setIssuedToken(selected.token);
      setIssuedTokenType(selected.token_type);
    }
  };

  const tokenRows = useMemo<TokenRow[]>(() => {
    const persistentById = new Map(persistentTokens.map((p) => [p.id, p]));
    const historyRows: TokenRow[] = issuedTokenHistory.map((item) => {
      const persistentMeta = item.token_id ? persistentById.get(item.token_id) : undefined;
      return {
        ...item,
        label: item.label || persistentMeta?.label,
        origin: item.origin || persistentMeta?.origin || "",
        revoked_at: persistentMeta?.revoked_at ?? null,
        created_at: item.created_at || persistentMeta?.created_at || new Date().toISOString(),
      };
    });

    const existingPersistentIds = new Set(
      historyRows
        .filter((r) => !!r.token_id)
        .map((r) => r.token_id as string)
    );

    const persistentOnlyRows: TokenRow[] = persistentTokens
      .filter((p) => !existingPersistentIds.has(p.id))
      .map((p) => ({
        id: `persistent_${p.id}`,
        token: "",
        token_type: "persistent",
        token_id: p.id,
        origin: p.origin,
        label: p.label,
        created_at: p.created_at,
        revoked_at: p.revoked_at ?? null,
      }));

    return [...historyRows, ...persistentOnlyRows].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [issuedTokenHistory, persistentTokens]);

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
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Embed Access Control
          </CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={() => setGuideOpen(true)}>
            <BookOpen className="h-4 w-4 mr-2" />
            Integration Guide
          </Button>
        </div>
        <CardDescription>
          Register allowed origins and issue temporary (TTL) or persistent tokens for web component or iframe integrations.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div>
            <p className="font-medium">Enable Embedding</p>
            <p className="text-sm text-muted-foreground">When disabled, no new embed token can be issued.</p>
          </div>
          <Switch
            checked={settings.embed_enabled}
            onCheckedChange={(v) => setSettings({ ...settings, embed_enabled: v })}
          />
        </div>

        <div className="space-y-2">
          <Label>Allowed Origins</Label>
          <p className="text-xs text-muted-foreground">
            Embedded integrations must use the protected <code>/embed</code> route. The public <code>/:slug</code> route is for direct browser access and is blocked inside iframes.
          </p>
          <div className="flex gap-2">
            <Input
              value={newOrigin}
              onChange={(e) => setNewOrigin(e.target.value)}
              placeholder="https://app.example.com"
            />
            <Button type="button" variant="outline" onClick={addOrigin}>
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
          <div className="space-y-2">
            {settings.allowed_origins.length === 0 ? (
              <p className="text-xs text-muted-foreground">No allowed origins yet.</p>
            ) : (
              settings.allowed_origins.map((origin) => (
                <div key={origin} className="flex items-center justify-between border rounded px-3 py-2">
                  <code className="text-xs">{origin}</code>
                  <Button type="button" size="sm" variant="ghost" onClick={() => removeOrigin(origin)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>

        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            "Save Embed Settings"
          )}
        </Button>

        <div className="border-t pt-6 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            Issue Embed Token
          </h3>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={tokenType === "temporary" ? "default" : "outline"}
              onClick={() => setTokenType("temporary")}
            >
              Temporary (TTL)
            </Button>
            <Button
              type="button"
              variant={tokenType === "persistent" ? "default" : "outline"}
              onClick={() => setTokenType("persistent")}
            >
              Persistent
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2 space-y-1">
              <Label className="text-xs">Origin</Label>
              <Input
                list="allowed-origins"
                value={tokenOrigin}
                onChange={(e) => setTokenOrigin(e.target.value)}
                placeholder="https://app.example.com"
              />
              <datalist id="allowed-origins">
                {settings.allowed_origins.map((origin) => (
                  <option key={origin} value={origin} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                {tokenType === "temporary" ? "TTL (seconds)" : "Token Label"}
              </Label>
              {tokenType === "temporary" ? (
                <Input value={tokenTtl} onChange={(e) => setTokenTtl(e.target.value)} placeholder="3600" />
              ) : (
                <Input
                  value={persistentLabel}
                  onChange={(e) => setPersistentLabel(e.target.value)}
                  placeholder="Trusted Internal Embed"
                />
              )}
            </div>
          </div>
          <Button type="button" variant="outline" onClick={handleIssueToken} disabled={isIssuingToken}>
            {isIssuingToken ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Issuing...
              </>
            ) : (
              `Issue ${tokenType === "persistent" ? "Persistent" : "Temporary"} Token`
            )}
          </Button>

          {issuedToken && (
            <div className="space-y-3">
              {tokenRows.length > 0 && (
                <div>
                  <Label className="text-xs">Issued Tokens</Label>
                  <div className="mt-1 max-h-44 overflow-auto rounded border divide-y">
                    {tokenRows.map((item) => (
                      <div
                        key={item.id}
                        className={`px-3 py-2 flex items-center justify-between gap-3 ${
                          selectedIssuedTokenId === item.id ? "bg-primary/10" : "bg-background"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">
                            {item.token_type === "persistent" ? "Persistent" : "Temporary"} • {item.origin}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {new Date(item.created_at).toLocaleString()}
                            {item.label ? ` • ${item.label}` : ""} {item.revoked_at ? "• Revoked" : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant={selectedIssuedTokenId === item.id ? "default" : "outline"}
                            size="sm"
                            disabled={!item.token}
                            onClick={() => handleSelectIssuedToken(item.id)}
                          >
                            View
                          </Button>
                          {item.token_type === "persistent" && item.token_id && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={!!item.revoked_at || revokingTokenId === item.token_id}
                              onClick={() => handleRevokePersistentToken(item.token_id!)}
                            >
                              {revokingTokenId === item.token_id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                "Revoke"
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <Label className="text-xs">
                  Token ({issuedTokenType === "persistent" ? "Persistent" : "Temporary"})
                </Label>
                <div className="flex gap-2 mt-1">
                  <Input value={issuedToken} readOnly className="font-mono text-xs" />
                  <Button variant="outline" size="icon" onClick={() => copyText(issuedToken, "Token")}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {selectedIssuedTokenId && (
                <p className="text-xs text-muted-foreground">
                  Showing selected issued token details. Tokens issued before this feature may not be listed.
                </p>
              )}

              <div>
                <Label className="text-xs">Gateway Base URL (for snippets)</Label>
                <div className="mt-1">
                  <Input
                    value={gatewayBaseUrl}
                    onChange={(e) => setGatewayBaseUrl(e.target.value)}
                    placeholder="https://your-gateway-domain.com"
                    className="font-mono text-xs"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Use the public PTX Gateway URL reachable from the external site (not localhost unless same machine).
                </p>
              </div>

              <div>
                <Label className="text-xs">Iframe Snippet</Label>
                <div className="flex gap-2 mt-1">
                  <Input value={iframeSnippet} readOnly className="font-mono text-xs" />
                  <Button variant="outline" size="icon" onClick={() => copyText(iframeSnippet, "Iframe snippet")}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div>
                <Label className="text-xs">Web Component Snippet</Label>
                <div className="flex gap-2 mt-1">
                  <Input value={webComponentSnippet} readOnly className="font-mono text-xs" />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyText(webComponentSnippet, "Web component snippet")}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}

        </div>
      </CardContent>

      <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Embed Integration Guide</DialogTitle>
            <DialogDescription>
              Copy and paste these snippets to embed the gateway via iframe or web component.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 text-sm">
            <div className="space-y-2">
              <p className="font-medium">1. Preparation</p>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                <li>Enable embedding and save settings.</li>
                <li>Add your external host domain in Allowed Origins (example: <code>https://app.example.com</code>).</li>
                <li>Issue an embed token (temporary or persistent).</li>
                <li>Set Gateway Base URL to a publicly reachable PTX Gateway host (avoid localhost for external sites).</li>
                <li>Do not embed the public <code>/:slug</code> URL. Embedded usage must go through <code>/embed</code> with a valid token.</li>
              </ul>
            </div>

            <div className="space-y-2">
              <p className="font-medium">2. Route Rules</p>
              <div className="rounded border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
                <p><code>/:slug</code> is for direct public access in a normal browser tab.</p>
                <p><code>/embed?org=...&token=...</code> is required for iframe and web component integrations.</p>
                <p>If you load <code>/:slug</code> inside an iframe, the gateway now refuses to run and tells the user to use <code>/embed</code>.</p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="font-medium">3. Iframe (Copy/Paste)</p>
              <div className="rounded border bg-muted/40 p-3">
                <pre className="text-xs whitespace-pre-wrap break-all">{iframeSnippet || "<issue token first to generate snippet>"}</pre>
              </div>
              {iframeSnippet && (
                <Button type="button" variant="outline" size="sm" onClick={() => copyText(iframeSnippet, "Iframe snippet")}>
                  <Copy className="h-4 w-4 mr-2" />
                  Copy Iframe Snippet
                </Button>
              )}
            </div>

            <div className="space-y-2">
              <p className="font-medium">4. Web Component (Copy/Paste)</p>
              <div className="rounded border bg-muted/40 p-3">
                <pre className="text-xs whitespace-pre-wrap break-all">{fullWebComponentExample || "<issue token first to generate snippet>"}</pre>
              </div>
              {fullWebComponentExample && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copyText(fullWebComponentExample, "Web component source code")}
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Copy Web Component Source
                </Button>
              )}
            </div>

            <div className="space-y-1 text-xs text-muted-foreground">
              <p>Notes:</p>
              <p>- Keep embed tokens secret and rotate/revoke when needed.</p>
              <p>- Temporary tokens are safer for external sites; persistent tokens are for trusted internal apps.</p>
              <p>- Set Gateway Base URL to a reachable public URL; localhost usually fails from external servers.</p>
              <p>- If parent page is HTTPS, use HTTPS Gateway Base URL to avoid mixed-content blocking.</p>
              <p>- For web components, load <code>pdc-gateway.js</code> with <code>crossorigin="anonymous"</code>.</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default EmbedAccessSection;
