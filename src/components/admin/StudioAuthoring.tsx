import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { studioApi } from "@/services/studioApi";
import {
  type AuthoringCatalog,
  authoringChanges,
  type AuthoringManifest,
  type LegacyInventory,
  validateAuthoringManifest,
} from "../../../supabase/functions/_shared/studioAuthoring";
import type { StudioDefinition } from "@/services/studioApi";
import { StudioElementContent } from "@/components/studio/StudioElements";
import { studioElementStyle } from "@/lib/studioBuilder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
interface Proposal {
  id: string;
  kind: "prompt" | "migration";
  status: string;
  manifest: AuthoringManifest;
  applied_manifest?: AuthoringManifest;
  warnings: string[];
  allow_code: boolean;
  base_definition: StudioDefinition | null;
  created_at: string;
  provider_name: string | null;
  result?: { applicationId: string; pageIds: string[] };
}
interface Catalog {
  catalog: AuthoringCatalog;
  inventory: LegacyInventory;
  providers: Array<{ id: string; name: string; model: string }>;
}
interface History {
  proposals: Proposal[];
  rollout: { application_id: string | null; revision: number } | null;
}
async function authoring<T>(
  org: string,
  action: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("studio-authoring", {
    headers: { "x-organization-id": org },
    body: { ...body, action },
  });
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    throw new Error(detail?.error || error.message);
  }
  if (!data?.ok) throw new Error(data?.error || "Authoring failed.");
  return data as T;
}
export default function StudioAuthoring() {
  const { user } = useAuth();
  const org = user?.organization?.id || "";
  const client = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState("");
  const [pageId, setPageId] = useState("");
  const [allowCode, setAllowCode] = useState(false);
  const [slug, setSlug] = useState("migrated-workspace");
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Proposal | null>(null);
  const [source, setSource] = useState("");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [rollout, setRollout] = useState("");
  const key = ["studio-authoring", user?.id, org];
  const catalog = useQuery({
    queryKey: [...key, "catalog"],
    enabled: !!org,
    queryFn: () => authoring<Catalog>(org, "catalog"),
  });
  const history = useQuery({
    queryKey: [...key, "history"],
    enabled: !!org,
    queryFn: () => authoring<History>(org, "list"),
  });
  const items = useQuery({
    queryKey: ["studio-items", user?.id, org],
    enabled: !!org,
    queryFn: () => studioApi("list", org),
  });
  const select = (proposal: Proposal) => {
    setSelected(proposal);
    setSource(
      JSON.stringify(proposal.applied_manifest || proposal.manifest, null, 2),
    );
    setPreview(false);
    setError("");
  };
  const perform = async (action: string, body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await authoring<{ proposal?: Proposal }>(
        org,
        action,
        body,
      );
      if (result.proposal) select(result.proposal);
      else if (action === "apply" || action === "discard") {
        setSelected(null);
        setPreview(false);
        setNotice(
          action === "apply"
            ? "Proposal applied to drafts. Review and publish pages, then publish the application in Applications & Pages."
            : "Proposal discarded.",
        );
      } else {setNotice(
          "Gateway default updated. Use the legacy option below to revert.",
        );}
      await Promise.all([
        client.invalidateQueries({ queryKey: key }),
        client.invalidateQueries({ queryKey: ["studio-items", user?.id, org] }),
        client.invalidateQueries({ queryKey: ["studio-landing"] }),
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  let manifest: AuthoringManifest | null = null;
  let validation = "";
  if (selected && catalog.data) {
    try {
      manifest = validateAuthoringManifest(
        JSON.parse(source),
        catalog.data.catalog,
        selected.allow_code,
        selected.kind === "migration",
      );
    } catch (cause) {
      validation = cause instanceof Error ? cause.message : String(cause);
    }
  }
  const targets = catalog.data
    ? [
      ...catalog.data.inventory.resources.filter((row) =>
        row.type === "software"
      ),
      ...catalog.data.inventory.chains,
    ]
    : [];
  const selectClass = "w-full rounded border bg-background p-2 text-sm";
  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold">Prompt authoring & migration</h2>
        <p className="text-muted-foreground">
          Generate proposals, review changes, then apply unpublished drafts.
          Publishing and gateway rollout are separate steps.
        </p>
      </header>
      {(error || catalog.error || history.error || items.error) && (
        <p role="alert" className="text-destructive">
          {error || catalog.error?.message || history.error?.message ||
            items.error?.message}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <fieldset
        disabled={busy || !catalog.data}
        className="space-y-4 rounded border p-5"
      >
        <legend className="px-2 font-semibold">Author with a prompt</legend>
        <label className="block">
          Model provider<select
            aria-label="Authoring provider"
            className={selectClass}
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="">Select saved provider</option>
            {catalog.data?.providers.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name} · {row.model}
              </option>
            ))}
          </select>
        </label>
        {catalog.data && !catalog.data.providers.length && (
          <p>
            Configure a model provider under agent orchestration before
            generating a proposal.
          </p>
        )}
        <label className="block">
          Target<select
            aria-label="Authoring target"
            className={selectClass}
            value={pageId}
            onChange={(e) => setPageId(e.target.value)}
          >
            <option value="">New application</option>
            {items.data?.items?.filter((row) => row.kind === "page").map(
              (row) => (
                <option key={row.id} value={row.id}>
                  Refine: {row.draft.title}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="block">
          Describe the application or requested page changes<Textarea
            aria-label="Authoring prompt"
            value={prompt}
            maxLength={12000}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Build a skill management workspace with document, skill, mapping and job profile pages using our knowledge store."
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={allowCode}
            onChange={(e) => setAllowCode(e.target.checked)}
          />Allow generated HTML, CSS and JavaScript
        </label>
        <p className="text-sm text-muted-foreground">
          Your prompt, available workflow/store/chat names and IDs, and the
          selected page draft are sent to this provider. Do not include secrets.
        </p>
        <Button
          disabled={!provider || !prompt.trim()}
          onClick={() =>
            void perform("generate", {
              providerId: provider,
              prompt,
              pageId: pageId || undefined,
              allowCode,
            })}
        >
          {busy ? "Working…" : "Generate proposal"}
        </Button>
      </fieldset>
      <fieldset
        disabled={busy || !catalog.data}
        className="space-y-4 rounded border p-5"
      >
        <legend className="px-2 font-semibold">
          Migrate the legacy gateway
        </legend>
        <p>
          Retain analytics, data selection, processing and results in a
          compatibility page. Optionally map legacy targets to enabled API
          workflows for additional native pages. Review each workflow’s input
          contract after migration.
        </p>
        <label className="block">
          New application URL slug<Input
            aria-label="Migration slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
        </label>
        {targets.map((target) => (
          <label key={target.id} className="block">
            {target.name}
            <select
              aria-label={`Workflow for ${target.name}`}
              className={selectClass}
              value={mappings[target.id] || ""}
              onChange={(e) =>
                setMappings((previous) => {
                  const next = { ...previous };
                  if (e.target.value) next[target.id] = e.target.value;
                  else delete next[target.id];
                  return next;
                })}
            >
              <option value="">Compatibility only</option>
              {catalog.data?.catalog.workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </option>
              ))}
            </select>
          </label>
        ))}
        <p className="text-sm text-muted-foreground">
          PDC, Resources, Global Settings and existing links remain available.
          Credentials are never copied into the proposal.
        </p>
        <Button onClick={() => void perform("migrate", { slug, mappings })}>
          Prepare migration proposal
        </Button>
      </fieldset>
      <section className="space-y-3 rounded border p-5">
        <h3 className="font-semibold">Proposal history</h3>
        <p className="text-sm">
          Latest 50 proposals. Applied proposals retain the reviewed JSON, actor
          and application/page identifiers in the backend audit record.
        </p>
        {history.data?.proposals.map((proposal) => (
          <Button
            key={proposal.id}
            variant="outline"
            className="mr-2 mb-2 max-w-full whitespace-normal"
            onClick={() => select(proposal)}
          >
            {proposal.manifest.application.definition.title} · {proposal.kind} ·
            {" "}
            {proposal.status}
          </Button>
        ))}
        {!history.data?.proposals.length && <p>No proposals yet.</p>}
      </section>
      {selected && (
        <section className="space-y-4 rounded border p-5">
          <h3 className="font-semibold">Review proposal · {selected.status}</h3>
          <ul className="list-disc pl-5">
            {selected.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
          {selected.base_definition && (
            <details>
              <summary>Original page draft</summary>
              <pre className="max-h-80 overflow-auto text-xs">{JSON.stringify(selected.base_definition,null,2)}</pre>
            </details>
          )}
          <label className="block">
            Proposed application JSON<Textarea
              aria-label="Proposal JSON"
              className="min-h-80 font-mono text-xs"
              value={source}
              readOnly={selected.status !== "review" || busy}
              onChange={(e) => {
                setSource(e.target.value);
                setPreview(false);
              }}
            />
          </label>
          {validation && (
            <p role="alert" className="text-destructive">{validation}</p>
          )}
          {manifest && (
            <div>
              <p>
                {manifest.pages.length} page(s), {manifest.pages.reduce(
                  (sum, page) => sum + page.definition.elements.length,
                  0,
                )} elements. {selected.base_definition
                  ? "Only the target draft will change; its published release stays live."
                  : "A new inactive application and inactive pages will be created."}
              </p>
              {manifest.pages.map((page) => (
                <p key={page.slug}>
                  {page.definition.title} — /{page.slug}:{" "}
                  {page.definition.elements.map((element) =>
                    `${element.label} (${element.type})`
                  ).join(", ")}
                </p>
              ))}
            </div>
          )}
          {manifest && (
            <details open>
              <summary>Change summary</summary>
              {manifest.pages.map((page) => (
                <div key={page.slug}>
                  <h4 className="mt-2 font-medium">{page.definition.title}</h4>
                  <ul className="list-disc pl-5">
                    {authoringChanges(selected.base_definition, page.definition)
                      .map((change, index) => <li key={index}>{change}</li>)}
                  </ul>
                </div>
              ))}
            </details>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!manifest}
              onClick={() => setPreview(!preview)}
            >
              {preview ? "Close preview" : "Preview reviewed proposal"}
            </Button>
            {selected.status === "review" && (
              <>
                <Button
                  disabled={busy || !manifest}
                  onClick={() =>
                    void perform("apply", { id: selected.id, manifest })}
                >
                  Apply to drafts
                </Button>
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() => void perform("discard", { id: selected.id })}
                >
                  Discard proposal
                </Button>
              </>
            )}
          </div>
          {preview && manifest &&
            manifest.pages.map((page) => (
              <article key={page.slug} className="rounded border p-4">
                <h4 className="mb-4 text-xl font-semibold">
                  {page.definition.title}
                </h4>
                <div className="studio-surface">
                  <div className="studio-elements">
                    {page.definition.elements.filter((element) =>
                      element.enabled !== false
                    ).map((element) => (
                      <div
                        key={element.id}
                        className="studio-element"
                        style={studioElementStyle(element)}
                      >
                        <StudioElementContent
                          element={element}
                          input={{}}
                          result={null}
                          payload="{}"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            ))}
        </section>
      )}
      <fieldset
        disabled={busy || !history.data}
        className="space-y-3 rounded border p-5"
      >
        <legend className="px-2 font-semibold">Gateway rollout</legend>
        <p>
          Default for signed-in organization members visiting /{user
            ?.organization?.slug}. Anonymous access, /embed and links with query
          parameters continue to use the legacy gateway. Add ?legacy=1 to bypass
          Studio.
        </p>
        <p>
          Current: {history.data?.rollout?.application_id
            ? items.data?.items?.find((row) =>
              row.id === history.data?.rollout?.application_id
            )?.draft.title || "Studio application"
            : "Legacy gateway"}
        </p>
        <select
          aria-label="Gateway default"
          className={selectClass}
          value={rollout}
          onChange={(e) => setRollout(e.target.value)}
        >
          <option value="">Legacy gateway (revert rollout)</option>
          {items.data?.items?.filter((row) =>
            row.kind === "application" && row.active && row.published_release_id
          ).map((row) => (
            <option key={row.id} value={row.id}>{row.draft.title}</option>
          ))}
        </select>
        <Button
          onClick={() =>
            void perform("rollout", {
              applicationId: rollout || null,
              expectedRevision: history.data?.rollout?.revision || 0,
            })}
        >
          Set gateway default
        </Button>
      </fieldset>
    </div>
  );
}
