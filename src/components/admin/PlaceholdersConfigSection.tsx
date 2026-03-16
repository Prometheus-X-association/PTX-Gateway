import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2, Variable, Zap, Hash, Code, Play, ChevronDown, BookOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface Placeholder {
  id: string;
  placeholder_key: string;
  placeholder_type: "static" | "dynamic";
  static_value: string | null;
  generator_type: string | null;
  custom_function_code: string | null;
  description: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface PlaceholderFormState {
  placeholder_key: string;
  placeholder_type: "static" | "dynamic";
  static_value: string;
  generator_type: string;
  custom_function_code: string;
  description: string;
}

const DYNAMIC_GENERATORS = [
  { value: "uuid", label: "UUID", description: "Generates a random UUID v4" },
  { value: "session_id", label: "Session ID", description: "Unique session identifier (like #genSessionId)" },
  { value: "timestamp", label: "Timestamp", description: "Current Unix timestamp in milliseconds" },
  { value: "date_iso", label: "ISO Date", description: "Current date/time in ISO 8601 format" },
  { value: "random_string", label: "Random String", description: "Random alphanumeric string" },
  { value: "custom_function", label: "Custom Function", description: "Write custom JavaScript that returns a value" },
];

const EXAMPLE_FUNCTIONS = [
  {
    title: "Simple fetch — GET JSON field",
    code: `// Fetch a value from an external API
const response = await fetch("https://api.example.com/config");
const data = await response.json();
return data.apiKey;`,
  },
  {
    title: "Fetch with headers",
    code: `// Fetch with authorization header
const response = await fetch("https://api.example.com/token", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer my-secret-token"
  },
  body: JSON.stringify({ scope: "read" })
});
const data = await response.json();
return data.access_token;`,
  },
  {
    title: "Computed value from context",
    code: `// Use context variables to build a value
// Available: context.organizationId, context.placeholderKey,
//            context.timestamp, context.isoDate
const prefix = "org";
return \`\${prefix}_\${context.organizationId.substring(0, 8)}_\${context.timestamp}\`;`,
  },
  {
    title: "Random from list",
    code: `// Pick a random value from a predefined list
const regions = ["eu-west-1", "us-east-1", "ap-south-1"];
const index = Math.floor(Math.random() * regions.length);
return regions[index];`,
  },
  {
    title: "Date-based identifier",
    code: `// Generate a date-based batch identifier
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const dateStr = \`\${now.getFullYear()}\${pad(now.getMonth()+1)}\${pad(now.getDate())}\`;
const seq = Math.floor(Math.random() * 9999).toString().padStart(4, "0");
return \`BATCH-\${dateStr}-\${seq}\`;`,
  },
];

const DEFAULT_CUSTOM_CODE = `// Write your custom function here.
// Must return a string value.
// Available variables:
//   context.organizationId  — Your organization's ID
//   context.placeholderKey  — The placeholder key (e.g. "#myKey")
//   context.timestamp       — Current Unix timestamp
//   context.isoDate         — Current ISO date string
//   fetch(url, options)     — Standard fetch API for HTTP requests
//
// Example:
// const res = await fetch("https://api.example.com/value");
// const data = await res.json();
// return data.result;

return "hello-world";`;

const EMPTY_FORM: PlaceholderFormState = {
  placeholder_key: "#",
  placeholder_type: "static",
  static_value: "",
  generator_type: "uuid",
  custom_function_code: DEFAULT_CUSTOM_CODE,
  description: "",
};

const PlaceholdersConfigSection = () => {
  const { user } = useAuth();
  const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PlaceholderFormState>(EMPTY_FORM);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ value?: string; error?: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);

  const orgId = user?.organization?.id;

  const fetchPlaceholders = useCallback(async () => {
    if (!orgId) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("param_placeholders")
        .select("*")
        .eq("organization_id", orgId)
        .order("placeholder_key");

      if (error) throw error;
      setPlaceholders((data as Placeholder[]) || []);
    } catch {
      toast.error("Failed to load placeholders");
    } finally {
      setIsLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchPlaceholders();
  }, [fetchPlaceholders]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setTestResult(null);
    setExamplesOpen(false);
    setDialogOpen(true);
  };

  const openEdit = (p: Placeholder) => {
    setEditingId(p.id);
    setForm({
      placeholder_key: p.placeholder_key,
      placeholder_type: p.placeholder_type,
      static_value: p.static_value || "",
      generator_type: p.generator_type || "uuid",
      custom_function_code: p.custom_function_code || DEFAULT_CUSTOM_CODE,
      description: p.description || "",
    });
    setTestResult(null);
    setExamplesOpen(false);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!orgId) return;

    const key = form.placeholder_key.trim();
    if (!key || key === "#") {
      toast.error("Placeholder key is required and must start with #");
      return;
    }
    if (!key.startsWith("#")) {
      toast.error("Placeholder key must start with #");
      return;
    }
    if (form.placeholder_type === "static" && !form.static_value.trim()) {
      toast.error("Static value is required for static placeholders");
      return;
    }
    if (form.placeholder_type === "dynamic" && form.generator_type === "custom_function" && !form.custom_function_code.trim()) {
      toast.error("Custom function code is required");
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        organization_id: orgId,
        placeholder_key: key,
        placeholder_type: form.placeholder_type,
        static_value: form.placeholder_type === "static" ? form.static_value.trim() : null,
        generator_type: form.placeholder_type === "dynamic" ? form.generator_type : null,
        custom_function_code:
          form.placeholder_type === "dynamic" && form.generator_type === "custom_function"
            ? form.custom_function_code
            : null,
        description: form.description.trim() || null,
      };

      if (editingId) {
        const { error } = await supabase
          .from("param_placeholders")
          .update(payload)
          .eq("id", editingId);
        if (error) throw error;
        toast.success("Placeholder updated");
      } else {
        const { error } = await supabase
          .from("param_placeholders")
          .insert(payload);
        if (error) throw error;
        toast.success("Placeholder created");
      }

      setDialogOpen(false);
      await fetchPlaceholders();
    } catch (err: any) {
      if (err?.code === "23505") {
        toast.error("A placeholder with this key already exists");
      } else {
        toast.error("Failed to save placeholder");
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async (placeholderId?: string) => {
    if (!orgId) return;

    // For testing, we need to save first if creating new, or use existing ID
    if (!placeholderId && !editingId) {
      toast.error("Please save the placeholder first, then use the test button from the table.");
      return;
    }

    const id = placeholderId || editingId;
    setIsTesting(true);
    setTestResult(null);

    try {
      const { data, error } = await supabase.functions.invoke("resolve-placeholder", {
        body: {
          placeholder_id: id,
          organization_id: orgId,
          test_only: true,
        },
      });

      if (error) throw error;

      if (data?.error) {
        setTestResult({ error: data.error });
      } else {
        setTestResult({ value: data?.value });
      }
    } catch (err: any) {
      setTestResult({ error: err.message || "Test failed" });
    } finally {
      setIsTesting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase
        .from("param_placeholders")
        .delete()
        .eq("id", id);
      if (error) throw error;
      toast.success("Placeholder deleted");
      setDeleteConfirmId(null);
      await fetchPlaceholders();
    } catch {
      toast.error("Failed to delete placeholder");
    }
  };

  const getGeneratorLabel = (type: string | null) =>
    DYNAMIC_GENERATORS.find((g) => g.value === type)?.label || type || "Unknown";

  const getGeneratorIcon = (type: string | null) => {
    if (type === "custom_function") return <Code className="h-3 w-3 mr-1" />;
    return <Zap className="h-3 w-3 mr-1" />;
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Variable className="h-5 w-5" />
                Parameter Placeholders
              </CardTitle>
              <CardDescription>
                Define automatic value placeholders that can be used as default parameter values in resource configuration.
              </CardDescription>
            </div>
            <Button onClick={openCreate} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Placeholder
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {placeholders.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Variable className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No placeholders defined</p>
              <p className="text-sm mt-1">
                Create placeholders like <code className="bg-muted px-1 rounded">#genSessionId</code> to auto-fill parameter values.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Value / Generator</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[140px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {placeholders.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono font-medium text-primary">
                      {p.placeholder_key}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.placeholder_type === "dynamic" ? "default" : "secondary"}>
                        {p.placeholder_type === "dynamic" ? (
                          <>{getGeneratorIcon(p.generator_type)}Dynamic</>
                        ) : (
                          <><Hash className="h-3 w-3 mr-1" />Static</>
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {p.placeholder_type === "dynamic"
                        ? getGeneratorLabel(p.generator_type)
                        : <span className="font-mono text-xs bg-muted px-2 py-1 rounded">{p.static_value}</span>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                      {p.description || "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {p.placeholder_type === "dynamic" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Test this placeholder"
                            onClick={() => handleTest(p.id)}
                            disabled={isTesting}
                          >
                            {isTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" onClick={() => openEdit(p)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteConfirmId(p.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className={form.generator_type === "custom_function" && form.placeholder_type === "dynamic" ? "sm:max-w-[680px]" : "sm:max-w-[480px]"}>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Placeholder" : "New Placeholder"}</DialogTitle>
            <DialogDescription>
              Define an automatic value that can be assigned as a default parameter value.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Placeholder Key</Label>
              <Input
                placeholder="#myPlaceholder"
                value={form.placeholder_key}
                onChange={(e) => {
                  let v = e.target.value;
                  if (v && !v.startsWith("#")) v = "#" + v;
                  setForm({ ...form, placeholder_key: v });
                }}
                disabled={!!editingId}
              />
              <p className="text-xs text-muted-foreground">
                Must start with <code>#</code>. Use this key as a parameter default value to auto-fill it.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={form.placeholder_type}
                onValueChange={(v) =>
                  setForm({ ...form, placeholder_type: v as "static" | "dynamic" })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="static">Static — Fixed value</SelectItem>
                  <SelectItem value="dynamic">Dynamic — Generated at runtime</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.placeholder_type === "static" ? (
              <div className="space-y-2">
                <Label>Static Value</Label>
                <Input
                  placeholder="Enter the fixed value"
                  value={form.static_value}
                  onChange={(e) => setForm({ ...form, static_value: e.target.value })}
                />
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Generator</Label>
                  <Select
                    value={form.generator_type}
                    onValueChange={(v) => setForm({ ...form, generator_type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DYNAMIC_GENERATORS.map((g) => (
                        <SelectItem key={g.value} value={g.value}>
                          <div className="flex flex-col">
                            <span>{g.label}</span>
                            <span className="text-xs text-muted-foreground">{g.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {form.generator_type === "custom_function" && (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="flex items-center gap-1.5">
                          <Code className="h-4 w-4" />
                          Function Code
                        </Label>
                        {editingId && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleTest()}
                            disabled={isTesting}
                          >
                            {isTesting ? (
                              <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                            ) : (
                              <Play className="h-3 w-3 mr-1.5" />
                            )}
                            Test
                          </Button>
                        )}
                      </div>
                      <Textarea
                        className="font-mono text-xs min-h-[200px] bg-muted/50"
                        value={form.custom_function_code}
                        onChange={(e) => setForm({ ...form, custom_function_code: e.target.value })}
                        placeholder={DEFAULT_CUSTOM_CODE}
                        rows={10}
                      />
                      <p className="text-xs text-muted-foreground">
                        Write async JavaScript. The code runs server-side with access to <code>fetch()</code> and a <code>context</code> object. Must <code>return</code> a string value.
                      </p>
                    </div>

                    {/* Test Result */}
                    {testResult && (
                      <div className={`p-3 rounded-lg text-sm font-mono ${testResult.error ? "bg-destructive/10 text-destructive border border-destructive/20" : "bg-primary/10 text-primary border border-primary/20"}`}>
                        <p className="text-xs font-sans font-medium mb-1">
                          {testResult.error ? "❌ Error" : "✅ Result"}
                        </p>
                        <p className="break-all">{testResult.error || testResult.value}</p>
                      </div>
                    )}

                    {/* Examples */}
                    <Collapsible open={examplesOpen} onOpenChange={setExamplesOpen}>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="w-full justify-between">
                          <span className="flex items-center gap-1.5">
                            <BookOpen className="h-3.5 w-3.5" />
                            Example Functions
                          </span>
                          <ChevronDown className={`h-4 w-4 transition-transform ${examplesOpen ? "rotate-180" : ""}`} />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="space-y-2 pt-2">
                        {EXAMPLE_FUNCTIONS.map((ex, i) => (
                          <div key={i} className="border rounded-lg p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-medium">{ex.title}</p>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setForm({ ...form, custom_function_code: ex.code })}
                              >
                                Use
                              </Button>
                            </div>
                            <pre className="text-xs font-mono bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap">
                              {ex.code}
                            </pre>
                          </div>
                        ))}

                        <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
                          <p className="text-sm font-semibold flex items-center gap-1.5">
                            <BookOpen className="h-4 w-4" />
                            Writing Guide
                          </p>
                          <div className="text-xs text-muted-foreground space-y-1.5">
                            <p><strong>Your code must <code>return</code> a string.</strong> The return value will be used as the parameter value.</p>
                            <p><strong>Available globals:</strong></p>
                            <ul className="list-disc ml-4 space-y-0.5">
                              <li><code>fetch(url, options)</code> — Standard Fetch API for HTTP requests</li>
                              <li><code>context.organizationId</code> — Your organization UUID</li>
                              <li><code>context.placeholderKey</code> — This placeholder's key (e.g. <code>#myKey</code>)</li>
                              <li><code>context.timestamp</code> — Current Unix timestamp (ms)</li>
                              <li><code>context.isoDate</code> — Current ISO 8601 date string</li>
                            </ul>
                            <p><strong>Async is supported:</strong> You can use <code>await</code> directly (e.g. <code>await fetch(...)</code>).</p>
                            <p><strong>Error handling:</strong> If your function throws, the error message will be shown. Wrap risky calls in <code>try/catch</code>.</p>
                            <p><strong>Timeout:</strong> Functions have a server-side execution limit. Keep fetch calls fast.</p>
                          </div>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </div>
                )}
              </>
            )}

            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Textarea
                placeholder="What this placeholder is used for..."
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {editingId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete Placeholder</DialogTitle>
            <DialogDescription>
              Are you sure? Any parameter using this placeholder will no longer be auto-resolved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default PlaceholdersConfigSection;
