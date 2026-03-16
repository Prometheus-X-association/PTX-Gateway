import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Save, Trash2, Copy, Building2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const OrganizationManagementSection = () => {
  const { user, isSuperAdmin, updateOrganization, deleteOrganization, refreshAuth } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [isCheckingSlug, setIsCheckingSlug] = useState(false);
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [isPublicDiscoveryEnabled, setIsPublicDiscoveryEnabled] = useState(false);

  const org = user?.organization;

  useEffect(() => {
    if (org) {
      setName(org.name);
      setSlug(org.slug);
      setDescription((org as any).description || "");
      setIsPublicDiscoveryEnabled((org.settings?.public_discovery_enabled as boolean) === true);
    }
  }, [org]);

  const checkSlugAvailability = async (newSlug: string) => {
    if (!newSlug.trim() || newSlug === org?.slug) {
      setSlugAvailable(null);
      return;
    }
    setIsCheckingSlug(true);
    const { data, error } = await supabase.rpc('is_slug_available', {
      _slug: newSlug,
      _exclude_org_id: org?.id || null,
    });
    setSlugAvailable(error ? null : !!data);
    setIsCheckingSlug(false);
  };

  const handleSlugChange = (value: string) => {
    // Only allow valid slug characters
    const sanitized = value.replace(/[^a-z0-9-]/g, '');
    setSlug(sanitized);
    setSlugAvailable(null);
  };

  const handleGenerateUUID = () => {
    const newSlug = crypto.randomUUID();
    setSlug(newSlug);
    setSlugAvailable(null);
    checkSlugAvailability(newSlug);
  };

  const handleSave = async () => {
    if (!org || !isSuperAdmin) return;
    if (!name.trim()) {
      toast.error("Organization name is required");
      return;
    }
    if (!slug.trim()) {
      toast.error("Gateway URL slug is required");
      return;
    }

    setIsSaving(true);
    const { error } = await updateOrganization(org.id, name.trim(), slug.trim(), description.trim() || null);
    if (error) {
      toast.error(error.message || "Failed to update organization");
      setIsSaving(false);
      return;
    }

    const currentSettings = (org.settings && typeof org.settings === "object") ? org.settings : {};
    const updatedSettings = {
      ...currentSettings,
      public_discovery_enabled: isPublicDiscoveryEnabled,
    };

    const { error: settingsError } = await supabase
      .from("organizations")
      .update({ settings: updatedSettings })
      .eq("id", org.id);

    if (settingsError) {
      toast.error(settingsError.message || "Organization saved, but failed to update discovery visibility");
    } else {
      await refreshAuth();
      toast.success("Organization updated successfully");
    }
    setIsSaving(false);
  };

  const handleDelete = async () => {
    if (!org || !isSuperAdmin) return;
    setIsDeleting(true);
    const { error } = await deleteOrganization(org.id);
    if (error) {
      toast.error(error.message || "Failed to delete organization");
    } else {
      toast.success("Organization deleted");
      navigate("/debug");
    }
    setIsDeleting(false);
  };

  const copyGatewayUrl = () => {
    const url = `${window.location.origin}/${slug}`;
    navigator.clipboard.writeText(url);
    toast.success("Gateway URL copied to clipboard");
  };

  if (!org || !isSuperAdmin) return null;

  const hasChanges =
    name !== org.name ||
    slug !== org.slug ||
    description !== ((org as any).description || "") ||
    isPublicDiscoveryEnabled !== ((org.settings?.public_discovery_enabled as boolean) === true);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Organization Details
          </CardTitle>
          <CardDescription>
            Manage your organization's name, gateway URL, and description.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="org-name">Organization Name</Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Organization"
            />
          </div>

          {/* Slug / Gateway URL */}
          <div className="space-y-2">
            <Label htmlFor="org-slug">Gateway URL Slug</Label>
            <div className="flex gap-2">
              <Input
                id="org-slug"
                value={slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                onBlur={() => checkSlugAvailability(slug)}
                placeholder="unique-identifier"
                className="font-mono text-sm"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleGenerateUUID}
                title="Generate new UUID"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={copyGatewayUrl}
                title="Copy gateway URL"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground">
                Gateway: <span className="font-mono">{window.location.origin}/{slug}</span>
              </p>
              {isCheckingSlug && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              {slugAvailable === true && <Badge variant="outline" className="text-xs text-green-600 border-green-600">Available</Badge>}
              {slugAvailable === false && <Badge variant="destructive" className="text-xs">Already in use</Badge>}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="org-desc">Description</Label>
            <Textarea
              id="org-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of your organization..."
              rows={3}
            />
          </div>

          {/* Public discovery */}
          <div className="rounded-lg border border-border p-4 space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="public-discovery">Allow public discovery</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  If enabled, users can find this organization in Find Organization by matching name and description.
                </p>
              </div>
              <Switch
                id="public-discovery"
                checked={isPublicDiscoveryEnabled}
                onCheckedChange={setIsPublicDiscoveryEnabled}
              />
            </div>
          </div>

          <Button onClick={handleSave} disabled={isSaving || !hasChanges || slugAvailable === false}>
            {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save Changes
          </Button>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>
            Permanently delete this organization and all its data. This action cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Organization
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete "{org.name}"?</AlertDialogTitle>
                <AlertDialogDescription className="space-y-3">
                  <p>
                    This will permanently delete the organization and <strong>all associated data</strong>:
                    configurations, resources, service chains, execution logs, and member associations.
                  </p>
                  <p>
                    Type <strong>{org.name}</strong> below to confirm:
                  </p>
                  <Input
                    value={deleteConfirmName}
                    onChange={(e) => setDeleteConfirmName(e.target.value)}
                    placeholder={org.name}
                  />
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setDeleteConfirmName("")}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  disabled={deleteConfirmName !== org.name || isDeleting}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isDeleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Delete Permanently
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
};

export default OrganizationManagementSection;
