import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, Database, Code, FileUp, Eye, EyeOff, Search, Trash2, Settings, CheckSquare } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { VisualizationType } from "@/types/auth";
import { Json } from "@/integrations/supabase/types";
import ContractExtractor from "./ContractExtractor";
import ManualResourceForm, { ManualResourceData } from "./ManualResourceForm";
import ResourceDetailsModal from "./ResourceDetailsModal";
import ServiceChainDetailsModal from "./ServiceChainDetailsModal";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

interface ResourceParam {
  id: string;
  resource_url: string;
  contract_url: string;
  resource_type: 'software' | 'data' | 'service_chain';
  resource_name: string | null;
  resource_description: string | null;
  provider: string | null;
  llm_context: string | null;
  parameters: Array<{ paramName: string; paramValue: string; paramAction?: string }> | null;
  is_visible: boolean;
  visualization_type: VisualizationType;
  upload_file: boolean;
  // Upload configuration for visualization_type = 'upload_document'
  upload_url: string | null;
  upload_authorization: string | null;
  // API response representation from contract (contains URL info)
  api_response_representation: Record<string, unknown> | null;
  // Result URL configuration
  result_url_source: 'contract' | 'fallback' | 'custom';
  custom_result_url: string | null;
  result_authorization: string | null;
  result_query_params: Array<{ paramName: string; paramValue: string }>;
  visible_for_software_ids: string[];
}

const normalizeResourceParameters = (
  value: unknown
): Array<{ paramName: string; paramValue: string; paramAction?: string }> => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const obj = item as Record<string, unknown>;
      const paramName = typeof obj.paramName === 'string' ? obj.paramName : '';
      if (!paramName) return null;
      return {
        paramName,
        paramValue: typeof obj.paramValue === 'string' ? obj.paramValue : String(obj.paramValue ?? ''),
        paramAction: typeof obj.paramAction === 'string' ? obj.paramAction : undefined,
      };
    })
    .filter((p): p is { paramName: string; paramValue: string; paramAction?: string } => !!p);
};

interface ExtractedResource {
  resource_url: string;
  contract_url: string;
  resource_type: 'software' | 'data';
  resource_name: string;
  resource_description: string;
  provider: string;
  service_offering: string;
  parameters: Array<{ paramName: string; paramValue: string }>;
  api_response_representation: Record<string, unknown>;
  upload_file: boolean;
  upload_url: string | null;
}

interface EmbeddedResource {
  service_index: number;
  resource_type: 'software' | 'data';
  resource_url: string;
  contract_url: string;
  resource_name: string | null;
  resource_description: string | null;
  provider: string | null;
  service_offering: string | null;
  parameters: Array<{ paramName: string; paramValue: string; paramAction?: string }>;
  api_response_representation: Record<string, unknown>;
  visualization_type: VisualizationType | null;
  upload_url: string | null;
  upload_authorization: string | null;
  result_url_source: 'contract' | 'fallback' | 'custom';
  custom_result_url: string | null;
  result_authorization: string | null;
  result_query_params: Array<{ paramName: string; paramValue: string }>;
}

const normalizeEmbeddedResources = (value: unknown): EmbeddedResource[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const obj = item as Record<string, unknown>;
      const parameters = Array.isArray(obj.parameters)
        ? obj.parameters
            .map((p) => {
              if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
              const paramObj = p as Record<string, unknown>;
              return {
                paramName: String(paramObj.paramName ?? ''),
                paramValue: String(paramObj.paramValue ?? ''),
                paramAction: paramObj.paramAction ? String(paramObj.paramAction) : undefined,
              };
            })
            .filter((p): p is { paramName: string; paramValue: string; paramAction?: string } => !!p && !!p.paramName)
        : [];

      return {
        service_index: Number(obj.service_index ?? 0),
        resource_type: (String(obj.resource_type ?? 'data') as 'software' | 'data'),
        resource_url: String(obj.resource_url ?? ''),
        contract_url: String(obj.contract_url ?? ''),
        resource_name: obj.resource_name ? String(obj.resource_name) : null,
        resource_description: obj.resource_description ? String(obj.resource_description) : null,
        provider: obj.provider ? String(obj.provider) : null,
        service_offering: obj.service_offering ? String(obj.service_offering) : null,
        parameters,
        api_response_representation:
          obj.api_response_representation && typeof obj.api_response_representation === 'object' && !Array.isArray(obj.api_response_representation)
            ? (obj.api_response_representation as Record<string, unknown>)
            : {},
        visualization_type: obj.visualization_type ? (String(obj.visualization_type) as VisualizationType) : null,
        upload_url: obj.upload_url ? String(obj.upload_url) : null,
        upload_authorization: obj.upload_authorization ? String(obj.upload_authorization) : null,
        result_url_source: (String(obj.result_url_source ?? 'contract') as 'contract' | 'fallback' | 'custom'),
        custom_result_url: obj.custom_result_url ? String(obj.custom_result_url) : null,
        result_authorization: obj.result_authorization ? String(obj.result_authorization) : null,
        result_query_params: Array.isArray(obj.result_query_params)
          ? obj.result_query_params
              .map((p) => {
                if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
                const paramObj = p as Record<string, unknown>;
                const paramName = typeof paramObj.paramName === 'string' ? paramObj.paramName : '';
                if (!paramName) return null;
                return {
                  paramName,
                  paramValue: typeof paramObj.paramValue === 'string' ? paramObj.paramValue : String(paramObj.paramValue ?? ''),
                };
              })
              .filter((p): p is { paramName: string; paramValue: string } => !!p)
          : [],
      };
    })
    .filter((r): r is EmbeddedResource => !!r);
};

