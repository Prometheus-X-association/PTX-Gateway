import { ChangeEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { Settings, Database, Globe, Users, Shield, ArrowLeft, Building2, Palette, Link2, Brain, FileJson, Timer } from "lucide-react";
import { Download, Upload, Loader2, Copy, Info } from "lucide-react";
import PdcConfigSection from "./PdcConfigSection";
import ResourcesConfigSection from "./ResourcesConfigSection";
import GlobalConfigSection from "./GlobalConfigSection";
import UsersManagementSection from "./UsersManagementSection";
import UserMenu from "@/components/UserMenu";
import OrganizationManagementSection from "./OrganizationManagementSection";
import VisualizationConfigSection from "./VisualizationConfigSection";
import EmbedAccessSection from "./EmbedAccessSection";
import LlmSettingsSection from "./LlmSettingsSection";
import ResultPageSettingsSection from "./ResultPageSettingsSection";
import DataSelectionSettingsSection from "./DataSelectionSettingsSection";
import ProcessingPageSettingsSection from "./ProcessingPageSettingsSection";
import ChooseAnalyticsPageSettingsSection from "./ChooseAnalyticsPageSettingsSection";
import {
  exportSettingsBackup,
  importSettingsBackup,
  importSettingsFromOrganization,
  ImportSettingsSummary,
  SettingsBackupData,
} from "@/services/configApi";
import { toast } from "sonner";

const AdminDashboard = () => {
  const navigate = useNavigate();
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState("pdc");
  const [activeGeneralSubTab, setActiveGeneralSubTab] = useState("global");
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isCopyingFromOrg, setIsCopyingFromOrg] = useState(false);
  const [showCrossOrgImportDialog, setShowCrossOrgImportDialog] = useState(false);
  const [sourceOrganizationId, setSourceOrganizationId] = useState("");
  const [importSections, setImportSections] = useState({
    pdc: true,
    resources: true,
    serviceChains: true,
    globalConfig: false,
    resultPageSettings: true,
    dataSelectionSettings: true,
    organizationSettings: false,
    embedSettings: false,
  });

  const formatImportSummary = (summary?: ImportSettingsSummary | null) => {
    if (!summary) return "";

    const parts: string[] = [];
    if (summary.organizationSettingsImported) parts.push("organization settings updated");
    if (summary.globalConfigImported) parts.push("global config updated");
    if (summary.resultPageSettingsImported) parts.push("result page settings updated");
    if (summary.dataSelectionSettingsImported) parts.push("data selection settings updated");
    if (summary.embedSettingsImported) parts.push("embed settings updated");
    if (summary.pdcConfigsCreated) parts.push(`${summary.pdcConfigsCreated} PDC config created`);
    if (summary.pdcConfigsUpdated) parts.push(`${summary.pdcConfigsUpdated} PDC config updated`);
    if (summary.pdcBearerTokenImported) parts.push("PDC bearer token imported");
    if (summary.resourcesCreated) parts.push(`${summary.resourcesCreated} resource created`);
    if (summary.resourcesUpdated) parts.push(`${summary.resourcesUpdated} resource updated`);
    if (summary.serviceChainsCreated) parts.push(`${summary.serviceChainsCreated} service chain created`);
    if (summary.serviceChainsUpdated) parts.push(`${summary.serviceChainsUpdated} service chain updated`);
    if (summary.embeddedResourcesRemapped) parts.push(`${summary.embeddedResourcesRemapped} embedded resource remapped`);

    return parts.join(", ");
  };

  const sourceOrganizations = (user?.organizations || []).filter((membership) =>
    membership.organization.id !== user?.organization?.id &&
    (membership.role === "admin" || membership.role === "super_admin")
  );

  const handleExportSettings = async () => {
    if (!user?.organization?.id) {
      toast.error("No active organization selected");
      return;
    }

    setIsExporting(true);
    try {
      const { data, error } = await exportSettingsBackup(user.organization.id);
      if (error || !data) {
        throw error || new Error("Failed to export settings");
      }

      const fileName = `ptx-settings-${user.organization.slug || 'organization'}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      toast.success("Settings exported");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to export settings");
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!user?.organization?.id) {
      toast.error("No active organization selected");
      return;
    }

    setIsImporting(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as SettingsBackupData;

      const { data, error } = await importSettingsBackup(parsed, user.organization.id);
      if (error) {
        throw error;
      }

      const summaryText = formatImportSummary(data?.summary);
      toast.success(summaryText ? `Settings imported: ${summaryText}. Reloading admin page...` : "Settings imported. Reloading admin page...");
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to import settings");
    } finally {
      setIsImporting(false);
    }
  };

  const handleToggleImportSection = (key: keyof typeof importSections, checked: boolean) => {
    setImportSections((current) => ({ ...current, [key]: checked }));
  };

  const handleImportFromOrganization = async () => {
    if (!user?.organization?.id) {
      toast.error("No active organization selected");
      return;
    }

    if (!sourceOrganizationId) {
      toast.error("Select a source organization");
      return;
    }

    if (!Object.values(importSections).some(Boolean)) {
      toast.error("Select at least one settings section to import");
      return;
    }

    setIsCopyingFromOrg(true);
    try {
      const { data, error } = await importSettingsFromOrganization(
        {
          sourceOrganizationId,
          sections: importSections,
        },
        user.organization.id,
      );

      if (error) {
        throw error;
      }

      const summaryText = formatImportSummary(data?.summary);
      toast.success(summaryText ? `Settings copied: ${summaryText}. Reloading admin page...` : "Settings copied from organization. Reloading admin page...");
      setShowCrossOrgImportDialog(false);
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to import from organization");
    } finally {
      setIsCopyingFromOrg(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <Shield className="h-12 w-12 text-destructive mx-auto mb-4" />
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              You don't have permission to access the admin dashboard.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Background Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] opacity-30 pointer-events-none">
        <div className="absolute inset-0" style={{ background: "var(--gradient-glow)" }} />
      </div>

      <div className="relative z-10 container mx-auto px-4 py-8 max-w-6xl">
        <header className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => navigate("/debug")}
                className="mr-2"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <Settings className="h-8 w-8 text-primary" />
              <h1 className="text-3xl font-bold">Admin Dashboard</h1>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setShowCrossOrgImportDialog(true)}
                disabled={isImporting || isExporting || isCopyingFromOrg || sourceOrganizations.length === 0}
              >
                <Copy className="h-4 w-4 mr-2" />
                Import From Org
              </Button>
              <Button variant="outline" onClick={handleExportSettings} disabled={isExporting || isImporting}>
                {isExporting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Exporting...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Export Settings
                  </>
                )}
              </Button>
              <Button variant="outline" disabled={isImporting || isExporting} asChild>
                <label className="cursor-pointer">
                  {isImporting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Import Settings
                    </>
                  )}
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={handleImportFile}
                    disabled={isImporting || isExporting}
                  />
                </label>
              </Button>
              <UserMenu />
            </div>
          </div>
          <p className="text-muted-foreground ml-14">
            Manage PDC configuration, resources, and system settings for{" "}
            <span className="font-medium text-foreground">{user?.organization?.name}</span>
          </p>
          <p className="text-sm text-muted-foreground ml-14 mt-2">
            You can import a settings file exported from this organization or a different organization. Imported data
            is applied to the currently active organization.
          </p>
          <p className="text-xs text-muted-foreground ml-14 mt-1">
            Export schema: <code>v5</code>. Backups using this schema include current dashboard settings such as data
            selection mappings and software-scoped resource visibility.
          </p>
          {sourceOrganizations.length === 0 && (
            <p className="text-sm text-muted-foreground ml-14 mt-1">
              Cross-organization import is available when you are an admin in more than one organization.
            </p>
          )}
        </header>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-7 lg:w-auto lg:inline-flex">
            <TabsTrigger value="pdc" className="flex items-center gap-2">
              <Globe className="h-4 w-4" />
              <span className="hidden sm:inline">PDC Config</span>
              <span className="sm:hidden">PDC</span>
            </TabsTrigger>
            <TabsTrigger value="global" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              <span className="hidden sm:inline">Global Settings</span>
              <span className="sm:hidden">Settings</span>
            </TabsTrigger>
            <TabsTrigger value="resources" className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              <span className="hidden sm:inline">Resources</span>
              <span className="sm:hidden">Data</span>
            </TabsTrigger>
            <TabsTrigger value="choose-analytics-page" className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              <span className="hidden sm:inline">Choose Analytics Page</span>
              <span className="sm:hidden">Analytics</span>
            </TabsTrigger>
            <TabsTrigger value="data-selection" className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              <span className="hidden sm:inline">Data Selection</span>
              <span className="sm:hidden">Data Sel</span>
            </TabsTrigger>
            <TabsTrigger value="processing-page" className="flex items-center gap-2">
              <Timer className="h-4 w-4" />
              <span className="hidden sm:inline">Show Processing Page</span>
              <span className="sm:hidden">Processing</span>
            </TabsTrigger>
            <TabsTrigger value="result" className="flex items-center gap-2">
              <FileJson className="h-4 w-4" />
              <span className="hidden sm:inline">Result Page</span>
              <span className="sm:hidden">Result</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pdc">
            <PdcConfigSection />
          </TabsContent>

          <TabsContent value="resources">
            <ResourcesConfigSection />
          </TabsContent>

          <TabsContent value="choose-analytics-page">
            <ChooseAnalyticsPageSettingsSection />
          </TabsContent>

          <TabsContent value="global">
            <Tabs value={activeGeneralSubTab} onValueChange={setActiveGeneralSubTab} className="w-full">
              <div className="rounded-xl border border-border/60 bg-muted/30 p-2 shadow-sm animate-in fade-in-50 duration-300">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  <TabsList className="h-auto min-w-max gap-2 bg-transparent p-0">
                    <TabsTrigger
                      value="global"
                      className="rounded-lg border border-transparent bg-background/70 px-4 py-2 text-xs font-medium transition-all data-[state=active]:border-primary/40 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-sm"
                    >
                      General
                    </TabsTrigger>
                    <TabsTrigger
                      value="external-oidc"
                      className="rounded-lg border border-transparent bg-background/70 px-4 py-2 text-xs font-medium transition-all data-[state=active]:border-primary/40 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-sm"
                    >
                      External OIDC
                    </TabsTrigger>
                    <TabsTrigger
                      value="llm"
                      className="rounded-lg border border-transparent bg-background/70 px-4 py-2 text-xs font-medium transition-all data-[state=active]:border-primary/40 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-sm"
                    >
                      LLM Settings
                    </TabsTrigger>
                    <TabsTrigger
                      value="visualization"
                      className="rounded-lg border border-transparent bg-background/70 px-4 py-2 text-xs font-medium transition-all data-[state=active]:border-primary/40 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-sm"
                    >
                      Visualization
                    </TabsTrigger>
                    <TabsTrigger
                      value="embed"
                      className="rounded-lg border border-transparent bg-background/70 px-4 py-2 text-xs font-medium transition-all data-[state=active]:border-primary/40 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-sm"
                    >
                      Embed
                    </TabsTrigger>
                {isSuperAdmin && (
                      <TabsTrigger
                        value="users"
                        className="rounded-lg border border-transparent bg-background/70 px-4 py-2 text-xs font-medium transition-all data-[state=active]:border-primary/40 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-sm"
                      >
                        Users
                      </TabsTrigger>
                )}
                {isSuperAdmin && (
                      <TabsTrigger
                        value="organization"
                        className="rounded-lg border border-transparent bg-background/70 px-4 py-2 text-xs font-medium transition-all data-[state=active]:border-primary/40 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-sm"
                      >
                        Organization
                      </TabsTrigger>
                )}
                  </TabsList>
                </div>
              </div>

              <TabsContent value="global" className="space-y-6 pt-4 animate-in fade-in-50 slide-in-from-bottom-1 duration-300">
                <GlobalConfigSection section="general" />
              </TabsContent>
              <TabsContent value="external-oidc" className="space-y-6 pt-4 animate-in fade-in-50 slide-in-from-bottom-1 duration-300">
                <GlobalConfigSection section="external-oidc" />
              </TabsContent>
              <TabsContent value="llm" className="space-y-6 pt-4 animate-in fade-in-50 slide-in-from-bottom-1 duration-300">
                <LlmSettingsSection />
              </TabsContent>
              <TabsContent value="visualization" className="space-y-6 pt-4 animate-in fade-in-50 slide-in-from-bottom-1 duration-300">
                <VisualizationConfigSection />
              </TabsContent>
              <TabsContent value="embed" className="space-y-6 pt-4 animate-in fade-in-50 slide-in-from-bottom-1 duration-300">
                <EmbedAccessSection />
              </TabsContent>
              {isSuperAdmin && (
                <TabsContent value="users" className="space-y-6 pt-4 animate-in fade-in-50 slide-in-from-bottom-1 duration-300">
                  <UsersManagementSection />
                </TabsContent>
              )}
              {isSuperAdmin && (
                <TabsContent value="organization" className="space-y-6 pt-4 animate-in fade-in-50 slide-in-from-bottom-1 duration-300">
                  <OrganizationManagementSection />
                </TabsContent>
              )}
            </Tabs>
          </TabsContent>

          <TabsContent value="data-selection">
            <DataSelectionSettingsSection />
          </TabsContent>

          <TabsContent value="processing-page">
            <ProcessingPageSettingsSection />
          </TabsContent>

          <TabsContent value="result">
            <ResultPageSettingsSection />
          </TabsContent>

        </Tabs>
      </div>

      <Dialog open={showCrossOrgImportDialog} onOpenChange={setShowCrossOrgImportDialog}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Import Settings From Another Organization</DialogTitle>
            <DialogDescription>
              Copy configuration from a source organization where you also have admin access into{" "}
              {user?.organization?.name}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                Matching records are updated in the current organization. New records are created when no match exists.
                Embed issued tokens are never copied; only allowed origins and non-token embed settings are portable.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label htmlFor="source-organization">Source organization</Label>
              <Select value={sourceOrganizationId} onValueChange={setSourceOrganizationId}>
                <SelectTrigger id="source-organization">
                  <SelectValue placeholder="Select source organization" />
                </SelectTrigger>
                <SelectContent>
                  {sourceOrganizations.map((membership) => (
                    <SelectItem key={membership.organization.id} value={membership.organization.id}>
                      {membership.organization.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <Label>Settings to import</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
                  <Checkbox
                    checked={importSections.pdc}
                    onCheckedChange={(checked) => handleToggleImportSection("pdc", checked === true)}
                  />
                  <div>
                    <p className="font-medium">PDC Config</p>
                    <p className="text-sm text-muted-foreground">Endpoints, fallback settings, and bearer token.</p>
                  </div>
                </label>
                <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
                  <Checkbox
                    checked={importSections.resources}
                    onCheckedChange={(checked) => handleToggleImportSection("resources", checked === true)}
                  />
                  <div>
                    <p className="font-medium">Resources</p>
                    <p className="text-sm text-muted-foreground">Software and data resource definitions.</p>
                  </div>
                </label>
                <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
                  <Checkbox
                    checked={importSections.serviceChains}
                    onCheckedChange={(checked) => handleToggleImportSection("serviceChains", checked === true)}
                  />
                  <div>
                    <p className="font-medium">Service Chains</p>
                    <p className="text-sm text-muted-foreground">Execution flows and embedded resources.</p>
                  </div>
                </label>
                <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
                  <Checkbox
                    checked={importSections.globalConfig}
                    onCheckedChange={(checked) => handleToggleImportSection("globalConfig", checked === true)}
                  />
                  <div>
                    <p className="font-medium">Global Settings</p>
                    <p className="text-sm text-muted-foreground">Feature flags, environment, and LLM settings.</p>
                  </div>
                </label>
                <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
                  <Checkbox
                    checked={importSections.resultPageSettings}
                    onCheckedChange={(checked) => handleToggleImportSection("resultPageSettings", checked === true)}
                  />
                  <div>
                    <p className="font-medium">Result Page Settings</p>
                    <p className="text-sm text-muted-foreground">Export API endpoints, active state, API versions, analytics mappings, custom visualizations, and reusable visualization library bundles.</p>
                  </div>
                </label>
                <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
                  <Checkbox
                    checked={importSections.dataSelectionSettings}
                    onCheckedChange={(checked) => handleToggleImportSection("dataSelectionSettings", checked === true)}
                  />
                  <div>
                    <p className="font-medium">Data Selection Settings</p>
                    <p className="text-sm text-muted-foreground">Custom API visibility targets and data page plugin placeholder settings.</p>
                  </div>
                </label>
                <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
                  <Checkbox
                    checked={importSections.embedSettings}
                    onCheckedChange={(checked) => handleToggleImportSection("embedSettings", checked === true)}
                  />
                  <div>
                    <p className="font-medium">Embed Settings</p>
                    <p className="text-sm text-muted-foreground">Embed enabled state and allowed origins. Tokens are excluded.</p>
                  </div>
                </label>
                <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer sm:col-span-2">
                  <Checkbox
                    checked={importSections.organizationSettings}
                    onCheckedChange={(checked) => handleToggleImportSection("organizationSettings", checked === true)}
                  />
                  <div>
                    <p className="font-medium">Organization Settings</p>
                    <p className="text-sm text-muted-foreground">Gateway-level organization metadata and presentation settings.</p>
                  </div>
                </label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCrossOrgImportDialog(false)}
              disabled={isCopyingFromOrg}
            >
              Cancel
            </Button>
            <Button onClick={handleImportFromOrganization} disabled={isCopyingFromOrg || !sourceOrganizationId}>
              {isCopyingFromOrg && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Import Selected Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminDashboard;
