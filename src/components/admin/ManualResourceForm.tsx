import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2 } from "lucide-react";
import { VisualizationType } from "@/types/auth";

interface ManualResourceFormProps {
  onSubmit: (resource: ManualResourceData) => void;
  isLoading: boolean;
}

export interface ManualResourceData {
  resource_url: string;
  contract_url: string;
  resource_type: 'software' | 'data' | 'service_chain';
  resource_name: string;
  resource_description: string;
  provider: string;
  service_offering: string;
  parameters: Array<{ paramName: string; paramValue: string }>;
  visualization_type: VisualizationType;
  upload_file: boolean;
  is_visible: boolean;
}

const VISUALIZATION_OPTIONS: { value: VisualizationType; label: string }[] = [
  { value: 'data_api', label: 'Data API' },
  { value: 'upload_document', label: 'Upload Document' },
  { value: 'manual_json_input', label: 'Manual JSON Input' },
];

// Only data resources have visualization types
const RESOURCE_TYPES_WITH_VISUALIZATION: Array<'software' | 'data' | 'service_chain'> = ['data'];

const ManualResourceForm = ({ onSubmit, isLoading }: ManualResourceFormProps) => {
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState<ManualResourceData>({
    resource_url: "",
    contract_url: "",
    resource_type: "data",
    resource_name: "",
    resource_description: "",
    provider: "",
    service_offering: "",
    parameters: [],
    visualization_type: "data_api",
    upload_file: false,
    is_visible: false,
  });

  const handleAddParameter = () => {
    setFormData(prev => ({
      ...prev,
      parameters: [...prev.parameters, { paramName: "", paramValue: "" }]
    }));
  };

  const handleRemoveParameter = (index: number) => {
    setFormData(prev => ({
      ...prev,
      parameters: prev.parameters.filter((_, i) => i !== index)
    }));
  };

  const handleParameterChange = (index: number, field: 'paramName' | 'paramValue', value: string) => {
    setFormData(prev => ({
      ...prev,
      parameters: prev.parameters.map((p, i) => 
        i === index ? { ...p, [field]: value } : p
      )
    }));
  };

  const handleSubmit = () => {
    if (!formData.resource_url || !formData.contract_url || !formData.resource_name) {
      return;
    }
    onSubmit(formData);
    setOpen(false);
    setFormData({
      resource_url: "",
      contract_url: "",
      resource_type: "data",
      resource_name: "",
      resource_description: "",
      provider: "",
      service_offering: "",
      parameters: [],
      visualization_type: "data_api",
      upload_file: false,
      is_visible: false,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus className="h-4 w-4 mr-2" />
          Add Resource Manually
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Resource</DialogTitle>
          <DialogDescription>
            Manually add a new resource to the dataspace configuration
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="resource_name">Resource Name *</Label>
              <Input
                id="resource_name"
                value={formData.resource_name}
                onChange={(e) => setFormData(prev => ({ ...prev, resource_name: e.target.value }))}
                placeholder="My Resource"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="resource_type">Resource Type *</Label>
              <Select
                value={formData.resource_type}
                onValueChange={(v) => setFormData(prev => ({ 
                  ...prev, 
                  resource_type: v as 'software' | 'data' | 'service_chain',
                  // Reset visualization type for non-data types
                  visualization_type: v === 'data' ? prev.visualization_type : 'data_api'
                }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="software">Software</SelectItem>
                  <SelectItem value="data">Data</SelectItem>
                  <SelectItem value="service_chain">Service Chain</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="resource_url">Resource URL *</Label>
            <Input
              id="resource_url"
              value={formData.resource_url}
              onChange={(e) => setFormData(prev => ({ ...prev, resource_url: e.target.value }))}
              placeholder="https://example.com/resource"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="contract_url">Contract URL *</Label>
            <Input
              id="contract_url"
              value={formData.contract_url}
              onChange={(e) => setFormData(prev => ({ ...prev, contract_url: e.target.value }))}
              placeholder="https://example.com/contract.json"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="resource_description">Description</Label>
            <Textarea
              id="resource_description"
              value={formData.resource_description}
              onChange={(e) => setFormData(prev => ({ ...prev, resource_description: e.target.value }))}
              placeholder="Resource description..."
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="provider">Provider</Label>
              <Input
                id="provider"
                value={formData.provider}
                onChange={(e) => setFormData(prev => ({ ...prev, provider: e.target.value }))}
                placeholder="Provider name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="service_offering">Service Offering URL</Label>
              <Input
                id="service_offering"
                value={formData.service_offering}
                onChange={(e) => setFormData(prev => ({ ...prev, service_offering: e.target.value }))}
                placeholder="https://example.com/offering"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Only show visualization type for data resources */}
            {RESOURCE_TYPES_WITH_VISUALIZATION.includes(formData.resource_type) && (
              <div className="space-y-2">
                <Label htmlFor="visualization_type">Visualization Type</Label>
                <Select
                  value={formData.visualization_type}
                  onValueChange={(v) => setFormData(prev => ({ ...prev, visualization_type: v as VisualizationType }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VISUALIZATION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className={`flex items-center gap-4 ${RESOURCE_TYPES_WITH_VISUALIZATION.includes(formData.resource_type) ? 'pt-8' : 'col-span-2'}`}>
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.upload_file}
                  onCheckedChange={(c) => setFormData(prev => ({ ...prev, upload_file: c }))}
                />
                <Label>Upload File</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.is_visible}
                  onCheckedChange={(c) => setFormData(prev => ({ ...prev, is_visible: c }))}
                />
                <Label>Visible</Label>
              </div>
            </div>
          </div>

          {/* Parameters Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Parameters</Label>
              <Button type="button" variant="outline" size="sm" onClick={handleAddParameter}>
                <Plus className="h-3 w-3 mr-1" />
                Add
              </Button>
            </div>
            {formData.parameters.map((param, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  placeholder="Parameter name"
                  value={param.paramName}
                  onChange={(e) => handleParameterChange(index, 'paramName', e.target.value)}
                />
                <Input
                  placeholder="Default value"
                  value={param.paramValue}
                  onChange={(e) => handleParameterChange(index, 'paramValue', e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveParameter(index)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
            {formData.parameters.length === 0 && (
              <p className="text-sm text-muted-foreground">No parameters added</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={isLoading || !formData.resource_url || !formData.contract_url || !formData.resource_name}
          >
            Add Resource
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ManualResourceForm;
