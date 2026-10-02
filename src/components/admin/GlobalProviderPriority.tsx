interface ProviderSummary {
  id: string;
  name: string;
  model: string;
  enabled?: boolean;
}

/** Show inherited defaults directly from the current provider list. */
export function GlobalProviderPriority({ providers }: { providers: ProviderSummary[] }) {
  const enabled = providers.filter((provider) => provider.enabled !== false);
  return (
    <div className="space-y-1 text-[11px] text-muted-foreground">
      <p>Uses the latest saved global providers in this order. Provider edits and priority changes apply on the next request.</p>
      {enabled.length === 0 ? <p>No enabled global providers.</p> : (
        <ol className="list-decimal space-y-0.5 pl-4">
          {enabled.map((provider) => (
            <li key={provider.id}>{provider.name || provider.model || "Provider"}{provider.model && ` (${provider.model})`}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
