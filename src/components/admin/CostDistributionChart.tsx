import type { ReactNode } from "react";
import { Cell, Pie, PieChart } from "recharts";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";

export interface CostDistributionItem { id: string; label: string; costs: Record<string, string | number> }

const COLORS = ["#2563eb", "#7c3aed", "#0891b2", "#059669", "#d97706", "#dc2626", "#db2777"];
const amountLabel = (amount: number, currency: string) => `${amount.toLocaleString(undefined, { minimumFractionDigits: amount < 1 ? 4 : 2, maximumFractionDigits: amount < 1 ? 6 : 2 })} ${currency}`;

export function CostDistributionChart({ title, description, icon, items, currency, workflowNames }: {
  title: string; description: string; icon: ReactNode; items: CostDistributionItem[]; currency: string; workflowNames?: Record<string, string>;
}) {
  const ranked = items.map((item) => ({ id: item.id, name: workflowNames?.[item.id] || item.label, amount: Number(item.costs?.[currency] || 0) }))
    .filter((item) => Number.isFinite(item.amount) && item.amount > 0).sort((a, b) => b.amount - a.amount);
  const visible = ranked.slice(0, 6); const remainder = ranked.slice(6).reduce((sum, item) => sum + item.amount, 0);
  const data = remainder > 0 ? [...visible, { id: "other", name: `Other (${ranked.length - 6})`, amount: remainder }] : visible;
  const total = ranked.reduce((sum, item) => sum + item.amount, 0);

  return <section className="overflow-hidden rounded-xl border bg-gradient-to-br from-background via-background to-muted/30 shadow-sm">
    <div className="flex items-start gap-3 border-b p-4"><div className="rounded-lg bg-primary/10 p-2 text-primary">{icon}</div><div><h4 className="text-sm font-semibold">{title}</h4><p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{description}</p></div></div>
    {data.length ? <div className="grid gap-2 p-4 sm:grid-cols-[minmax(180px,0.9fr)_minmax(190px,1.1fr)] sm:items-center">
      <div className="relative mx-auto w-full max-w-[240px]">
        <ChartContainer config={{ amount: { label: "Cost", color: COLORS[0] } }} className="h-[220px] w-full aspect-auto">
          <PieChart accessibilityLayer>
            <Pie data={data} dataKey="amount" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={2} strokeWidth={0}>
              {data.map((item, index) => <Cell key={item.id} fill={COLORS[index % COLORS.length]} />)}
            </Pie>
            <ChartTooltip cursor={false} content={({ active, payload }) => active && payload?.[0] ? <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-xl"><p className="font-medium">{payload[0].payload.name}</p><p className="mt-1 font-mono text-muted-foreground">{amountLabel(Number(payload[0].value), currency)} · {(Number(payload[0].value) / total * 100).toFixed(1)}%</p></div> : null} />
          </PieChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Total</span><span className="mt-1 max-w-28 truncate text-base font-bold tabular-nums">{amountLabel(total, currency)}</span></div>
      </div>
      <div className="space-y-2.5">{data.map((item, index) => { const percentage = item.amount / total * 100; return <div key={item.id} className="space-y-1"><div className="flex items-center gap-2 text-xs"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} /><span className="min-w-0 flex-1 truncate font-medium" title={item.name}>{item.name}</span><span className="font-mono text-muted-foreground">{percentage.toFixed(1)}%</span></div><div className="ml-[18px] flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${Math.max(2, percentage)}%`, backgroundColor: COLORS[index % COLORS.length] }} /></div><span className="w-24 text-right font-mono text-[10px] text-muted-foreground">{amountLabel(item.amount, currency)}</span></div></div>; })}</div>
    </div> : <div className="flex h-[252px] flex-col items-center justify-center p-6 text-center"><div className="mb-3 h-20 w-20 rounded-full border-[12px] border-muted" /><p className="text-sm font-medium">No valued cost yet</p><p className="mt-1 max-w-56 text-xs text-muted-foreground">This chart will populate when matching usage is recorded for {currency}.</p></div>}
  </section>;
}
