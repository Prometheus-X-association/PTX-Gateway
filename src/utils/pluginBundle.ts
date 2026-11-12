import { unzipSync, strFromU8 } from "fflate";
import type { PluginBundle, PluginBundleFile, PluginBundleOrganization } from "@/types/dataspace";

/** Hard cap on the unpacked bundle size; the bundle is stored inline in the organization's global config. */
export const MAX_BUNDLE_BYTES = 10 * 1024 * 1024;

const REGISTRY_FILE = "organizations.json";

const MIME_BY_EXT: Record<string, string> = {
  json: "application/json",
  html: "text/html",
  htm: "text/html",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  xml: "application/xml",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

const TEXT_MIME = /^(text\/|application\/(json|xml)|image\/svg\+xml)/;

const extOf = (path: string) => path.split(".").pop()?.toLowerCase() ?? "";

/** Normalise a bundle-relative path: strip "./", resolve "..", drop query/hash and leading "/". */
export const normalizeBundlePath = (raw: string): string => {
  const clean = raw.split("#")[0].split("?")[0].replace(/\\/g, "/");
  const out: string[] = [];
  for (const seg of clean.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
};

export interface ParsedBundle {
  bundle: Omit<PluginBundle, "target_resource_ids" | "org_targets">;
  warnings: string[];
}

interface RegistryOrg {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  reportFile?: unknown;
  diagramFile?: unknown;
}

/**
 * Parse a CARiSMA v2 plugin ZIP. Expected layout (an optional single top-level folder is allowed):
 *   <admin>.html, <something>-client.html, organizations.json, reports/…, diagrams/…
 */
export async function parsePluginBundleZip(file: File): Promise<ParsedBundle> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(buf, {
      filter: (f) => !f.name.endsWith("/") && !f.name.startsWith("__MACOSX/") && !/(^|\/)\.DS_Store$/.test(f.name),
    });
  } catch {
    throw new Error("The file is not a valid ZIP archive.");
  }

  const total = Object.values(entries).reduce((n, b) => n + b.length, 0);
  if (total > MAX_BUNDLE_BYTES) {
    throw new Error(`The unpacked bundle is ${(total / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_BUNDLE_BYTES / 1024 / 1024} MB.`);
  }

  // The bundle root is the folder holding the shallowest organizations.json.
  const registryCandidates = Object.keys(entries)
    .filter((p) => p.split("/").pop()?.toLowerCase() === REGISTRY_FILE)
    .sort((a, b) => a.split("/").length - b.split("/").length);
  if (registryCandidates.length === 0) throw new Error(`The ZIP does not contain ${REGISTRY_FILE}.`);
  const registryEntry = registryCandidates[0];
  const root = registryEntry.includes("/") ? registryEntry.slice(0, registryEntry.lastIndexOf("/") + 1) : "";

  const rel: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(entries)) {
    if (!name.startsWith(root)) continue;
    rel[normalizeBundlePath(name.slice(root.length))] = bytes;
  }

  // HTML pages: the one with "client" in its name is the end-user view, the other is the admin view.
  const htmlPaths = Object.keys(rel).filter((p) => !p.includes("/") && /\.html?$/i.test(p));
  const clientCandidates = htmlPaths.filter((p) => /client/i.test(p));
  const adminCandidates = htmlPaths.filter((p) => !/client/i.test(p));
  if (clientCandidates.length !== 1 || adminCandidates.length !== 1) {
    throw new Error(
      `Expected exactly two HTML files next to ${REGISTRY_FILE}: one admin view and one client view (with "client" in its file name). Found: ${htmlPaths.join(", ") || "none"}.`,
    );
  }

  let registry: { organizations?: unknown; useCaseName?: unknown };
  try {
    registry = JSON.parse(strFromU8(rel[REGISTRY_FILE]));
  } catch {
    throw new Error(`${REGISTRY_FILE} is not valid JSON.`);
  }
  if (!Array.isArray(registry.organizations) || registry.organizations.length === 0) {
    throw new Error(`${REGISTRY_FILE} must contain a non-empty "organizations" array.`);
  }

  const warnings: string[] = [];
  const organizations: PluginBundleOrganization[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of (registry.organizations as RegistryOrg[]).entries()) {
    const id = typeof raw?.id === "string" ? raw.id.trim() : "";
    const name = typeof raw?.name === "string" ? raw.name.trim() : "";
    if (!id || !name) throw new Error(`Organization #${i + 1} in ${REGISTRY_FILE} needs an "id" and a "name".`);
    if (seen.has(id)) throw new Error(`Duplicate organization id "${id}" in ${REGISTRY_FILE}.`);
    seen.add(id);

    const report = typeof raw.reportFile === "string" ? normalizeBundlePath(raw.reportFile) : "";
    if (!report || !rel[report]) throw new Error(`Report file for "${name}" (${String(raw.reportFile ?? "missing")}) is not in the ZIP.`);
    try { JSON.parse(strFromU8(rel[report])); } catch { throw new Error(`Report file ${report} for "${name}" is not valid JSON.`); }

    const diagram = typeof raw.diagramFile === "string" ? normalizeBundlePath(raw.diagramFile) : "";
    if (!diagram || !rel[diagram]) warnings.push(`Diagram for "${name}" (${String(raw.diagramFile ?? "missing")}) is not in the ZIP.`);

    organizations.push({ id, name, type: typeof raw.type === "string" ? raw.type : undefined });
  }

  const files: PluginBundleFile[] = [];
  for (const [path, bytes] of Object.entries(rel)) {
    if (htmlPaths.includes(path)) continue;
    const mime = MIME_BY_EXT[extOf(path)] ?? "application/octet-stream";
    const isText = TEXT_MIME.test(mime);
    files.push({ path, mime, encoding: isText ? "text" : "base64", content: isText ? strFromU8(bytes) : bytesToBase64(bytes) });
  }

  return {
    bundle: {
      file_name: file.name,
      uploaded_at: new Date().toISOString(),
      admin_html: strFromU8(rel[adminCandidates[0]]),
      client_html: strFromU8(rel[clientCandidates[0]]),
      registry_path: REGISTRY_FILE,
      files,
      organizations,
      use_case_name: typeof registry.useCaseName === "string" ? registry.useCaseName : undefined,
    },
    warnings,
  };
}

