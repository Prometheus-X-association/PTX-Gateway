import { useState, useCallback } from "react";
import { Code, Check, AlertCircle, Copy, FileJson } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface ManualJsonInputProps {
  value: string;
  onChange: (value: string) => void;
  resourceName?: string;
  resourceDescription?: string;
  placeholder?: string;
}

const ManualJsonInput = ({
  value,
  onChange,
  resourceName = "JSON Data",
  resourceDescription,
  placeholder = '{\n  "key": "value",\n  "items": [\n    { "id": 1, "name": "Item 1" }\n  ]\n}',
}: ManualJsonInputProps) => {
  const [isValid, setIsValid] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const validateJson = useCallback((jsonString: string) => {
    if (!jsonString.trim()) {
      setIsValid(null);
      setErrorMessage(null);
      return;
    }

    try {
      JSON.parse(jsonString);
      setIsValid(true);
      setErrorMessage(null);
    } catch (e) {
      setIsValid(false);
      setErrorMessage(e instanceof Error ? e.message : "Invalid JSON");
    }
  }, []);

  const handleChange = (newValue: string) => {
    onChange(newValue);
    validateJson(newValue);
  };

  const handleFormat = () => {
    if (!value.trim()) return;
    
    try {
      const parsed = JSON.parse(value);
      const formatted = JSON.stringify(parsed, null, 2);
      onChange(formatted);
      setIsValid(true);
      setErrorMessage(null);
      toast.success("JSON formatted successfully");
    } catch (e) {
      toast.error("Cannot format invalid JSON");
    }
  };

  const handleCopy = async () => {
    if (!value.trim()) return;
    
    try {
      await navigator.clipboard.writeText(value);
      toast.success("JSON copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      handleChange(text);
      toast.success("JSON pasted from clipboard");
    } catch {
      toast.error("Failed to paste from clipboard");
    }
  };

  const loadSampleData = () => {
    const sampleData = {
      data: {
        id: "sample-123",
        type: "document",
        attributes: {
          title: "Sample Document",
          created_at: new Date().toISOString(),
        },
        items: [
          { id: 1, name: "Item 1", value: 100 },
          { id: 2, name: "Item 2", value: 200 },
        ],
      },
    };
    handleChange(JSON.stringify(sampleData, null, 2));
  };

  return (
    <div className="space-y-4">
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <FileJson className="w-5 h-5 text-primary" />
            <Label className="text-sm font-medium">{resourceName}</Label>
          </div>
          <div className="flex items-center gap-2">
            {isValid !== null && (
              <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${
                isValid 
                  ? "bg-green-500/10 text-green-500" 
                  : "bg-destructive/10 text-destructive"
              }`}>
                {isValid ? (
                  <>
                    <Check className="w-3 h-3" />
                    Valid JSON
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3 h-3" />
                    Invalid
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {resourceDescription && (
          <p className="text-xs text-muted-foreground mb-3">{resourceDescription}</p>
        )}

        <Textarea
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          className="theme-json-surface min-h-[200px] resize-y"
          spellCheck={false}
        />

        {errorMessage && (
          <p className="text-xs text-destructive mt-2 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {errorMessage}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button
            onClick={handleFormat}
            disabled={!value.trim() || !isValid}
            className="theme-button subtle px-3 py-1.5 text-[length:var(--theme-font-size-xs)] disabled:cursor-not-allowed"
          >
            <Code className="w-3 h-3" />
            Format
          </button>
          <button
            onClick={handleCopy}
            disabled={!value.trim()}
            className="theme-button subtle px-3 py-1.5 text-[length:var(--theme-font-size-xs)] disabled:cursor-not-allowed"
          >
            <Copy className="w-3 h-3" />
            Copy
          </button>
          <button
            onClick={handlePaste}
            className="theme-button subtle px-3 py-1.5 text-[length:var(--theme-font-size-xs)]"
          >
            Paste
          </button>
          <button
            onClick={loadSampleData}
            className="theme-button primary-soft px-3 py-1.5 text-[length:var(--theme-font-size-xs)]"
          >
            Load Sample
          </button>
        </div>
      </div>
    </div>
  );
};

export default ManualJsonInput;
