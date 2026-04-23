import { useState, useRef, useEffect, useCallback } from "react";
import { Cloud, FileText, X, Settings, Upload, Loader2, CheckCircle, AlertCircle, Eye, Download } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import { useProcessSession } from "@/contexts/ProcessSessionContext";
import { getParamActionsMap } from "@/types/dataspace";
import { sanitizeParams } from "@/utils/paramSanitizer";

interface DocumentUploadZoneProps {
  resource: {
    id: string;
    name: string;
    provider: string;
    description: string;
    queryParams: string[];
    contract?: string; // Contract URL for prefill lookup
    // Upload configuration from database
    uploadUrl?: string | null;
    uploadAuthorization?: string | null;
    // Parameters with actions for filtering
    parameters?: Array<{ paramName: string; paramValue: string; paramAction?: string }>;
  };
  files: File[];
  onFilesChange: (files: File[]) => void;
  onUploadConfigChange: (config: UploadConfig) => void;
  // Synchronized params from selection element
  paramValues: Record<string, string>;
  onParamValuesChange: (params: Record<string, string>) => void;
  // Callbacks for upload status
  onUploadSuccess?: () => void;
  onUploadReset?: () => void;
  isDebugMode?: boolean;
}

export interface UploadConfig {
  uploadUrl: string;
  queryParams: Record<string, string>;
  authorization: string;
}

type UploadStatus = "idle" | "uploading" | "success" | "error";
type FilePreviewKind = "pdf" | "image" | "text" | "download";

interface FilePreviewState {
  file: File;
  kind: FilePreviewKind;
  url: string;
  text: string;
}

const acceptedFileTypes = ".txt,.json,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv";

const getFilePreviewKind = (file: File): FilePreviewKind => {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();

  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name)) return "image";
  if (
    type.startsWith("text/") ||
    type === "application/json" ||
    /\.(txt|csv|json|md|xml|html)$/i.test(name)
  ) {
    return "text";
  }
  return "download";
};

