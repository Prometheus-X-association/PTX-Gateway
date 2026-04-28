import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const DEFAULT_PENDING_WAIT_SECONDS = 60;
const MIN_PENDING_WAIT_SECONDS = 5;
const MAX_PENDING_WAIT_SECONDS = 600;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const clampPendingWaitSeconds = (value: number): number =>
  Math.max(MIN_PENDING_WAIT_SECONDS, Math.min(MAX_PENDING_WAIT_SECONDS, Math.round(value)));

const ProcessingPageSettingsSection = () => {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [configId, setConfigId] = useState<string | null>(null);
  const [pendingWaitSeconds, setPendingWaitSeconds] = useState<number>(DEFAULT_PENDING_WAIT_SECONDS);

  useEffect(() => {
    const fetchData = async () => {
      if (!user?.organization?.id) return;
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from("global_configs")
          .select("id, features")
          .eq("organization_id", user.organization.id)
          .maybeSingle();
        if (error) throw error;

        setConfigId(data?.id ?? null);
        const features = isRecord(data?.features) ? data.features : {};
        const processingPage = isRecord(features.processingPage) ? features.processingPage : {};
        const parsed = typeof processingPage.pendingWaitSeconds === "number"
          ? clampPendingWaitSeconds(processingPage.pendingWaitSeconds)
          : DEFAULT_PENDING_WAIT_SECONDS;
        setPendingWaitSeconds(parsed);
      } catch {
        toast.error("Failed to load processing page settings");
      } finally {
        setIsLoading(false);
      }
    };

    void fetchData();
  }, [user?.organization?.id]);

  const saveSettings = async () => {
    if (!user?.organization?.id || !configId) return;
    setIsSaving(true);
    try {
      const { data: existing, error: fetchError } = await supabase
        .from("global_configs")
        .select("features")
        .eq("id", configId)
        .maybeSingle();
      if (fetchError) throw fetchError;

      const existingFeatures = isRecord(existing?.features) ? existing.features : {};
      const nextFeatures = {
        ...existingFeatures,
        processingPage: {
          pendingWaitSeconds: clampPendingWaitSeconds(pendingWaitSeconds),
        },
      };

      const { error } = await supabase
        .from("global_configs")
        .update({ features: nextFeatures })
        .eq("id", configId);
      if (error) throw error;
      toast.success("Processing page settings saved");
    } catch {
      toast.error("Failed to save processing page settings");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">Loading...</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Processing Page</CardTitle>
        <CardDescription>
          Configure how long gateway waits before switching to pending-retry checks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="pending-wait-seconds">Wait up to (seconds)</Label>
          <Input
            id="pending-wait-seconds"
            type="number"
            min={MIN_PENDING_WAIT_SECONDS}
            max={MAX_PENDING_WAIT_SECONDS}
            value={pendingWaitSeconds}
            onChange={(event) => {
              const raw = Number(event.target.value);
              if (!Number.isFinite(raw)) {
                setPendingWaitSeconds(DEFAULT_PENDING_WAIT_SECONDS);
                return;
              }
              setPendingWaitSeconds(clampPendingWaitSeconds(raw));
            }}
          />
          <p className="text-xs text-muted-foreground">
            Range: {MIN_PENDING_WAIT_SECONDS}-{MAX_PENDING_WAIT_SECONDS} seconds.
          </p>
        </div>

        <Button onClick={saveSettings} disabled={isSaving}>
          <Save className="h-4 w-4 mr-2" />
          {isSaving ? "Saving..." : "Save Processing Settings"}
        </Button>
      </CardContent>
    </Card>
  );
};

export default ProcessingPageSettingsSection;
