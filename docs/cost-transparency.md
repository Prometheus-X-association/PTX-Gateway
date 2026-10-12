# Cost transparency and calculation governance

The cost subsystem records usage facts separately from their monetary valuation. It covers browser and backend workflow runs, direct agents, inline/saved agent nodes, LLM requests, MCP tool calls, API nodes, fixed node charges, and allocated subscription periods.

## Deployment

1. Apply `supabase/migrations/20261012110000_cost_transparency.sql`.
2. Configure `COST_EXECUTION_SECRET` for Edge Functions, or use the existing shared `WORKFLOW_INTERNAL_SECRET` fallback.
3. Deploy `cost-control`, `chat-with-result`, and `workflow-api-request`, plus the updated workflow worker and frontend.
4. Open **Admin → Agent Operations → Providers & MCP** and use the **Cost** action on any LLM provider or MCP server for ordinary pricing. Use **Costs & Usage** for advanced policies, simulation, reporting, and audit history.

The LLM provider list includes disabled OpenAI GPT, Anthropic Claude, and Google Gemini demo imports. They intentionally contain no API keys and must be reviewed before enabling. Their cost dialogs also include illustrative pricing presets; these are test data, not maintained vendor price quotes.

## Calculation lifecycle

- Draft formulas are safe JSON expression trees; arbitrary code is never evaluated.
- Simulation validates formulas and shows their inputs and calculation breakdown.
- Publishing makes a version immutable and records the actor, timestamp, reason, and before/after state.
- A new draft may be based on any historical version, which provides an auditable rollback path without rewriting history.
- Assignments select policies by precedence: workflow node, API node, MCP tool, LLM model, agent, workflow, provider/server, then organization.
- Retiring an assignment or archiving a policy is recorded without deleting historical usage or valuations.

## Reporting and reconciliation

The dashboard shows exact decimal totals by currency and provider/source. Execution drill-down shows each node's cost and the underlying usage and valuation records. Inclusive node policies replace child/provider valuations in rollups; additive policies remain separate.

Budgets and subscription periods are administered in the same view. Subscription amounts are allocated with fixed-decimal arithmetic, with any rounding remainder assigned deterministically so allocations equal the original amount. Provider invoices can be recorded as reconciled valuations without replacing the original estimate.
