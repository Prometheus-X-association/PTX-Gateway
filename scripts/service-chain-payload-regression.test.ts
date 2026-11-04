import assert from "node:assert/strict";
import test from "node:test";
import { routeServiceChainPayload, ServiceChainPayloadError } from "../supabase/functions/_shared/serviceChainPayload.ts";
import type { PdcExchangePayload } from "../supabase/functions/_shared/serviceChainPayload.ts";

const CATALOG = "https://api.visionstrust.com/v1/catalog";
const CONTRACT = "https://contract.visionstrust.com/contracts/68121606145755e5c14cc0d8";
const CHAIN_ID = "6a6c8f23e0b620bdcb35583b";
const SESSION = "session_1760950000000_abc123";

const PROVIDER_OFFERING = `${CATALOG}/serviceofferings/69ba6ab2548d3ef0879545a2`;
const PRE_OFFERING = `${CATALOG}/serviceofferings/69ba6b30548d3ef08795485c`;
const MIDDLE_OFFERING = `${CATALOG}/serviceofferings/6a7dda5a7b6cc91233103413`;
const PURPOSE_OFFERING = `${CATALOG}/serviceofferings/6901c8324b7ed7f94f838f7f`;

const PROVIDER_DATA = `${CATALOG}/dataresources/69ba6ab2548d3ef0879545a0`;
const PRE_DATA = `${CATALOG}/dataresources/69ba6b30548d3ef08795485a`;
const MIDDLE_SOFTWARE = `${CATALOG}/softwareresources/6a7dda5a7b6cc91233103410`;
const PURPOSE_SOFTWARE = `${CATALOG}/softwareresources/689c532620493c7e8fb36e79`;

const participant = (id: string) => `${CATALOG}/participants/${id}`;
const session = { query: [{ sessionID: SESSION }] };

// Two input datasets: one in services[0], one in a pre branch that meets services[0] at the middle step.
const catalogDocuments: Record<string, unknown> = {
  [CONTRACT]: {
    serviceChains: [
      { catalogId: "some-other-chain", services: [] },
      {
        catalogId: CHAIN_ID,
        services: [
          { participant: participant("68121313dc12943a2299d2f4"), service: PROVIDER_OFFERING, params: "", pre: [] },
          {
            participant: participant("65e63ea37ca5606b781afd2b"),
            service: MIDDLE_OFFERING,
            params: "",
            pre: [[{ participant: participant("68121313dc12943a2299d2f4"), service: PRE_OFFERING, params: "" }]],
          },
          { participant: participant("656dfb3f282d47cfa6b66c91"), service: PURPOSE_OFFERING, params: "", pre: [] },
        ],
      },
    ],
  },
  [PROVIDER_OFFERING]: { dataResources: [PROVIDER_DATA], softwareResources: [] },
  [PRE_OFFERING]: { dataResources: [PRE_DATA], softwareResources: [] },
  [MIDDLE_OFFERING]: { dataResources: [], softwareResources: [MIDDLE_SOFTWARE] },
  [PURPOSE_OFFERING]: { dataResources: [], softwareResources: [PURPOSE_SOFTWARE] },
};

const createCatalogFetch = (documents: Record<string, unknown> = catalogDocuments) => {
  const calls: string[] = [];
  const fetchJson = async (url: string) => {
    calls.push(url);
    if (!(url in documents)) throw new Error(`unexpected fetch ${url}`);
    return structuredClone(documents[url]);
  };
  return { calls, fetchJson };
};

// What the gateway UI sends today: chain resources split by heuristics, both inputs in `resources`.
const gatewayChainPayload = (): PdcExchangePayload => ({
  contract: CONTRACT,
  serviceChainId: CHAIN_ID,
  resourceId: PROVIDER_OFFERING,
  purposeId: PURPOSE_OFFERING,
  resources: [
    { resource: PROVIDER_DATA, params: session },
    { resource: PRE_DATA, params: session },
  ],
  purposes: [{ resource: PURPOSE_SOFTWARE, params: session }],
  serviceChainParams: [
    { resource: MIDDLE_SOFTWARE, params: { query: [{ ontology: "headai" }, { language: "en" }] } },
  ],
});