interface ExtractedServiceChain {
  catalog_id: string;
  contract_url: string;
  status: string;
  basis_information: {
    ecosystem: string;
    name: string;
    description: string;
  };
  services: unknown[];
  embedded_resources: EmbeddedResource[];
}

const getEmbeddedResourceSignature = (resource: Pick<EmbeddedResource, "service_index" | "resource_url" | "contract_url">): string =>
  `${resource.service_index}::${resource.resource_url}::${resource.contract_url}`;

interface ServiceChainData {
  id: string;
  catalog_id: string;
  contract_url: string;
  status: string | null;
  basis_information: Record<string, unknown> | null;
  llm_context?: string | null;
  services: Array<{ participant: string; service: string; params: string; configuration: string; pre: string[] }> | null;
  is_visible: boolean;
  visualization_type?: VisualizationType | null;
  embedded_resources: EmbeddedResource[];
  result_url_source?: string | null;
  custom_result_url?: string | null;
  result_authorization?: string | null;
  result_query_params?: Array<{ paramName: string; paramValue: string }> | null;
}

const VISUALIZATION_OPTIONS: { value: VisualizationType; label: string; icon: React.ReactNode }[] = [
  { value: 'data_api', label: 'Data API', icon: <Database className="h-4 w-4" /> },
  { value: 'upload_document', label: 'Upload Document', icon: <FileUp className="h-4 w-4" /> },
  { value: 'manual_json_input', label: 'Manual JSON Input', icon: <Code className="h-4 w-4" /> },
];

// PARAM_ACTION_OPTIONS moved to ResourceDetailsModal

