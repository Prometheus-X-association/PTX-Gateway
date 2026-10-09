import KnowledgeManagement from "./KnowledgeManagement";
import { ChangeEvent, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import { Settings, Database, Globe, Shield, ArrowLeft, Brain, LayoutDashboard, PanelsTopLeft, History } from "lucide-react";
import { Download, Upload, Loader2, Copy, Info } from "lucide-react";
import StudioManagement from "./StudioManagement";
import AdminOverview from "./AdminOverview";
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
import PlaceholdersConfigSection from "./PlaceholdersConfigSection";
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
  const [searchParams, setSearchParams] = useSearchParams();
  const sections = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "llm", label: "Agent Orchestration", icon: Brain },
    { id: "applications", label: "Applications & Pages", icon: PanelsTopLeft },
    { id: "knowledge", label: "Knowledge & Skills", icon: Database },
    { id: "chat-drawers", label: "Chat Drawers", icon: Brain },
    { id: "resources", label: "Resources", icon: Database },
    { id: "pdc", label: "PDC Configuration", icon: Globe },
    { id: "global", label: "Global Settings", icon: Settings },
    { id: "legacy", label: "Legacy Gateway", icon: History },
  ];
  const requestedSection = searchParams.get("section") || "llm";
  const activeTab = sections.some((section) => section.id === requestedSection) ? requestedSection : "llm";
  const setActiveTab = (section: string) => setSearchParams((previous) => {
    const next = new URLSearchParams(previous);
    next.set("section", section);
    return next;
  });
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
    globalConfig: true,
    resultPageSettings: true,
    dataSelectionSettings: true,
    processingPageSettings: true,
    agentOperations: true,
    placeholders: true,
    oidcProviderSettings: false,
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
    if (summary.processingPageSettingsImported) parts.push("processing page settings updated");
    if (summary.agentOperationsImported) parts.push("agent operations updated");
    if (summary.embedSettingsImported) parts.push("embed settings updated");
    if (summary.pdcConfigsCreated) parts.push(`${summary.pdcConfigsCreated} PDC config created`);
    if (summary.pdcConfigsUpdated) parts.push(`${summary.pdcConfigsUpdated} PDC config updated`);
    if (summary.pdcBearerTokenImported) parts.push("PDC bearer token imported");
    if (summary.resourcesCreated) parts.push(`${summary.resourcesCreated} resource created`);
    if (summary.resourcesUpdated) parts.push(`${summary.resourcesUpdated} resource updated`);
    if (summary.serviceChainsCreated) parts.push(`${summary.serviceChainsCreated} service chain created`);
    if (summary.serviceChainsUpdated) parts.push(`${summary.serviceChainsUpdated} service chain updated`);
    if (summary.embeddedResourcesRemapped) parts.push(`${summary.embeddedResourcesRemapped} embedded resource remapped`);
    if (summary.placeholdersCreated) parts.push(`${summary.placeholdersCreated} placeholder created`);
    if (summary.placeholdersUpdated) parts.push(`${summary.placeholdersUpdated} placeholder updated`);
    if (summary.oidcProviderClientsCreated) parts.push(`${summary.oidcProviderClientsCreated} OIDC client created`);
    if (summary.oidcProviderClientsUpdated) parts.push(`${summary.oidcProviderClientsUpdated} OIDC client updated`);
    if (summary.referencesRemapped) parts.push("resource references remapped");

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
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[800px] h-[600px] opacity-30 pointer-events-none">
        <div className="absolute inset-0" style={{ background: "var(--gradient-glow)" }} />
      </div>

      <div className="relative z-10 container mx-auto px-4 py-8 max-w-[1600px]">
        <header className="mb-8">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-2">
            <div className="flex items-center gap-3">
              <Button 
                variant="ghost" 
                size="icon" 
                aria-label="Return to debug gateway"
                onClick={() => navigate("/debug")}
                className="mr-2"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <Settings className="h-8 w-8 text-primary" />
              <h1 className="text-3xl font-bold">Organization Studio</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
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
            Build applications and orchestrate agents for{" "}
            <span className="font-medium text-foreground">{user?.organization?.name}</span>
          </p>
          <details className="mt-3 text-sm text-muted-foreground">
            <summary className="cursor-pointer">About settings backups</summary>
            <p className="mt-2">Imports apply to the active organization. Version 7 backups include agent operations, placeholders, legacy gateway settings and OIDC configuration. Cross-organization import requires admin access to both organizations.</p>
          </details>
        </header>

        <Tabs value={activeTab} onValueChange={setActiveTab} orientation="vertical" className="grid items-start gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="Organization administration" className="md:sticky md:top-6">
            <TabsList className="flex h-auto w-full flex-col items-stretch gap-1 bg-muted/40 p-2">
              {sections.map(({ id, label, icon: Icon }) => (
                <TabsTrigger key={id} value={id} className="justify-start gap-3 whitespace-normal px-3 py-3 text-left">
                  <Icon className="h-4 w-4 shrink-0" />{label}
                </TabsTrigger>
              ))}
            </TabsList>
          </nav>
          <main className="min-w-0" key={`${user?.id}:${user?.organization?.id}`}>
          <TabsContent value="overview"><AdminOverview onNavigate={setActiveTab} /></TabsContent>
          <TabsContent value="knowledge"><KnowledgeManagement key={user?.organization?.id} /></TabsContent>
          <TabsContent value="applications"><StudioManagement key={user?.organization?.id} /></TabsContent>
          <TabsContent value="chat-drawers"><StudioManagement key={user?.organization?.id} chats /></TabsContent>
          <TabsContent value="legacy">
            <Card className="mb-4"><CardHeader><CardTitle>Legacy Gateway</CardTitle><CardDescription>Configure the existing four-step gateway while application pages are introduced.</CardDescription></CardHeader></Card>
            <Tabs defaultValue="analytics">
              <TabsList className="flex h-auto flex-wrap justify-start">
                <TabsTrigger value="analytics">Analytics Selection</TabsTrigger>
                <TabsTrigger value="data">Data Selection</TabsTrigger>
                <TabsTrigger value="processing">Processing</TabsTrigger>
                <TabsTrigger value="results">Results</TabsTrigger>
              </TabsList>
              <TabsContent value="analytics"><ChooseAnalyticsPageSettingsSection /></TabsContent>
              <TabsContent value="data"><DataSelectionSettingsSection /></TabsContent>
              <TabsContent value="processing"><ProcessingPageSettingsSection /></TabsContent>
              <TabsContent value="results"><ResultPageSettingsSection /></TabsContent>
            </Tabs>
          </TabsContent>
          <TabsContent value="pdc">
            <PdcConfigSection />
          </TabsContent>

          <TabsContent value="resources">
            <ResourcesConfigSection />
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
                      value="placeholders"
                      className="rounded-lg border border-transparent bg-background/70 px-4 py-2 text-xs font-medium transition-all data-[state=active]:border-primary/40 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-sm"
                    >
                      Placeholders
                    </TabsTrigger>
                    <TabsTrigger
                      value="oidc-provider"
                      className="rounded-lg border border-transparent bg-background/70 px-4 py-2 text-xs font-medium transition-all data-[state=active]:border-primary/40 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-sm"
                    >
                      OIDC Provider
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
              <TabsContent value="placeholders" className="space-y-6 pt-4 animate-in fade-in-50 slide-in-from-bottom-1 duration-300">
                <PlaceholdersConfigSection />
              </TabsContent>
              <TabsContent value="oidc-provider" className="space-y-6 pt-4 animate-in fade-in-50 slide-in-from-bottom-1 duration-300">
                <GlobalConfigSection section="oidc-provider" />
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




          <TabsContent value="llm">
            <LlmSettingsSection />
          </TabsContent>

          </main>
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
                    <p className="text-sm text-muted-foreground">Feature flags and environment.</p>
                  </div>
                </label>
                <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
                  <Checkbox
                    checked={importSections.agentOperations}
                    onCheckedChange={(checked) => handleToggleImportSection("agentOperations", checked === true)}
                  />
                  <div>
                    <p className="font-medium">Agent Operations</p>
                    <p className="text-sm text-muted-foreground">Providers, agents, MCP servers, skills, prompts, workflows, and assignments.</p>
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
                    checked={importSections.processingPageSettings}
                    onCheckedChange={(checked) => handleToggleImportSection("processingPageSettings", checked === true)}
                  />
                  <div>
                    <p className="font-medium">Processing Page Settings</p>
                    <p className="text-sm text-muted-foreground">Pending wait-time and related processing page behavior settings.</p>
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
                <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
                  <Checkbox
                    checked={importSections.placeholders}
                    onCheckedChange={(checked) => handleToggleImportSection("placeholders", checked === true)}
                  />
                  <div>
                    <p className="font-medium">Placeholders</p>
                    <p className="text-sm text-muted-foreground">Static and dynamic parameter placeholder definitions.</p>
                  </div>
                </label>
                <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
                  <Checkbox
                    checked={importSections.oidcProviderSettings}
                    onCheckedChange={(checked) => handleToggleImportSection("oidcProviderSettings", checked === true)}
                  />
                  <div>
                    <p className="font-medium">OIDC Provider Clients</p>
                    <p className="text-sm text-muted-foreground">Client configuration and secrets. Signing keys and shared-issuer memberships are excluded.</p>
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
