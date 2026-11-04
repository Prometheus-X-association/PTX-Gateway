// Routes PDC /exchange payload entries for service chains.
//
// When serviceChainId is set the connector ignores resourceId/purposeId and:
// - requires every `resources` entry to be a dataResource of services[0]
// - requires every `purposes` entry to be a softwareResource of services[last]
// - feeds every other chain node (middle steps and pre branches) only from
//   `serviceChainParams`, matched by exact resource URL.
// Each `resources` entry starts its own chain run, so inputs that meet at one
// node must live in a pre branch and travel through serviceChainParams.

export interface PdcResourceEntry {
  resource: string;
  params?: { query: Array<Record<string, string>> };
}

export interface PdcExchangePayload {
  contract: string;
  purposeId?: string;
  resourceId?: string;
  serviceChainId?: string;
  resources: PdcResourceEntry[];
  purposes: PdcResourceEntry[];
  serviceChainParams?: PdcResourceEntry[];
}

export type FetchJson = (url: string) => Promise<unknown>;

export class ServiceChainPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceChainPayloadError";
  }
}

interface ChainNode {
  service?: string;
  participant?: string;
  params?: unknown;
  pre?: unknown;
}

interface OfferingResources {
  dataResources: Set<string>;
  softwareResources: Set<string>;
}

const asUrlList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** Wraps fetchJson so each URL is requested at most once per routing call. */
const createCachedFetch = (fetchJson: FetchJson): FetchJson => {
  const cache = new Map<string, Promise<unknown>>();
  return (url) => {
    let pending = cache.get(url);
    if (!pending) {
      pending = fetchJson(url);
      cache.set(url, pending);
    }
    return pending;
  };
};

/** services[0], then for each step its pre entries (recursively) followed by the step, down to services[last]. */
const orderChainServiceUrls = (services: ChainNode[]): string[] => {
  const ordered: string[] = [];

  const visitPre = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visitPre);
      return;
    }
    if (!value || typeof value !== "object") return;
    const node = value as ChainNode;
    visitPre(node.pre);
    if (node.service) ordered.push(node.service);
  };

  services.forEach((step) => {
    visitPre(step.pre);
    if (step.service) ordered.push(step.service);
  });

  return ordered;
};

const hasParams = (entry: PdcResourceEntry): boolean => (entry.params?.query?.length ?? 0) > 0;

const toEntry = (entry: PdcResourceEntry): PdcResourceEntry =>
  hasParams(entry) ? { resource: entry.resource, params: entry.params } : { resource: entry.resource };

/**
 * Returns the payload to POST to the connector. Payloads without serviceChainId
 * are returned untouched; chain payloads are re-routed using the contract and
 * the catalog service offerings of the chain.
 */
export const routeServiceChainPayload = async (
  payload: PdcExchangePayload,
  fetchJson: FetchJson
): Promise<PdcExchangePayload> => {
  if (!payload.serviceChainId) return payload;

  const serviceChainId = payload.serviceChainId;
  const cachedFetch = createCachedFetch(fetchJson);

  const contract = (await cachedFetch(payload.contract)) as { serviceChains?: Array<{ catalogId?: string; services?: ChainNode[] }> };
  const chain = (contract?.serviceChains ?? []).find((candidate) => candidate.catalogId === serviceChainId);
  if (!chain) {
    throw new ServiceChainPayloadError(
      `Service chain ${serviceChainId} not found in contract ${payload.contract}`
    );
  }

  const steps = (chain.services ?? []).filter((step) => !!step?.service);
  if (steps.length === 0) {
    throw new ServiceChainPayloadError(`Service chain ${serviceChainId} has no services`);
  }

  const firstServiceUrl = steps[0].service as string;
  const lastServiceUrl = steps[steps.length - 1].service as string;
  const orderedServiceUrls = orderChainServiceUrls(steps);
  const uniqueServiceUrls = [...new Set(orderedServiceUrls)];

  const offerings = new Map<string, OfferingResources>();
  await Promise.all(
    uniqueServiceUrls.map(async (serviceUrl) => {
      const offering = (await cachedFetch(serviceUrl)) as { dataResources?: unknown; softwareResources?: unknown };
      offerings.set(serviceUrl, {
        dataResources: new Set(asUrlList(offering?.dataResources)),
        softwareResources: new Set(asUrlList(offering?.softwareResources)),
      });
    })
  );

  // Position of the first chain node that owns a resource; used to keep a stable chain order.
  const chainPosition = (resourceUrl: string): number =>
    orderedServiceUrls.findIndex((serviceUrl) => {
      const offering = offerings.get(serviceUrl);
      return !!offering && (offering.dataResources.has(resourceUrl) || offering.softwareResources.has(resourceUrl));
    });

  // Collect every entry the caller sent, regardless of which array it was in.
  // When a resource is listed twice, the entry that carries params wins.
  const entriesByResource = new Map<string, PdcResourceEntry>();
  [...payload.resources, ...payload.purposes, ...(payload.serviceChainParams ?? [])].forEach((entry) => {
    if (!entry?.resource) return;
    const existing = entriesByResource.get(entry.resource);
    if (!existing || (!hasParams(existing) && hasParams(entry))) {
      entriesByResource.set(entry.resource, entry);
    }
  });

  const firstOffering = offerings.get(firstServiceUrl) as OfferingResources;
  const lastOffering = offerings.get(lastServiceUrl) as OfferingResources;

  const routed = [...entriesByResource.values()].map((entry) => {
    const position = chainPosition(entry.resource);
    if (position < 0) {
      throw new ServiceChainPayloadError(
        `Resource ${entry.resource} does not belong to any service of service chain ${serviceChainId}`
      );
    }
    const target = firstOffering.dataResources.has(entry.resource)
      ? "resources"
      : lastOffering.softwareResources.has(entry.resource)
        ? "purposes"
        : "serviceChainParams";
    return { entry, position, target };
  });

  const pick = (target: string, dropWithoutParams = false): PdcResourceEntry[] =>
    routed
      .filter((item) => item.target === target && (!dropWithoutParams || hasParams(item.entry)))
      .sort((a, b) => a.position - b.position)
      .map((item) => toEntry(item.entry));

  const result: PdcExchangePayload = {
    contract: payload.contract,
    serviceChainId,
    resources: pick("resources"),
    purposes: pick("purposes"),
  };

  const serviceChainParams = pick("serviceChainParams", true);
  if (serviceChainParams.length > 0) {
    result.serviceChainParams = serviceChainParams;
  }

  return result;
};