const DocumentUploadZone = ({ 
  resource, 
  files, 
  onFilesChange,
  onUploadConfigChange,
  paramValues,
  onParamValuesChange,
  onUploadSuccess,
  onUploadReset,
  isDebugMode = false
}: DocumentUploadZoneProps) => {
  const { sessionId } = useProcessSession();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Upload configuration state (only URL and auth - params are synced from parent)
  const [uploadUrl, setUploadUrl] = useState<string>("");
  const [authorization, setAuthorization] = useState("");
  const [isPrefilled, setIsPrefilled] = useState(false);
  
  // Config modal state
  const [showConfigModal, setShowConfigModal] = useState(false);
  
  // Upload status state
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string>("");
  const [uploadResponse, setUploadResponse] = useState<string>("");
  const [preview, setPreview] = useState<FilePreviewState | null>(null);

  // Prefill upload config from resource (database) on mount
  useEffect(() => {
    if (resource.uploadUrl) {
      setUploadUrl(resource.uploadUrl);
      setAuthorization(resource.uploadAuthorization || "");
      setIsPrefilled(true);
    }
  }, [resource.uploadUrl, resource.uploadAuthorization]);

  // Memoized callback for parent updates
  const stableOnUploadConfigChange = useCallback(onUploadConfigChange, [onUploadConfigChange]);

  // Update parent when config changes
  useEffect(() => {
    stableOnUploadConfigChange({
      uploadUrl,
      queryParams: paramValues,
      authorization,
    });
  }, [uploadUrl, paramValues, authorization, stableOnUploadConfigChange]);

  useEffect(() => {
    return () => {
      if (preview?.url) {
        URL.revokeObjectURL(preview.url);
      }
    };
  }, [preview?.url]);

  // Check if upload is ready
  const isUploadReady = uploadUrl && files.length > 0;

  // Upload function - uses edge function proxy to bypass CORS
  const handleUpload = async () => {
    if (!uploadUrl) {
      toast({
        title: "Configuration Required",
        description: "Please configure the upload URL first.",
        variant: "destructive",
      });
      return;
    }

    if (files.length === 0) {
      toast({
        title: "No Files Selected",
        description: "Please select files to upload.",
        variant: "destructive",
      });
      return;
    }

    setUploadStatus("uploading");
    setUploadProgress(0);
    setUploadError("");
    setUploadResponse("");

    try {
      const formData = new FormData();
      
      // Add all files under "files" key
      files.forEach((file) => {
        formData.append("files", file, file.name);
      });

      // Get paramActions for this resource to filter #ignoreFlowData
      const resourceParamActions: Record<string, string | undefined> = {};
      if (resource.parameters) {
        resource.parameters.forEach(p => {
          resourceParamActions[p.paramName] = p.paramAction;
        });
      }

      // Sanitize params - filter out #ignoreFlowData params
      const sanitizedParams = sanitizeParams(
        paramValues, 
        sessionId,
        true,
        "flowData", // Use flowData context to filter #ignoreFlowData
        resourceParamActions
      );

      // Add sanitized query params as form-data fields
      Object.entries(sanitizedParams).forEach(([key, value]) => {
        if (value) {
          formData.append(key, value);
        }
      });

      // Simulate progress for UX (since fetch doesn't provide progress)
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      // Use edge function proxy to bypass CORS
      const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-proxy`;
      
      const response = await fetch(proxyUrl, {
        method: "POST",
        headers: {
          "x-upload-url": uploadUrl,
          "x-upload-authorization": authorization || "",
        },
        body: formData,
      });

      clearInterval(progressInterval);

      // Edge/Kong errors can return non-uniform payloads; parse defensively.
      const responseText = await response.text();
      let result: Record<string, unknown> = {};
      try {
        result = responseText ? JSON.parse(responseText) : {};
      } catch {
        result = { raw: responseText };
      }

      const upstreamStatus = typeof result.status === "number" ? result.status : undefined;

      if (response.ok && upstreamStatus !== undefined && upstreamStatus >= 200 && upstreamStatus < 300) {
        setUploadProgress(100);
        setUploadStatus("success");
        setUploadResponse(
          typeof result.body === "string" ? result.body : JSON.stringify(result.body ?? result)
        );
        console.log("Upload successful:", result);
        onUploadSuccess?.();
        if (isDebugMode) {
          toast({
            title: "Upload Successful",
            description: `${files.length} file(s) uploaded successfully.`,
          });
        }
      } else {
        const parts: string[] = [];
        const primaryError =
          (typeof result.error === "string" && result.error) ||
          (typeof result.message === "string" && result.message) ||
          (typeof result.details === "string" && result.details) ||
          (typeof result.body === "string" && result.body) ||
          "";

        if (primaryError) parts.push(primaryError);
        if (response.status) parts.push(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`);
        if (upstreamStatus !== undefined) {
          const upstreamStatusText = typeof result.statusText === "string" ? result.statusText : "";
          parts.push(`Upstream ${upstreamStatus}${upstreamStatusText ? ` ${upstreamStatusText}` : ""}`);
        }

        const errorMsg = parts.join(" | ") || "Upload failed: unknown proxy error";
        throw new Error(errorMsg);
      }
    } catch (error) {
      setUploadStatus("error");
      const errorMessage = error instanceof Error ? error.message : "Upload failed";
      setUploadError(errorMessage);
      console.error("Upload error:", error);
      toast({
        title: "Upload Failed",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  // Track previous files count to detect actual file changes
  const prevFilesCountRef = useRef(files.length);
  
  // Reset upload status only when files are actually added/removed (not on every render)
  useEffect(() => {
    const filesChanged = prevFilesCountRef.current !== files.length;
    prevFilesCountRef.current = files.length;
    
    if (filesChanged && uploadStatus !== "idle") {
      setUploadStatus("idle");
      setUploadProgress(0);
      setUploadError("");
      setUploadResponse("");
      setPreview((current) => {
        if (current?.url) URL.revokeObjectURL(current.url);
        return null;
      });
      onUploadReset?.();
    }
  }, [files.length, uploadStatus, onUploadReset]);

  // File handling
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    onFilesChange([...files, ...droppedFiles]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      onFilesChange([...files, ...selectedFiles]);
      // Allow re-selecting the same file(s) to trigger onChange again.
      e.target.value = "";
    }
  };

  const removeFile = (index: number) => {
    onFilesChange(files.filter((_, i) => i !== index));
    // Keep file input clear so the same file can be chosen again.
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleParamChange = (paramName: string, value: string) => {
    onParamValuesChange({
      ...paramValues,
      [paramName]: value,
    });
  };

  const openFilePreview = async (file: File) => {
    const kind = getFilePreviewKind(file);
    const url = URL.createObjectURL(file);
    const text = kind === "text" ? await file.text() : "";

    setPreview((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return { file, kind, url, text };
    });
  };

  const closeFilePreview = () => {
    setPreview((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
  };

  const downloadFile = (file: File, url?: string) => {
    const href = url || URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = file.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    if (!url) URL.revokeObjectURL(href);
  };

  const hasParams = resource.queryParams.length > 0;

  return (
      <div className="animate-fade-in space-y-4">
      {/* Configuration Status */}
      {isDebugMode && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            {uploadUrl ? (
              <>
                <div className="w-2 h-2 rounded-full bg-primary" />
                <span className="text-muted-foreground truncate max-w-[200px]">
                  Upload endpoint configured
                  {isPrefilled && (
                    <span className="ml-1 text-xs text-primary">(prefilled)</span>
                  )}
                </span>
              </>
            ) : (
              <>
                <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                <span className="text-muted-foreground">No upload URL configured</span>
              </>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowConfigModal(true)}
            className="gap-2"
          >
            <Settings className="w-4 h-4" />
            Configure
          </Button>
        </div>
      )}

      {/* Drop Zone */}
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`upload-zone cursor-pointer ${isDragging ? "dragging" : ""}`}
      >
        <Cloud className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
        <p className="text-foreground font-medium mb-1">
          Drop files here or click to browse
        </p>
        <p className="text-sm text-muted-foreground">
          TXT, JSON, PDF, DOC, DOCX, PPT, XLS, XLSX, CSV supported
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
          accept={acceptedFileTypes}
        />
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div className="space-y-2 max-h-[200px] overflow-y-auto">
          {files.map((file, index) => (
            <div
              key={index}
              className="glass-card p-3 flex items-center justify-between gap-3 animate-scale-in"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <FileText className="w-5 h-5 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                  <p className="text-sm font-medium truncate max-w-[40%]">
                    {file.name}
                  </p>
                  {!isDebugMode && uploadStatus === "uploading" && (
                    <div className="flex min-w-[120px] flex-1 items-center gap-2">
                      <Progress value={uploadProgress} className="h-2" />
                      <span className="text-xs text-muted-foreground w-9 text-right">{uploadProgress}%</span>
                    </div>
                  )}
                  {!isDebugMode && uploadStatus === "success" && (
                    <div className="flex min-w-[120px] flex-1 items-center gap-2">
                      <Progress value={100} className="h-2" />
                      <span className="text-xs text-primary font-medium">Ready</span>
                    </div>
                  )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              </div>
              {!isDebugMode && uploadStatus === "success" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    void openFilePreview(file);
                  }}
                  className="gap-2 shrink-0"
                >
                  <Eye className="w-4 h-4" />
                  View
                </Button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(index);
                }}
                className="p-1 hover:bg-destructive/20 rounded transition-colors"
              >
                <X className="w-4 h-4 text-destructive" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Upload Status & Button */}
      {files.length > 0 && (
        <div className="space-y-3">
          {/* Progress Bar */}
          {isDebugMode && uploadStatus === "uploading" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Uploading...</span>
                <span className="text-muted-foreground">{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} className="h-2" />
            </div>
          )}

          {/* Success Message with Response */}
          {isDebugMode && uploadStatus === "success" && (
            <div className="space-y-2 p-3 rounded-lg bg-primary/10 border border-primary/20">
              <div className="flex items-center gap-2 text-sm text-primary font-medium">
                <CheckCircle className="w-4 h-4" />
                <span>Files uploaded successfully!</span>
              </div>
              {uploadResponse && (
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground mb-1">Server Response:</p>
                  <pre className="text-xs bg-background/50 p-2 rounded overflow-x-auto max-h-[150px] overflow-y-auto whitespace-pre-wrap break-all">
                    {uploadResponse}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Error Message */}
          {uploadStatus === "error" && (
            <div className="space-y-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <div className="flex items-center gap-2 text-sm text-destructive font-medium">
                <AlertCircle className="w-4 h-4" />
                <span>Upload Failed</span>
              </div>
              <p className="text-xs text-destructive/80 break-all">{uploadError}</p>
            </div>
          )}

          {/* Upload Button */}
          <Button
            onClick={handleUpload}
            disabled={!isUploadReady || uploadStatus === "uploading"}
            className="w-full gap-2"
          >
            {uploadStatus === "uploading" ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                {isDebugMode ? "Upload" : "Convert"} {files.length} File{files.length > 1 ? "s" : ""}
              </>
            )}
          </Button>

          {/* Configuration warning */}
          {isDebugMode && !uploadUrl && (
            <p className="text-xs text-muted-foreground text-center">
              Configure upload endpoint to enable upload
            </p>
          )}
        </div>
      )}

      {/* Configuration Modal */}
      {isDebugMode && showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div 
            className="absolute inset-0 bg-background/80 backdrop-blur-sm" 
            onClick={() => setShowConfigModal(false)}
          />
          <div className="relative z-10 w-full max-w-lg mx-4 bg-card border border-border rounded-lg p-6 shadow-lg animate-scale-in max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold">Upload Configuration</h3>
              <button
                onClick={() => setShowConfigModal(false)}
                className="p-1 hover:bg-accent rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="space-y-4">
              {/* Upload URL */}
              <div className="space-y-2">
                <Label htmlFor="uploadUrl" className="text-sm font-medium">
                  Upload URL
                </Label>
                <Input
                  id="uploadUrl"
                  value={uploadUrl}
                  onChange={(e) => setUploadUrl(e.target.value)}
                  placeholder="https://api.example.com/upload"
                  className="bg-background/50"
                />
                <p className="text-xs text-muted-foreground">
                  Endpoint where files will be uploaded
                </p>
              </div>

              {/* Authorization */}
              <div className="space-y-2">
                <Label htmlFor="authorization" className="text-sm font-medium">
                  Authorization
                </Label>
                <Input
                  id="authorization"
                  value={authorization}
                  onChange={(e) => setAuthorization(e.target.value)}
                  placeholder="Bearer token or API key"
                  className="bg-background/50"
                  type="password"
                />
                <p className="text-xs text-muted-foreground">
                  Authorization header value (e.g., Bearer &lt;token&gt;)
                </p>
              </div>

              {/* Query Parameters */}
              {hasParams && (
                <div className="space-y-3">
                  <Label className="text-sm font-medium">Query Parameters</Label>
                  <p className="text-xs text-muted-foreground">
                    Parameters for the upload request
                  </p>
                  {resource.queryParams.map((param) => (
                    <div key={param} className="space-y-1">
                      <Label htmlFor={`param-${param}`} className="text-xs text-muted-foreground">
                        {param}
                      </Label>
                      <Input
                        id={`param-${param}`}
                        value={paramValues[param] || ""}
                        onChange={(e) => handleParamChange(param, e.target.value)}
                        placeholder={`Enter ${param}`}
                        className="bg-background/50"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Resource Info */}
              <div className="pt-4 border-t border-border">
                <p className="text-xs text-muted-foreground mb-2">Resource Information</p>
                <div className="text-xs space-y-1">
                  <p><span className="text-muted-foreground">Name:</span> {resource.name}</p>
                  <p><span className="text-muted-foreground">Provider:</span> {resource.provider}</p>
                  <p className="break-all"><span className="text-muted-foreground">Resource ID:</span> {resource.id}</p>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <Button
                variant="outline"
                onClick={() => setShowConfigModal(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={() => setShowConfigModal(false)}
              >
                Save Configuration
              </Button>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/80" onClick={closeFilePreview} />
          <div className="relative z-10 w-full max-w-5xl mx-4 bg-background border rounded-lg shadow-lg max-h-[88vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-4 p-4 border-b">
              <div className="min-w-0">
                <h3 className="font-semibold truncate">{preview.file.name}</h3>
                <p className="text-xs text-muted-foreground">
                  {preview.kind === "download" ? "Preview is not available for this document type." : "Uploaded document preview"}
                </p>
              </div>
              <button
                onClick={closeFilePreview}
                className="p-1 hover:bg-accent rounded transition-colors"
                aria-label="Close preview"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-auto p-4">
              {preview.kind === "pdf" && (
                <iframe
                  title={preview.file.name}
                  src={preview.url}
                  className="w-full min-h-[70vh] rounded border bg-background"
                />
              )}
              {preview.kind === "image" && (
                <div className="flex min-h-[55vh] items-center justify-center">
                  <img
                    src={preview.url}
                    alt={preview.file.name}
                    className="max-h-[70vh] max-w-full rounded border object-contain"
                  />
                </div>
              )}
              {preview.kind === "text" && (
                <pre className="whitespace-pre-wrap break-words rounded border bg-muted/30 p-4 text-sm">
                  {preview.text}
                </pre>
              )}
              {preview.kind === "download" && (
                <div className="flex min-h-[280px] flex-col items-center justify-center gap-4 text-center">
                  <FileText className="w-12 h-12 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Preview is not available for this file type.</p>
                    <p className="text-sm text-muted-foreground">
                      Download the uploaded document to open it locally.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background p-4">
              <Button variant="outline" onClick={closeFilePreview}>
                Close
              </Button>
              <Button onClick={() => downloadFile(preview.file, preview.url)} className="gap-2">
                <Download className="w-4 h-4" />
                Download
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DocumentUploadZone;
