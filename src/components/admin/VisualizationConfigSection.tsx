import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Palette, Save, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  VisualizationSettings,
  getVisualizationSettingsFromOrgSettings,
  mergeVisualizationSettingsIntoOrgSettings,
} from "@/utils/visualizationSettings";

const DEFAULT_VISUALIZATION: VisualizationSettings = {
  favicon_url: "",
  primary_color: "",
  accent_color: "",
  background_color: "",
  card_color: "",
  design_url: "",
};

const VisualizationConfigSection = () => {
  const { user, refreshAuth } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingFavicon, setIsUploadingFavicon] = useState(false);
  const [settings, setSettings] = useState<VisualizationSettings>(DEFAULT_VISUALIZATION);

  const fetchVisualization = async () => {
    if (!user?.organization?.id) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("organizations")
        .select("settings")
        .eq("id", user.organization.id)
        .single();
      if (error) throw error;

      const visualization = getVisualizationSettingsFromOrgSettings(data?.settings);
      setSettings({
        ...DEFAULT_VISUALIZATION,
        ...visualization,
      });
    } catch {
      toast.error("Failed to load visualization settings");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchVisualization();
  }, [user?.organization?.id]);

  const handleSave = async () => {
    if (!user?.organization?.id) return;
    setIsSaving(true);
    try {
      const trimmedDesignUrl = settings.design_url?.trim() || "";
      if (trimmedDesignUrl) {
        try {
          const parsed = new URL(trimmedDesignUrl);
          if (!["http:", "https:"].includes(parsed.protocol)) {
            throw new Error("Unsupported protocol");
          }
        } catch {
          toast.error("Design URL must be a valid http/https URL");
          return;
        }
      }

      const { data: org, error: fetchError } = await supabase
        .from("organizations")
        .select("settings")
        .eq("id", user.organization.id)
        .single();
      if (fetchError) throw fetchError;

      const merged = mergeVisualizationSettingsIntoOrgSettings(org?.settings, {
        ...settings,
        design_url: trimmedDesignUrl,
      });
      const { error } = await supabase
        .from("organizations")
        .update({ settings: merged })
        .eq("id", user.organization.id);
      if (error) throw error;

      toast.success("Visualization settings saved");
      await refreshAuth();
      await fetchVisualization();
    } catch {
      toast.error("Failed to save visualization settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleFaviconFileUpload = async (file: File) => {
    const maxSizeBytes = 1024 * 1024; // 1MB
    const allowedTypes = [
      "image/png",
      "image/svg+xml",
      "image/x-icon",
      "image/vnd.microsoft.icon",
      "image/jpeg",
      "image/webp",
    ];

    if (!allowedTypes.includes(file.type)) {
      toast.error("Unsupported favicon type. Use .ico, .png, .svg, .jpg, or .webp");
      return;
    }

    if (file.size > maxSizeBytes) {
      toast.error("Favicon file is too large. Maximum size is 1MB");
      return;
    }

    setIsUploadingFavicon(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") resolve(reader.result);
          else reject(new Error("Failed to parse uploaded file"));
        };
        reader.onerror = () => reject(new Error("Failed to read uploaded file"));
        reader.readAsDataURL(file);
      });

      setSettings({ ...settings, favicon_url: dataUrl });
      toast.success("Favicon uploaded. Save visualization to apply.");
    } catch {
      toast.error("Failed to upload favicon");
    } finally {
      setIsUploadingFavicon(false);
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="h-5 w-5" />
          Visualization Settings
        </CardTitle>
        <CardDescription>
          Configure organization-specific favicon and colors for public/debug gateway pages.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="viz-design-url">Design URL</Label>
          <Input
            id="viz-design-url"
            value={settings.design_url || ""}
            onChange={(e) => setSettings({ ...settings, design_url: e.target.value })}
            placeholder="https://example.com/theme.json"
          />
          <p className="text-xs text-muted-foreground">
            Optional remote design JSON for this organization gateway. If provided, it overrides the default design from the environment.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="viz-favicon">Favicon URL</Label>
          <Input
            id="viz-favicon"
            value={settings.favicon_url || ""}
            onChange={(e) => setSettings({ ...settings, favicon_url: e.target.value })}
            placeholder="https://example.com/favicon.ico"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Label
              htmlFor="viz-favicon-file"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-secondary/40 hover:bg-secondary/70 cursor-pointer text-sm"
            >
              {isUploadingFavicon ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Upload Favicon
            </Label>
            <Input
              id="viz-favicon-file"
              type="file"
              accept=".ico,.png,.svg,.jpg,.jpeg,.webp,image/*"
              className="hidden"
              disabled={isUploadingFavicon}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void handleFaviconFileUpload(file);
                }
                e.currentTarget.value = "";
              }}
            />
            {settings.favicon_url && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSettings({ ...settings, favicon_url: "" })}
              >
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            )}
          </div>
          {settings.favicon_url && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <img
                src={settings.favicon_url}
                alt="Favicon preview"
                className="h-5 w-5 rounded border border-border bg-background object-contain"
              />
              <span>Preview</span>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Upload a favicon file or paste a URL. Uploaded files are stored as data URLs in organization settings.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="viz-primary">Primary Color (Hex)</Label>
            <Input
              id="viz-primary"
              value={settings.primary_color || ""}
              onChange={(e) => setSettings({ ...settings, primary_color: e.target.value })}
              placeholder="#00bcd4"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="viz-accent">Accent Color (Hex)</Label>
            <Input
              id="viz-accent"
              value={settings.accent_color || ""}
              onChange={(e) => setSettings({ ...settings, accent_color: e.target.value })}
              placeholder="#0288d1"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="viz-bg">Background Color (Hex)</Label>
            <Input
              id="viz-bg"
              value={settings.background_color || ""}
              onChange={(e) => setSettings({ ...settings, background_color: e.target.value })}
              placeholder="#0a0f1f"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="viz-card">Card Color (Hex)</Label>
            <Input
              id="viz-card"
              value={settings.card_color || ""}
              onChange={(e) => setSettings({ ...settings, card_color: e.target.value })}
              placeholder="#111827"
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Colors should be hex format (for example: #00bcd4). Empty values keep default theme colors.
        </p>

        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Save Visualization
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
};

export default VisualizationConfigSection;
