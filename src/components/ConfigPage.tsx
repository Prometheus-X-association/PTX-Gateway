import { Settings, Database, Cpu, FileText, ToggleLeft, ToggleRight, Loader2 } from "lucide-react";
import { globalConfig } from "@/config/global.config";
import { useDataspaceConfig } from "@/hooks/useDataspaceConfig";

interface ConfigPageProps {
  onNext: () => void;
}

const ConfigPage = ({ onNext }: ConfigPageProps) => {
  const { pdcConfig, softwareResources, dataResources, serviceChains, isLoading } = useDataspaceConfig();

  return (
    <div className="animate-fade-in">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 mb-4">
          <Settings className="w-4 h-4 text-amber-500" />
          <span className="text-sm text-amber-500 font-medium">Debug Mode</span>
        </div>
        <h2 className="text-3xl font-bold mb-2">
          System <span className="gradient-text">Configuration</span>
        </h2>
        <p className="text-muted-foreground">
          Review current configuration settings before proceeding
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Global Config */}
        <div className="glass-card p-6">
          <h3 className="font-semibold flex items-center gap-2 mb-4">
            <Cpu className="w-5 h-5 text-primary" />
            Global Settings
          </h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-muted-foreground">App Name</span>
              <span className="font-medium">{globalConfig.app.name}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-muted-foreground">Version</span>
              <span className="font-mono text-primary">{globalConfig.app.version}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-muted-foreground">Environment</span>
              <span className="px-2 py-0.5 rounded bg-primary/20 text-primary text-xs">
                {globalConfig.app.environment}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-muted-foreground">Admin Mode</span>
              {globalConfig.admin.enabled ? (
                <ToggleRight className="w-5 h-5 text-green-500" />
              ) : (
                <ToggleLeft className="w-5 h-5 text-muted-foreground" />
              )}
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-muted-foreground">Debug Mode</span>
              {globalConfig.admin.debugMode ? (
                <ToggleRight className="w-5 h-5 text-amber-500" />
              ) : (
                <ToggleLeft className="w-5 h-5 text-muted-foreground" />
              )}
            </div>
          </div>
        </div>

        {/* Features Config */}
        <div className="glass-card p-6">
          <h3 className="font-semibold flex items-center gap-2 mb-4">
            <FileText className="w-5 h-5 text-primary" />
            Feature Flags
          </h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-muted-foreground">File Upload</span>
              {globalConfig.features.enableFileUpload ? (
                <span className="text-green-500">Enabled</span>
              ) : (
                <span className="text-red-500">Disabled</span>
              )}
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-muted-foreground">API Connections</span>
              {globalConfig.features.enableApiConnections ? (
                <span className="text-green-500">Enabled</span>
              ) : (
                <span className="text-red-500">Disabled</span>
              )}
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-muted-foreground">Text Input</span>
              {globalConfig.features.enableTextInput ? (
                <span className="text-green-500">Enabled</span>
              ) : (
                <span className="text-red-500">Disabled</span>
              )}
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-muted-foreground">Max File Size</span>
              <span className="font-mono">{globalConfig.features.maxFileSizeMB} MB</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-muted-foreground">Max Files</span>
              <span className="font-mono">{globalConfig.features.maxFilesCount}</span>
            </div>
          </div>
        </div>

        {/* PDC Configuration */}
        <div className="glass-card p-6">
          <h3 className="font-semibold flex items-center gap-2 mb-4">
            <Database className="w-5 h-5 text-primary" />
            PDC Connector
          </h3>
          <div className="space-y-2 text-sm">
            {isLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              </div>
            ) : (
              <>
                <div className="flex justify-between items-center py-2 border-b border-border/50">
                  <span className="text-muted-foreground">URL</span>
                  <span className="font-mono text-xs truncate max-w-[200px]">
                    {pdcConfig?.pdc_url || "Not configured"}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border/50">
                  <span className="text-muted-foreground">Bearer Token</span>
                  <span className="text-green-500 text-xs">Server-side managed</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Contract Data Summary */}
        <div className="glass-card p-6">
          <h3 className="font-semibold flex items-center gap-2 mb-4">
            <Cpu className="w-5 h-5 text-primary" />
            Contract Data
          </h3>
          <div className="space-y-2 text-sm">
            {isLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              </div>
            ) : (
              <>
                <div className="flex justify-between items-center py-2 border-b border-border/50">
                  <span className="text-muted-foreground">Software Resources</span>
                  <span className="font-mono">{softwareResources.length}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border/50">
                  <span className="text-muted-foreground">Data Resources</span>
                  <span className="font-mono">{dataResources.length}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-muted-foreground">Service Chains</span>
                  <span className="font-mono">{serviceChains.length}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={onNext}
          className="px-8 py-3 rounded-lg font-medium bg-primary text-primary-foreground hover:opacity-90 glow-effect transition-all duration-300"
        >
          Continue to Analytics Selection
        </button>
      </div>
    </div>
  );
};

export default ConfigPage;