const ResourcesConfigSection = () => {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [resources, setResources] = useState<ResourceParam[]>([]);
  const [serviceChains, setServiceChains] = useState<ServiceChainData[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [editingResource, setEditingResource] = useState<ResourceParam | null>(null);
  const [editingChain, setEditingChain] = useState<ServiceChainData | null>(null);
  const [activeTab, setActiveTab] = useState("extract");
  const [fallbackResultUrl, setFallbackResultUrl] = useState<string | null>(null);
  const [selectedSoftwareIds, setSelectedSoftwareIds] = useState<Set<string>>(new Set());
  const [selectedDataIds, setSelectedDataIds] = useState<Set<string>>(new Set());
  const [selectedChainIds, setSelectedChainIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  // Get all unique contract URLs from resources and service chains
  const existingContractUrls = useMemo(() => {
    const resourceUrls = resources.map(r => r.contract_url);
    const chainUrls = serviceChains.map(c => c.contract_url);
    return [...new Set([...resourceUrls, ...chainUrls])];
  }, [resources, serviceChains]);

  const fetchResources = async (options?: { silent?: boolean }) => {
    if (!user?.organization?.id) return;

    const silent = options?.silent ?? false;
    if (!silent) {
      setIsLoading(true);
    }
    try {
      // Fetch active PDC config to get fallback URL
      const { data: pdcData } = await supabase
        .from('dataspace_configs')
        .select('fallback_result_url')
        .eq('organization_id', user.organization.id)
        .eq('is_active', true)
        .maybeSingle();

      if (pdcData?.fallback_result_url) {
        setFallbackResultUrl(pdcData.fallback_result_url);
      }

      // Fetch resources from dataspace_params
      const { data: resourceData, error: resourceError } = await supabase
        .from('dataspace_params')
        .select('*')
        .eq('organization_id', user.organization.id);

      if (resourceError) throw resourceError;

      // Fetch service chains from service_chains table
      const { data: chainData, error: chainError } = await supabase
        .from('service_chains')
        .select('*')
        .eq('organization_id', user.organization.id);

      if (chainError) throw chainError;

      setResources((resourceData || []).map(r => ({
        ...r,
        parameters: normalizeResourceParameters(r.parameters),
        is_visible: r.is_visible ?? true,
        visualization_type: (r.visualization_type || 'data_api') as VisualizationType,
        upload_file: r.upload_file ?? false,
        upload_url: r.upload_url ?? null,
        upload_authorization: r.upload_authorization ?? null,
        api_response_representation: r.api_response_representation as Record<string, unknown> | null,
        result_url_source: (r as unknown as { result_url_source?: string }).result_url_source as 'contract' | 'fallback' | 'custom' ?? 'contract',
        custom_result_url: (r as unknown as { custom_result_url?: string }).custom_result_url ?? null,
        result_authorization: (r as unknown as { result_authorization?: string }).result_authorization ?? null,
        result_query_params: (r as unknown as { result_query_params?: Array<{ paramName: string; paramValue: string }> }).result_query_params ?? [],
        visible_for_software_ids: (r as unknown as { visible_for_software_ids?: string[] | null }).visible_for_software_ids ?? [],
        llm_context: (r as unknown as { llm_context?: string | null }).llm_context ?? null,
      })));

      setServiceChains((chainData || []).map(c => ({
        id: c.id,
        catalog_id: c.catalog_id,
        contract_url: c.contract_url,
        status: c.status,
        basis_information: c.basis_information as Record<string, unknown> | null,
        llm_context: (c as unknown as { llm_context?: string | null }).llm_context ?? null,
        services: (c.services as Array<{ participant: string; service: string; params: string; configuration: string; pre: string[] }>) || [],
        is_visible: c.is_visible ?? true,
        visualization_type: c.visualization_type as VisualizationType | null,
        embedded_resources: normalizeEmbeddedResources((c as unknown as { embedded_resources?: unknown }).embedded_resources),
        result_url_source: (c as unknown as { result_url_source?: string }).result_url_source ?? 'contract',
        custom_result_url: (c as unknown as { custom_result_url?: string }).custom_result_url ?? null,
        result_authorization: (c as unknown as { result_authorization?: string }).result_authorization ?? null,
        result_query_params: (c as unknown as { result_query_params?: Array<{ paramName: string; paramValue: string }> }).result_query_params ?? [],
      })));
    } catch (err) {
      toast.error("Failed to load resources");
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchResources();
  }, [user?.organization?.id]);

  const handleVisibilityToggle = async (resource: ResourceParam) => {
    // Optimistic update to prevent flickering
    const newVisibility = !resource.is_visible;
    setResources(prev => prev.map(r => 
      r.id === resource.id ? { ...r, is_visible: newVisibility } : r
    ));
    
    try {
      const { error } = await supabase
        .from('dataspace_params')
        .update({ is_visible: newVisibility })
        .eq('id', resource.id);

      if (error) {
        // Revert on error
        setResources(prev => prev.map(r => 
          r.id === resource.id ? { ...r, is_visible: !newVisibility } : r
        ));
        throw error;
      }
      
      toast.success(`Resource ${resource.is_visible ? 'hidden' : 'shown'}`);
    } catch (err) {
      toast.error("Failed to update visibility");
    }
  };

  const handleVisualizationChange = async (resource: ResourceParam, value: VisualizationType) => {
    try {
      const { error } = await supabase
        .from('dataspace_params')
        .update({ visualization_type: value })
        .eq('id', resource.id);

      if (error) throw error;
      
      toast.success("Visualization type updated");
      await fetchResources();
    } catch (err) {
      toast.error("Failed to update visualization type");
    }
  };

  const handleSaveResource = async (updatedResource: ResourceParam) => {
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('dataspace_params')
        .update({
          resource_name: updatedResource.resource_name,
          resource_description: updatedResource.resource_description,
          resource_url: updatedResource.resource_url,
          contract_url: updatedResource.contract_url,
          provider: updatedResource.provider,
          llm_context: updatedResource.llm_context,
          visualization_type: updatedResource.visualization_type,
          is_visible: updatedResource.is_visible,
          upload_file: updatedResource.upload_file,
          parameters: updatedResource.parameters as Json,
          upload_url: updatedResource.upload_url,
          upload_authorization: updatedResource.upload_authorization,
          result_url_source: updatedResource.result_url_source,
          custom_result_url: updatedResource.custom_result_url,
          result_authorization: updatedResource.result_authorization,
          result_query_params: updatedResource.result_query_params as unknown as Json,
          visible_for_software_ids: updatedResource.visible_for_software_ids,
        })
        .eq('id', updatedResource.id);

      if (error) throw error;
      
      toast.success("Resource saved successfully");
      setEditingResource(updatedResource);
      await fetchResources({ silent: true });
    } catch (err) {
      toast.error("Failed to save resource");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteResource = async (resource: ResourceParam) => {
    try {
      const { error } = await supabase
        .from('dataspace_params')
        .delete()
        .eq('id', resource.id);

      if (error) throw error;
      
      toast.success("Resource deleted");
      await fetchResources();
    } catch (err) {
      toast.error("Failed to delete resource");
    }
  };

  const handleResourcesExtracted = async (
    extractedResources: ExtractedResource[],
    extractedChains: ExtractedServiceChain[],
    extractedContractUrls: string[]
  ) => {
    if (!user?.organization?.id) {
      toast.error("No organization context found. Please refresh and try again.");
      return;
    }
    
    setIsSaving(true);
    try {
      // Get active config (use maybeSingle to handle new orgs with no config)
      const { data: configData } = await supabase
        .from('dataspace_configs')
        .select('id')
        .eq('organization_id', user.organization.id)
        .eq('is_active', true)
        .maybeSingle();

      let addedResources = 0;
      let updatedResources = 0;
      let addedChains = 0;
      let updatedChains = 0;
      let deletedChains = 0;

      const normalizedContractUrls = [...new Set(extractedContractUrls.map((url) => url.trim()).filter(Boolean))];
      if (normalizedContractUrls.length > 0) {
        const extractedChainKeys = new Set(
          extractedChains.map((chain) => `${chain.catalog_id}::${chain.contract_url}`)
        );

        const staleChains = serviceChains.filter(
          (chain) =>
            normalizedContractUrls.includes(chain.contract_url) &&
            !extractedChainKeys.has(`${chain.catalog_id}::${chain.contract_url}`)
        );

        if (staleChains.length > 0) {
          const staleIds = staleChains.map((chain) => chain.id);
          const { error: deleteChainsError } = await supabase
            .from('service_chains')
            .delete()
            .in('id', staleIds);

          if (deleteChainsError) throw deleteChainsError;
          deletedChains = staleChains.length;
        }
      }

      // Process resources - check for existing ones to update
      for (const r of extractedResources) {
        const existingResource = resources.find(
          er => er.resource_url === r.resource_url && er.contract_url === r.contract_url
        );

        if (existingResource) {
          // Merge parameters: keep existing manual values, add new params, remove deleted params
          const existingParams = existingResource.parameters || [];
          const extractedParams = r.parameters || [];
          
          // Build merged parameters
          const mergedParams = extractedParams.map(ep => {
            const existingParam = existingParams.find(p => p.paramName === ep.paramName);
            if (existingParam) {
              // Keep existing value and action if they were manually edited (non-empty)
              return {
                paramName: ep.paramName,
                paramValue: existingParam.paramValue || ep.paramValue,
                paramAction: existingParam.paramAction,
              };
            }
            // New parameter from extraction
            return { paramName: ep.paramName, paramValue: ep.paramValue };
          });

          // Update existing resource with new metadata but merged parameters
          // Only update upload_url if extracted and not already set
          const updateData: Record<string, unknown> = {
            resource_name: r.resource_name,
            resource_description: r.resource_description,
            provider: r.provider,
            service_offering: r.service_offering,
            api_response_representation: r.api_response_representation as Json,
            upload_file: r.upload_file,
            parameters: mergedParams as Json,
          };
          
          // Update upload_url if extraction provides one and existing is empty
          if (r.upload_url && !existingResource.upload_url) {
            updateData.upload_url = r.upload_url;
          }

          const { error } = await supabase
            .from('dataspace_params')
            .update(updateData)
            .eq('id', existingResource.id);

          if (error) throw error;
          updatedResources++;
        } else {
          // Insert new resource
          const { error } = await supabase
            .from('dataspace_params')
            .insert({
              organization_id: user.organization!.id,
              config_id: configData?.id || null,
              resource_url: r.resource_url,
              contract_url: r.contract_url,
              resource_type: r.resource_type as 'software' | 'data' | 'service_chain',
              resource_name: r.resource_name,
              resource_description: r.resource_description,
              provider: r.provider,
              service_offering: r.service_offering,
              parameters: r.parameters as Json,
              api_response_representation: r.api_response_representation as Json,
              upload_file: r.upload_file,
              visualization_type: (r.upload_file ? 'upload_document' : 'data_api') as 'upload_document' | 'manual_json_input' | 'data_api',
              is_visible: false,
              upload_url: r.upload_url,
            });

          if (error) throw error;
          addedResources++;
        }
      }

      // Process service chains
      for (const c of extractedChains) {
        const existingChain = serviceChains.find(
          ec => ec.catalog_id === c.catalog_id && ec.contract_url === c.contract_url
        );

        if (existingChain) {
          // Merge embedded resources: preserve existing edits only for resources that
          // still exist in the latest extraction. Resources missing from extraction are pruned.
          const existingEmbedded = existingChain.embedded_resources || [];
          const extractedEmbeddedSignatures = new Set(
            c.embedded_resources.map((resource) => getEmbeddedResourceSignature(resource))
          );
          const existingEmbeddedStillPresent = existingEmbedded.filter((resource) =>
            extractedEmbeddedSignatures.has(getEmbeddedResourceSignature(resource))
          );

          const mergedEmbedded = c.embedded_resources.map(er => {
            const existing = existingEmbeddedStillPresent.find(
              ee =>
                ee.service_index === er.service_index &&
                ee.resource_url === er.resource_url &&
                ee.contract_url === er.contract_url
            );
            if (existing) {
              // Merge parameters by key:
              // - keep existing value/action for unchanged keys
              // - add new extracted keys
              // - remove keys no longer present in extraction
              const existingParams = existing.parameters || [];
              const extractedParams = er.parameters || [];
              const mergedParams = extractedParams.map(ep => {
                const matched = existingParams.find(p => p.paramName === ep.paramName);
                if (!matched) {
                  return ep;
                }
                return {
                  paramName: ep.paramName,
                  paramValue: matched.paramValue || ep.paramValue,
                  paramAction: matched.paramAction,
                };
              });

              return {
                ...er,
                resource_name: existing.resource_name ?? er.resource_name,
                resource_description: existing.resource_description ?? er.resource_description,
                parameters: mergedParams,
                visualization_type: existing.visualization_type || er.visualization_type,
                upload_url: existing.upload_url || er.upload_url,
                upload_authorization: existing.upload_authorization,
                result_url_source: existing.result_url_source,
                custom_result_url: existing.custom_result_url,
                result_authorization: existing.result_authorization,
              };
            }
            return er;
          });

          // Update existing chain — preserve admin-edited name & description
          const existingBasis = (existingChain.basis_information || {}) as Record<string, unknown>;
          const mergedBasis = {
            ...c.basis_information,
            name: existingBasis.name || c.basis_information.name,
            description: existingBasis.description || c.basis_information.description,
          };

          const { error } = await supabase
            .from('service_chains')
            .update({
              status: c.status,
              basis_information: mergedBasis as Json,
              services: c.services as Json,
              embedded_resources: mergedEmbedded as unknown as Json,
            })
            .eq('id', existingChain.id);

          if (error) throw error;
          updatedChains++;
        } else {
          // Insert new chain
          const { error } = await supabase
            .from('service_chains')
            .insert({
              organization_id: user.organization!.id,
              config_id: configData?.id || null,
              catalog_id: c.catalog_id,
              contract_url: c.contract_url,
              status: c.status,
              basis_information: c.basis_information as Json,
              services: c.services as Json,
              embedded_resources: c.embedded_resources as unknown as Json,
              is_visible: false,
            });

          if (error) throw error;
          addedChains++;
        }
      }

      // Build result message
      const messages = [];
      if (addedResources > 0) messages.push(`${addedResources} resources added`);
      if (updatedResources > 0) messages.push(`${updatedResources} resources updated`);
      if (addedChains > 0) messages.push(`${addedChains} service chains added`);
      if (updatedChains > 0) messages.push(`${updatedChains} service chains updated`);
      if (deletedChains > 0) messages.push(`${deletedChains} service chains deleted`);

      if (messages.length === 0) {
        toast.info("No changes detected");
      } else {
        toast.success(messages.join(', '));
      }

      await fetchResources();
      setActiveTab("software");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      console.error("Failed to save extracted resources:", errorMsg, err);
      toast.error(`Failed to save extracted resources: ${errorMsg}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleManualResourceAdd = async (resourceData: ManualResourceData) => {
    if (!user?.organization?.id) return;

    setIsSaving(true);
    try {
      // Get active config (use maybeSingle to handle new orgs with no config)
      const { data: configData } = await supabase
        .from('dataspace_configs')
        .select('id')
        .eq('organization_id', user.organization.id)
        .eq('is_active', true)
        .maybeSingle();

      const { error } = await supabase
        .from('dataspace_params')
        .insert({
          organization_id: user.organization.id,
          config_id: configData?.id || null,
          resource_url: resourceData.resource_url,
          contract_url: resourceData.contract_url,
          resource_type: resourceData.resource_type,
          resource_name: resourceData.resource_name,
          resource_description: resourceData.resource_description,
          provider: resourceData.provider,
          service_offering: resourceData.service_offering,
          parameters: resourceData.parameters,
          visualization_type: resourceData.visualization_type,
          upload_file: resourceData.upload_file,
          is_visible: resourceData.is_visible,
        });

      if (error) throw error;

      toast.success("Resource added successfully");
      await fetchResources();
      setActiveTab(resourceData.resource_type === 'software' ? 'software' : 'data');
    } catch (err) {
      console.error(err);
      toast.error("Failed to add resource");
    } finally {
      setIsSaving(false);
    }
  };

  const filteredResources = (type: 'software' | 'data') => {
    return resources
      .filter(r => r.resource_type === type)
      .filter(r => 
        !searchTerm ||
        r.resource_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.provider?.toLowerCase().includes(searchTerm.toLowerCase())
      );
  };

  const filteredChains = serviceChains.filter(c => {
    if (!searchTerm) return true;
    const basisName = (c.basis_information as { name?: string } | null)?.name || '';
    return basisName.toLowerCase().includes(searchTerm.toLowerCase()) ||
           c.catalog_id.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const resourceModalData = useMemo(() => (
    editingResource ? {
      ...editingResource,
      fallback_result_url: fallbackResultUrl,
    } : null
  ), [editingResource, fallbackResultUrl]);

  const chainModalData = useMemo(() => (
    editingChain ? {
      ...editingChain,
      fallback_result_url: fallbackResultUrl,
    } : null
  ), [editingChain, fallbackResultUrl]);

  const softwareOptions = useMemo(
    () =>
      resources
        .filter((r) => r.resource_type === "software")
        .map((r) => ({
          id: r.id,
          name: r.resource_name || r.resource_url,
        })),
    [resources]
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  // Resource table for software (no visualization column)
  const SoftwareTable = ({ items }: { items: ResourceParam[] }) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              checked={items.length > 0 && selectedSoftwareIds.size === items.length}
              onCheckedChange={() => toggleAll(items, selectedSoftwareIds, setSelectedSoftwareIds)}
            />
          </TableHead>
          <TableHead className="w-12">Visible</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Provider</TableHead>
          <TableHead className="w-24">Settings</TableHead>
          <TableHead className="w-12">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
              No software resources found. Use "Extract from Contract" or "Add Resource Manually" to add resources.
            </TableCell>
          </TableRow>
        ) : (
          items.map((resource) => (
            <TableRow key={resource.id}>
              <TableCell>
                <Checkbox
                  checked={selectedSoftwareIds.has(resource.id)}
                  onCheckedChange={() => toggleSelection(resource.id, selectedSoftwareIds, setSelectedSoftwareIds)}
                />
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleVisibilityToggle(resource)}
                >
                  {resource.is_visible ? (
                    <Eye className="h-4 w-4 text-primary" />
                  ) : (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </TableCell>
              <TableCell>
                <div>
                  <p className="font-medium">{resource.resource_name || 'Unnamed'}</p>
                  <p className="text-xs text-muted-foreground truncate max-w-xs">
                    {resource.resource_description?.slice(0, 60)}...
                  </p>
                </div>
              </TableCell>
              <TableCell>{resource.provider || '-'}</TableCell>
              <TableCell>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingResource(resource)}
                >
                  <Settings className="h-4 w-4 mr-1" />
                  Details
                </Button>
              </TableCell>
              <TableCell>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Resource</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete "{resource.resource_name}"? This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleDeleteResource(resource)}>
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );

  // Data resource table (with visualization column)
  const DataTable = ({ items }: { items: ResourceParam[] }) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              checked={items.length > 0 && selectedDataIds.size === items.length}
              onCheckedChange={() => toggleAll(items, selectedDataIds, setSelectedDataIds)}
            />
          </TableHead>
          <TableHead className="w-12">Visible</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Provider</TableHead>
          <TableHead>Visualization</TableHead>
          <TableHead className="w-24">Settings</TableHead>
          <TableHead className="w-12">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.length === 0 ? (
          <TableRow>
            <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
              No data resources found. Use "Extract from Contract" or "Add Resource Manually" to add resources.
            </TableCell>
          </TableRow>
        ) : (
          items.map((resource) => (
            <TableRow key={resource.id}>
              <TableCell>
                <Checkbox
                  checked={selectedDataIds.has(resource.id)}
                  onCheckedChange={() => toggleSelection(resource.id, selectedDataIds, setSelectedDataIds)}
                />
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleVisibilityToggle(resource)}
                >
                  {resource.is_visible ? (
                    <Eye className="h-4 w-4 text-primary" />
                  ) : (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </TableCell>
              <TableCell>
                <div>
                  <p className="font-medium">{resource.resource_name || 'Unnamed'}</p>
                  <p className="text-xs text-muted-foreground truncate max-w-xs">
                    {resource.resource_description?.slice(0, 60)}...
                  </p>
                </div>
              </TableCell>
              <TableCell>{resource.provider || '-'}</TableCell>
              <TableCell>
                <Select
                  value={resource.visualization_type}
                  onValueChange={(v) => handleVisualizationChange(resource, v as VisualizationType)}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VISUALIZATION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <div className="flex items-center gap-2">
                          {opt.icon}
                          {opt.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingResource(resource)}
                >
                  <Settings className="h-4 w-4 mr-1" />
                  Details
                </Button>
              </TableCell>
              <TableCell>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Resource</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete "{resource.resource_name}"? This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleDeleteResource(resource)}>
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );

  // Service chain table (no visualization, no params)
  const handleChainVisibilityToggle = async (chain: ServiceChainData) => {
    // Optimistic update to prevent flickering
    const newVisibility = !chain.is_visible;
    setServiceChains(prev => prev.map(c => 
      c.id === chain.id ? { ...c, is_visible: newVisibility } : c
    ));
    
    try {
      const { error } = await supabase
        .from('service_chains')
        .update({ is_visible: newVisibility })
        .eq('id', chain.id);

      if (error) {
        // Revert on error
        setServiceChains(prev => prev.map(c => 
          c.id === chain.id ? { ...c, is_visible: !newVisibility } : c
        ));
        throw error;
      }
      
      toast.success(`Service chain ${chain.is_visible ? 'hidden' : 'shown'}`);
    } catch (err) {
      toast.error("Failed to update visibility");
    }
  };

  const handleDeleteChain = async (chain: ServiceChainData) => {
    try {
      const { error } = await supabase
        .from('service_chains')
        .delete()
        .eq('id', chain.id);

      if (error) throw error;
      
      toast.success("Service chain deleted");
      await fetchResources();
    } catch (err) {
      toast.error("Failed to delete service chain");
    }
  };

  const handleBulkDeleteResources = async (ids: Set<string>, type: 'software' | 'data') => {
    if (ids.size === 0) return;
    setIsBulkDeleting(true);
    try {
      const { error } = await supabase
        .from('dataspace_params')
        .delete()
        .in('id', Array.from(ids));
      if (error) throw error;
      toast.success(`${ids.size} ${type} resource(s) deleted`);
      if (type === 'software') setSelectedSoftwareIds(new Set());
      else setSelectedDataIds(new Set());
      await fetchResources();
    } catch (err) {
      toast.error("Failed to delete resources");
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleBulkDeleteChains = async (ids: Set<string>) => {
    if (ids.size === 0) return;
    setIsBulkDeleting(true);
    try {
      const { error } = await supabase
        .from('service_chains')
        .delete()
        .in('id', Array.from(ids));
      if (error) throw error;
      toast.success(`${ids.size} service chain(s) deleted`);
      setSelectedChainIds(new Set());
      await fetchResources();
    } catch (err) {
      toast.error("Failed to delete service chains");
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const toggleSelection = (id: string, selected: Set<string>, setSelected: React.Dispatch<React.SetStateAction<Set<string>>>) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const toggleAll = (items: { id: string }[], selected: Set<string>, setSelected: React.Dispatch<React.SetStateAction<Set<string>>>) => {
    if (selected.size === items.length && items.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map(i => i.id)));
    }
  };


  const handleSaveChain = async (updatedChain: ServiceChainData) => {
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('service_chains')
        .update({
          basis_information: updatedChain.basis_information as Json,
          llm_context: updatedChain.llm_context || null,
          is_visible: updatedChain.is_visible,
          visualization_type: updatedChain.visualization_type,
          embedded_resources: updatedChain.embedded_resources as unknown as Json,
          result_url_source: updatedChain.result_url_source || 'contract',
          custom_result_url: updatedChain.custom_result_url || null,
          result_authorization: updatedChain.result_authorization || null,
          result_query_params: (updatedChain.result_query_params || []) as unknown as Json,
        })
        .eq('id', updatedChain.id);

      if (error) throw error;
      
      toast.success("Service chain saved successfully");
      setEditingChain(updatedChain);
      await fetchResources({ silent: true });
    } catch (err) {
      toast.error("Failed to save service chain");
    } finally {
      setIsSaving(false);
    }
  };

  const ServiceChainTable = ({ items }: { items: ServiceChainData[] }) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              checked={items.length > 0 && selectedChainIds.size === items.length}
              onCheckedChange={() => toggleAll(items, selectedChainIds, setSelectedChainIds)}
            />
          </TableHead>
          <TableHead className="w-12">Visible</TableHead>
          <TableHead>Catalog ID</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Resources</TableHead>
          <TableHead className="w-24">Settings</TableHead>
          <TableHead className="w-12">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.length === 0 ? (
          <TableRow>
            <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
              No service chains found. Use "Extract from Contract" to add service chains.
            </TableCell>
          </TableRow>
        ) : (
          items.map((chain) => {
            const basisInfo = chain.basis_information as { name?: string; description?: string } | null;
            return (
              <TableRow key={chain.id}>
                <TableCell>
                  <Checkbox
                    checked={selectedChainIds.has(chain.id)}
                    onCheckedChange={() => toggleSelection(chain.id, selectedChainIds, setSelectedChainIds)}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleChainVisibilityToggle(chain)}
                  >
                    {chain.is_visible ? (
                      <Eye className="h-4 w-4 text-primary" />
                    ) : (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </TableCell>
                <TableCell>
                  <p className="font-mono text-sm">{chain.catalog_id}</p>
                </TableCell>
                <TableCell>
                  <div>
                    <p className="font-medium">{basisInfo?.name || 'Unnamed'}</p>
                    <p className="text-xs text-muted-foreground truncate max-w-xs">
                      {basisInfo?.description?.slice(0, 60)}...
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={chain.status === 'active' ? 'default' : 'secondary'}>
                    {chain.status || 'unknown'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Badge variant="outline" className="text-xs">
                      {chain.embedded_resources.length} resources
                    </Badge>
                  </div>
                </TableCell>
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingChain(chain)}
                  >
                    <Settings className="h-4 w-4 mr-1" />
                    Details
                  </Button>
                </TableCell>
                <TableCell>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Service Chain</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete this service chain? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDeleteChain(chain)}>
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Resources Configuration
              </CardTitle>
              <CardDescription>
                Add resources from contract URLs or manually, then manage visibility and parameters
              </CardDescription>
            </div>
            <ManualResourceForm onSubmit={handleManualResourceAdd} isLoading={isSaving} />
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="extract">
                Extract from Contract
              </TabsTrigger>
              <TabsTrigger value="software">
                Software ({filteredResources('software').length})
              </TabsTrigger>
              <TabsTrigger value="data">
                Data ({filteredResources('data').length})
              </TabsTrigger>
              <TabsTrigger value="chains">
                Service Chains ({filteredChains.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="extract" className="mt-4">
              <ContractExtractor 
                onResourcesExtracted={handleResourcesExtracted} 
                isLoading={isSaving}
                existingContractUrls={existingContractUrls}
              />
            </TabsContent>

            <TabsContent value="software" className="mt-4">
              <div className="mb-4 flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search software resources..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>
                {selectedSoftwareIds.size > 0 && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="sm" disabled={isBulkDeleting}>
                        {isBulkDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
                        Delete Selected ({selectedSoftwareIds.size})
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {selectedSoftwareIds.size} Software Resource(s)</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete {selectedSoftwareIds.size} selected software resource(s)? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleBulkDeleteResources(selectedSoftwareIds, 'software')}>
                          Delete All
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
              <SoftwareTable items={filteredResources('software')} />
            </TabsContent>

            <TabsContent value="data" className="mt-4">
              <div className="mb-4 flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search data resources..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>
                {selectedDataIds.size > 0 && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="sm" disabled={isBulkDeleting}>
                        {isBulkDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
                        Delete Selected ({selectedDataIds.size})
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {selectedDataIds.size} Data Resource(s)</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete {selectedDataIds.size} selected data resource(s)? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleBulkDeleteResources(selectedDataIds, 'data')}>
                          Delete All
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
              <DataTable items={filteredResources('data')} />
            </TabsContent>

            <TabsContent value="chains" className="mt-4">
              <div className="mb-4 flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search service chains..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>
                {selectedChainIds.size > 0 && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="sm" disabled={isBulkDeleting}>
                        {isBulkDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
                        Delete Selected ({selectedChainIds.size})
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {selectedChainIds.size} Service Chain(s)</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete {selectedChainIds.size} selected service chain(s)? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleBulkDeleteChains(selectedChainIds)}>
                          Delete All
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
              <ServiceChainTable items={filteredChains} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Resource Details Modal */}
      <ResourceDetailsModal
        resource={resourceModalData}
        softwareOptions={softwareOptions}
        open={!!editingResource}
        onOpenChange={(open) => {
          if (!open) setEditingResource(null);
        }}
        onSave={handleSaveResource}
        isSaving={isSaving}
      />

      {/* Service Chain Details Modal */}
      <ServiceChainDetailsModal
        chain={chainModalData}
        open={!!editingChain}
        onOpenChange={(open) => {
          if (!open) setEditingChain(null);
        }}
        onSave={handleSaveChain}
        isSaving={isSaving}
      />
    </div>
  );
};

export default ResourcesConfigSection;