test("chain with an input in services[0] and one in a pre branch produces the expected exchange payload", async () => {
  const { fetchJson } = createCatalogFetch();
  const routed = await routeServiceChainPayload(gatewayChainPayload(), fetchJson);

  assert.deepStrictEqual(routed, {
    contract: CONTRACT,
    serviceChainId: CHAIN_ID,
    resources: [{ resource: PROVIDER_DATA, params: session }],
    purposes: [{ resource: PURPOSE_SOFTWARE, params: session }],
    serviceChainParams: [
      { resource: PRE_DATA, params: session },
      { resource: MIDDLE_SOFTWARE, params: { query: [{ ontology: "headai" }, { language: "en" }] } },
    ],
  });
  assert.equal(JSON.stringify(Object.keys(routed)), JSON.stringify(["contract", "serviceChainId", "resources", "purposes", "serviceChainParams"]));
});

test("a resource outside every chain service throws an error naming it", async () => {
  const { fetchJson } = createCatalogFetch();
  const stray = `${CATALOG}/dataresources/000000000000000000000000`;
  const payload = gatewayChainPayload();
  payload.resources.push({ resource: stray, params: session });

  await assert.rejects(
    routeServiceChainPayload(payload, fetchJson),
    (error: unknown) => error instanceof ServiceChainPayloadError && error.message.includes(stray)
  );
});

test("an unknown serviceChainId throws a clear error", async () => {
  const { fetchJson } = createCatalogFetch();
  await assert.rejects(
    routeServiceChainPayload({ ...gatewayChainPayload(), serviceChainId: "missing-chain" }, fetchJson),
    /Service chain missing-chain not found in contract/
  );
});

test("resources without params are omitted from serviceChainParams and sent bare in resources/purposes", async () => {
  const { fetchJson } = createCatalogFetch();
  const routed = await routeServiceChainPayload(
    {
      contract: CONTRACT,
      serviceChainId: CHAIN_ID,
      resources: [{ resource: PROVIDER_DATA }, { resource: PRE_DATA, params: { query: [] } }],
      purposes: [{ resource: PURPOSE_SOFTWARE }],
      serviceChainParams: [{ resource: MIDDLE_SOFTWARE }],
    },
    fetchJson
  );

  assert.deepStrictEqual(routed, {
    contract: CONTRACT,
    serviceChainId: CHAIN_ID,
    resources: [{ resource: PROVIDER_DATA }],
    purposes: [{ resource: PURPOSE_SOFTWARE }],
  });
});

test("payloads without serviceChainId are passed through unchanged without catalog lookups", async () => {
  const { calls, fetchJson } = createCatalogFetch();
  const payload: PdcExchangePayload = {
    contract: CONTRACT,
    purposeId: PURPOSE_OFFERING,
    resourceId: PROVIDER_OFFERING,
    resources: [{ resource: PROVIDER_DATA, params: session }, { resource: PRE_DATA }],
    purposes: [{ resource: PURPOSE_SOFTWARE, params: session }],
  };
  const snapshot = structuredClone(payload);

  const routed = await routeServiceChainPayload(payload, fetchJson);

  assert.equal(routed, payload);
  assert.deepStrictEqual(routed, snapshot);
  assert.equal(calls.length, 0);
});

test("contract and service offerings are fetched once per request and not shared across requests", async () => {
  // The same offering appears both as services[0] and inside a pre branch.
  const documents = structuredClone(catalogDocuments) as Record<string, { serviceChains: Array<{ services: Array<{ pre: unknown[] }> }> }>;
  documents[CONTRACT].serviceChains[1].services[2].pre = [[{ service: PROVIDER_OFFERING }], [{ service: PRE_OFFERING }]];
  const { calls, fetchJson } = createCatalogFetch(documents);

  await routeServiceChainPayload(gatewayChainPayload(), fetchJson);
  const expectedUrls = [CONTRACT, PROVIDER_OFFERING, PRE_OFFERING, MIDDLE_OFFERING, PURPOSE_OFFERING];
  assert.deepStrictEqual([...calls].sort(), [...expectedUrls].sort());

  await routeServiceChainPayload(gatewayChainPayload(), fetchJson);
  assert.equal(calls.length, expectedUrls.length * 2);
});
