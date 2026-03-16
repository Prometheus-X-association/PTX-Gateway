import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Loader2, Search, Globe, CheckCircle2, AlertCircle, Link2 } from "lucide-react";
import { Label } from "@/components/ui/label";

interface BasisInformation {
  ecosystem: string;
  name: string;
  description: string;
}

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
  parameters: Array<{ paramName: string; paramValue: string }>;
  api_response_representation: Record<string, unknown>;
  visualization_type: 'data_api' | 'upload_document' | 'manual_json_input' | null;
  upload_url: string | null;
  upload_authorization: string | null;
  result_url_source: 'contract' | 'fallback' | 'custom';
  custom_result_url: string | null;
  result_authorization: string | null;
}

interface ExtractedServiceChain {
  catalog_id: string;
  contract_url: string;
  status: string;
  basis_information: BasisInformation;
  services: unknown[];
  embedded_resources: EmbeddedResource[];
}

interface ContractExtractorProps {
  onResourcesExtracted: (
    resources: ExtractedResource[],
    serviceChains: ExtractedServiceChain[],
    contractUrls: string[]
  ) => void;
  isLoading: boolean;
  existingContractUrls: string[];
}

const ContractExtractor = ({ onResourcesExtracted, isLoading, existingContractUrls }: ContractExtractorProps) => {
  const [contractUrls, setContractUrls] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [extractedCount, setExtractedCount] = useState<{ software: number; data: number; chains: number } | null>(null);
  const [selectedExistingUrls, setSelectedExistingUrls] = useState<string[]>([]);

  // Unique contract URLs from existing resources
  const uniqueContractUrls = useMemo(() => {
    return [...new Set(existingContractUrls)].filter(url => url && url.trim().length > 0);
  }, [existingContractUrls]);

  const fetchJson = async (url: string): Promise<unknown> => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }
    return response.json();
  };

  const extractSingleContract = async (contractUrl: string): Promise<{ resources: ExtractedResource[]; serviceChains: ExtractedServiceChain[] }> => {
    const contractData = await fetchJson(contractUrl) as Record<string, unknown>;
    const resources: ExtractedResource[] = [];
    const serviceChains: ExtractedServiceChain[] = [];

    // Extract ecosystem info
    const ecosystemUrl = contractData.ecosystem as string;
    let basisInformation: BasisInformation = {
      ecosystem: ecosystemUrl || "",
      name: "",
      description: ""
    };

    if (ecosystemUrl) {
      try {
        const ecosystemData = await fetchJson(ecosystemUrl) as Record<string, unknown>;
        basisInformation.name = (ecosystemData.name as string) || "";
        basisInformation.description = (ecosystemData.description as string) || "";
      } catch (err) {
        console.warn("Could not fetch ecosystem:", err);
      }
    }

    // Extract service chains from root contract
    const contractServiceChains = (contractData.serviceChains || []) as Array<{ 
      catalogId?: string; 
      status?: string; 
      services?: Array<{ participant?: string; service?: string; params?: string; configuration?: string; pre?: string[] }> 
    }>;
    
    for (const chain of contractServiceChains) {
      if (chain.catalogId) {
        const embeddedResources: EmbeddedResource[] = [];
        
        // Extract resource details for each service in the chain
        const services = chain.services || [];
        for (let serviceIndex = 0; serviceIndex < services.length; serviceIndex++) {
          const service = services[serviceIndex];
          const serviceOfferingUrl = service.service;
          
          if (serviceOfferingUrl) {
            try {
              const serviceOfferingData = await fetchJson(serviceOfferingUrl) as Record<string, unknown>;
              const aggregationOf = (serviceOfferingData.aggregationOf || []) as string[];
              
              // Only take the first resource from aggregationOf for service chains
              const firstResourceUrl = aggregationOf[0];
              if (!firstResourceUrl) {
                console.warn("No resources in aggregationOf for service:", serviceOfferingUrl);
                continue;
              }

              // Get participant/provider name
              let providerName = "";
              const participantUrl = service.participant;
              if (participantUrl) {
                try {
                  const participantData = await fetchJson(participantUrl) as Record<string, unknown>;
                  providerName = (participantData.legalName as string) || "";
                } catch (err) {
                  console.warn("Could not fetch participant:", err);
                }
              }
              
              // Extract only the first resource in the service offering
              try {
                const resourceData = await fetchJson(firstResourceUrl) as Record<string, unknown>;
                
                const name = (resourceData.name as string) || "";
                const description = (resourceData.description as string) || "";
                const resourceType = (resourceData["@type"] as string) || "";
                
                let queryParams: Array<{ paramName: string; paramValue: string }> = [];
                const representation = resourceData.representation as Record<string, unknown> | undefined;
                if (representation && representation.queryParams) {
                  const params = representation.queryParams;
                  if (Array.isArray(params)) {
                    queryParams = params.map(p => ({ paramName: String(p), paramValue: "" }));
                  } else if (typeof params === 'string') {
                    queryParams = [{ paramName: params, paramValue: "" }];
                  }
                }
                
                const apiResponseRepresentation = resourceData.apiResponseRepresentation as Record<string, unknown> || {};
                
                // Check for upload requirement
                let uploadFile = false;
                let uploadUrl: string | null = null;
                
                const representationInput = representation?.input as Record<string, unknown> | undefined;
                const repInputDescription = (representationInput?.description as string) || "";
                if (repInputDescription.includes("#uploadDocument")) {
                  uploadFile = true;
                }
                if (!uploadFile) {
                  const apiRepInput = apiResponseRepresentation?.input as Record<string, unknown> | undefined;
                  const apiInputDescription = (apiRepInput?.description as string) || "";
                  if (apiInputDescription.includes("#uploadDocument")) {
                    uploadFile = true;
                  }
                }
                
                // Extract upload URL
                if (uploadFile) {
                  uploadUrl = (apiResponseRepresentation.url as string) || null;
                  if (!uploadUrl && representation) {
                    uploadUrl = (representation.url as string) || null;
                  }
                  if (!uploadUrl) {
                    const apiInput = apiResponseRepresentation.input as Record<string, unknown> | undefined;
                    uploadUrl = (apiInput?.url as string) || null;
                  }
                }
                
                // Classify by type
                const typeLower = resourceType.toLowerCase();
                const isSoftware = typeLower.includes("software") || typeLower.includes("service") || typeLower.includes("application");
                
                embeddedResources.push({
                  service_index: serviceIndex,
                  resource_type: isSoftware ? 'software' : 'data',
                  resource_url: firstResourceUrl,
                  contract_url: contractUrl,
                  resource_name: name,
                  resource_description: description,
                  provider: providerName,
                  service_offering: serviceOfferingUrl,
                  parameters: queryParams,
                  api_response_representation: apiResponseRepresentation,
                  visualization_type: uploadFile ? 'upload_document' : 'data_api',
                  upload_url: uploadUrl,
                  upload_authorization: null,
                  result_url_source: 'contract',
                  custom_result_url: null,
                  result_authorization: null,
                });
              } catch (err) {
                console.warn("Could not fetch resource in service chain:", firstResourceUrl, err);
              }
            } catch (err) {
              console.warn("Could not fetch service offering in chain:", serviceOfferingUrl, err);
            }
          }
        }
        
        serviceChains.push({
          catalog_id: chain.catalogId,
          contract_url: contractUrl,
          status: chain.status,
          basis_information: basisInformation,
          services: chain.services || [],
          embedded_resources: embeddedResources,
        });
      }
    }

    // Extract service offerings
    const serviceOfferings = (contractData.serviceOfferings || []) as { participant?: string; serviceOffering?: string }[];

    for (const offering of serviceOfferings) {
      const participantUrl = offering.participant;
      const serviceOfferingUrl = offering.serviceOffering || "";
      let providerName = "";

      if (participantUrl) {
        try {
          const participantData = await fetchJson(participantUrl) as Record<string, unknown>;
          providerName = (participantData.legalName as string) || "";
        } catch (err) {
          console.warn("Could not fetch participant:", err);
        }
      }

      if (serviceOfferingUrl) {
        try {
          const serviceOfferingData = await fetchJson(serviceOfferingUrl) as Record<string, unknown>;
          const aggregationOf = (serviceOfferingData.aggregationOf || []) as string[];

          for (const resourceUrl of aggregationOf) {
            try {
              const resourceData = await fetchJson(resourceUrl) as Record<string, unknown>;
              
              const name = (resourceData.name as string) || "";
              const description = (resourceData.description as string) || "";
              const resourceType = (resourceData["@type"] as string) || "";
              
              let queryParams: Array<{ paramName: string; paramValue: string }> = [];
              const representation = resourceData.representation as Record<string, unknown> | undefined;
              if (representation && representation.queryParams) {
                const params = representation.queryParams;
                if (Array.isArray(params)) {
                  queryParams = params.map(p => ({ paramName: String(p), paramValue: "" }));
                } else if (typeof params === 'string') {
                  queryParams = [{ paramName: params, paramValue: "" }];
                }
              }

              const apiResponseRepresentation = resourceData.apiResponseRepresentation as Record<string, unknown> || {};

              // Check for #uploadDocument tag and extract upload URL
              let uploadFile = false;
              let uploadUrl: string | null = null;
              
              const representationInput = representation?.input as Record<string, unknown> | undefined;
              const repInputDescription = (representationInput?.description as string) || "";
              if (repInputDescription.includes("#uploadDocument")) {
                uploadFile = true;
              }
              
              if (!uploadFile) {
                const apiRepInput = apiResponseRepresentation?.input as Record<string, unknown> | undefined;
                const apiInputDescription = (apiRepInput?.description as string) || "";
                if (apiInputDescription.includes("#uploadDocument")) {
                  uploadFile = true;
                }
              }

              // Extract upload URL from apiResponseRepresentation or representation
              if (uploadFile) {
                // Try apiResponseRepresentation.url first
                uploadUrl = (apiResponseRepresentation.url as string) || null;
                
                // Fallback to representation.url
                if (!uploadUrl && representation) {
                  uploadUrl = (representation.url as string) || null;
                }
                
                // Fallback to apiResponseRepresentation.input.url
                if (!uploadUrl) {
                  const apiInput = apiResponseRepresentation.input as Record<string, unknown> | undefined;
                  uploadUrl = (apiInput?.url as string) || null;
                }
              }

              // Classify by type
              const typeLower = resourceType.toLowerCase();
              const isSoftware = typeLower.includes("software") || typeLower.includes("service") || typeLower.includes("application");

              resources.push({
                resource_url: resourceUrl,
                contract_url: contractUrl,
                resource_type: isSoftware ? 'software' : 'data',
                resource_name: name,
                resource_description: description,
                provider: providerName,
                service_offering: serviceOfferingUrl,
                parameters: queryParams,
                api_response_representation: apiResponseRepresentation,
                upload_file: uploadFile,
                upload_url: uploadUrl,
              });
            } catch (err) {
              console.warn("Could not fetch resource:", resourceUrl, err);
            }
          }
        } catch (err) {
          console.warn("Could not fetch service offering:", err);
        }
      }
    }

    return { resources, serviceChains };
  };

  const handleExtract = async () => {
    // Combine new URLs and selected existing URLs
    const newUrls = contractUrls
      .split('\n')
      .map(url => url.trim())
      .filter(url => url.length > 0);
    
    const allUrls = [...new Set([...newUrls, ...selectedExistingUrls])];

    if (allUrls.length === 0) {
      setError("Please enter at least one contract URL or select from existing");
      return;
    }

    setExtracting(true);
    setError(null);
    setExtractedCount(null);

    try {
      const allResources: ExtractedResource[] = [];
      const allServiceChains: ExtractedServiceChain[] = [];

      for (let i = 0; i < allUrls.length; i++) {
        const url = allUrls[i];
        setLoadingStatus(`Processing contract ${i + 1} of ${allUrls.length}...`);
        
        try {
          const result = await extractSingleContract(url);
          allResources.push(...result.resources);
          allServiceChains.push(...result.serviceChains);
        } catch (err) {
          console.warn(`Failed to extract from ${url}:`, err);
        }
      }

      // Deduplicate resources by resource_url + contract_url
      const uniqueResources = allResources.filter(
        (item, index, self) => index === self.findIndex(
          r => r.resource_url === item.resource_url && r.contract_url === item.contract_url
        )
      );

      // Deduplicate service chains by catalog_id + contract_url
      const uniqueChains = allServiceChains.filter(
        (item, index, self) => index === self.findIndex(
          c => c.catalog_id === item.catalog_id && c.contract_url === item.contract_url
        )
      );

      const softwareCount = uniqueResources.filter(r => r.resource_type === 'software').length;
      const dataCount = uniqueResources.filter(r => r.resource_type === 'data').length;
      
      setExtractedCount({ software: softwareCount, data: dataCount, chains: uniqueChains.length });
      setLoadingStatus("");
      
      onResourcesExtracted(uniqueResources, uniqueChains, allUrls);
      toast.success(`Extracted ${uniqueResources.length} resources and ${uniqueChains.length} service chains from ${allUrls.length} contract(s)`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to extract contract data";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setExtracting(false);
    }
  };

  const toggleExistingUrl = (url: string) => {
    setSelectedExistingUrls(prev => 
      prev.includes(url) 
        ? prev.filter(u => u !== url)
        : [...prev, url]
    );
  };

  return (
    <div className="space-y-4">
      {/* Existing Contract URLs */}
      {uniqueContractUrls.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              Existing Contract URLs
            </CardTitle>
            <CardDescription className="text-xs">
              Select contract URLs to re-extract or add new ones below
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {uniqueContractUrls.map((url, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Checkbox
                    id={`contract-${index}`}
                    checked={selectedExistingUrls.includes(url)}
                    onCheckedChange={() => toggleExistingUrl(url)}
                    disabled={extracting || isLoading}
                  />
                  <Label 
                    htmlFor={`contract-${index}`}
                    className="text-xs font-mono truncate cursor-pointer flex-1"
                  >
                    {url}
                  </Label>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* New Contract URLs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Extract from Contract URLs
          </CardTitle>
          <CardDescription>
            Enter one or more contract URLs (one per line) to automatically extract and add resources
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={contractUrls}
            onChange={(e) => setContractUrls(e.target.value)}
            placeholder={"https://example.com/contract1.json\nhttps://example.com/contract2.json"}
            className="min-h-[100px] font-mono text-sm"
            disabled={extracting || isLoading}
          />

          <div className="flex items-center justify-between">
            <Button
              onClick={handleExtract}
              disabled={extracting || isLoading || (!contractUrls.trim() && selectedExistingUrls.length === 0)}
            >
              {extracting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Extracting...
                </>
              ) : (
                <>
                  <Search className="h-4 w-4 mr-2" />
                  Extract Resources
                </>
              )}
            </Button>

            {extractedCount && (
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-sm text-muted-foreground">
                  Found: 
                </span>
                <Badge variant="secondary">{extractedCount.software} software</Badge>
                <Badge variant="secondary">{extractedCount.data} data</Badge>
                <Badge variant="secondary">{extractedCount.chains} chains</Badge>
              </div>
            )}
          </div>

          {extracting && loadingStatus && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {loadingStatus}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
              <div>
                <p className="text-sm font-medium text-destructive">Extraction Failed</p>
                <p className="text-xs text-muted-foreground">{error}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ContractExtractor;