/** Analytics option ids the bundle's badge is shown on (falls back to the early per-organization mapping). */
export const bundleTargetIds = (bundle: PluginBundle | undefined): string[] => {
  if (!bundle) return [];
  if (Array.isArray(bundle.target_resource_ids)) return bundle.target_resource_ids;
  return [...new Set(Object.values(bundle.org_targets ?? {}).flat())];
};

/**
 * Build an iframe srcdoc for a v2 bundle. All relative fetches (registry, reports, …) are answered from the
 * stored bundle; diagram paths in the registry are swapped for blob URLs. Organizations listed in
 * `focusOrgIds` are moved to the front, so the page opens on them (the pages select the first tab).
 */
export function buildBundleSrcdoc(bundle: PluginBundle, view: "admin" | "client", focusOrgIds: string[] = []): string {
  const fileMap: Record<string, { m: string; e: "text" | "base64"; c: string }> = {};
  for (const f of bundle.files) fileMap[f.path] = { m: f.mime, e: f.encoding, c: f.content };

  const payload = JSON.stringify({ files: fileMap, registry: bundle.registry_path, focus: focusOrgIds })
    // Keep "</script>" and similar sequences inside the bundle from closing the injected script.
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

  const injected = `<script>
(function(){
  var P=${payload};
  var F=P.files;
  function norm(u){
    u=String(u).split("#")[0].split("?")[0].replace(/\\\\/g,"/");
    var out=[];u.split("/").forEach(function(s){if(!s||s===".")return;if(s==="..")out.pop();else out.push(s);});
    try{return decodeURIComponent(out.join("/"));}catch(e){return out.join("/");}
  }
  function bytes(f){
    if(f.e!=="base64")return f.c;
    var b=atob(f.c),a=new Uint8Array(b.length);for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a;
  }
  var blobs={};
  function blobUrl(path){
    if(!F[path])return path;
    if(!blobs[path])blobs[path]=URL.createObjectURL(new Blob([bytes(F[path])],{type:F[path].m}));
    return blobs[path];
  }
  function registryText(){
    var reg=JSON.parse(F[P.registry].c);
    if(Array.isArray(reg.organizations)){
      reg.organizations=reg.organizations.map(function(o){
        if(o&&typeof o.diagramFile==="string")o=Object.assign({},o,{diagramFile:blobUrl(norm(o.diagramFile))});
        return o;
      });
      if(P.focus.length){
        var first=[],rest=[];
        reg.organizations.forEach(function(o){(o&&P.focus.indexOf(o.id)>=0?first:rest).push(o);});
        reg.organizations=first.concat(rest);
      }
    }
    return JSON.stringify(reg);
  }
  var _f=window.fetch.bind(window);
  window.fetch=function(u,o){
    var s=typeof u==="string"?u:(u&&u.url)||String(u);
    if(/^[a-z][a-z0-9+.-]*:/i.test(s))return _f(u,o);
    var k=norm(s),head=o&&String(o.method||"").toUpperCase()==="HEAD";
    if(!F[k])return Promise.resolve(new Response("Not found in plugin bundle: "+k,{status:404}));
    var body=head?"":(k===P.registry?registryText():bytes(F[k]));
    return Promise.resolve(new Response(body,{status:200,headers:{"Content-Type":F[k].m}}));
  };
})();
</script>`;

  const html = view === "admin" ? bundle.admin_html : bundle.client_html;
  const headTag = /<head[^>]*>/i;
  return headTag.test(html) ? html.replace(headTag, (m) => `${m}\n${injected}`) : injected + html;
}
