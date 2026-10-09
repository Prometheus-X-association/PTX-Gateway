/** Batch-one contract. Publishing and persisted application definitions follow in batch two. */
export interface ApplicationPageDefinition {
  schemaVersion: 1;
  id: string;
  organizationId: string;
  title: string;
  access: "organization-admin";
  elements: Array<{
    id: string;
    type: "json-input" | "workflow-button" | "run-output" | "custom-widget";
    label: string;
  }>;
  action: { event: "submit"; workflowId: string; inputBinding: "payload" };
}

export function parseApplicationInput(value: string): unknown {
  if (new TextEncoder().encode(value).length > 256 * 1024) throw new Error("Preview input must be at most 256 KiB.");
  try { return JSON.parse(value); }
  catch { throw new Error("Enter valid JSON before running the workflow."); }
}

/** Used in an opaque-origin iframe with a restrictive resource policy and no host credentials. */
export function customWidgetDocument(source: string): string {
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${source}</body></html>`;
}

export function outputTable(value: unknown): { columns: string[]; rows: Record<string, unknown>[] } | null {
  if (!Array.isArray(value) || !value.length || !value.every((row) => row !== null && typeof row === "object" && !Array.isArray(row))) return null;
  const rows = value.slice(0, 100) as Record<string, unknown>[];
  const columns = [...new Set(rows.flatMap(Object.keys))].slice(0, 20);
  return { columns, rows };
}
