export interface ContractChainService {
  participant?: string;
  service?: string;
  params?: string;
  configuration?: string;
  pre?: unknown[];
}

/** Expand arbitrarily nested prerequisite groups into dependency-first order. */
export const flattenChainServices = (services: ContractChainService[]): ContractChainService[] => {
  const flattened: ContractChainService[] = [];
  const visited = new Set<string>();

  const visitPrerequisites = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visitPrerequisites);
      return;
    }
    if (!value || typeof value !== "object") return;

    const candidate = value as ContractChainService;
    visitPrerequisites(candidate.pre);
    if (!candidate.service) return;
    const key = `${candidate.participant || ""}::${candidate.service}::${candidate.params || ""}`;
    if (visited.has(key)) return;
    visited.add(key);
    flattened.push(candidate);
  };

  services.forEach((service) => {
    visitPrerequisites(service.pre);
    if (!service.service) return;
    const key = `${service.participant || ""}::${service.service}::${service.params || ""}`;
    if (visited.has(key)) return;
    visited.add(key);
    flattened.push(service);
  });

  return flattened;
};
