import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { workflowBackend, type WorkflowBackendHealth } from "@/lib/workflowBackend";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function AdminOverview({ onNavigate }: { onNavigate: (section: string) => void }) {
  const { user } = useAuth();
  const organizationId = user?.organization?.id;
  const health = useQuery({
    queryKey: ["admin-workflow-health", user?.id, organizationId],
    enabled: Boolean(organizationId),
    queryFn: async () => (await workflowBackend("health", organizationId)).health as WorkflowBackendHealth,
    refetchInterval: 15000,
  });
  return <div className="space-y-6">
    <Card><CardHeader><CardTitle>Organization overview</CardTitle><CardDescription>Operate your agents and preview the applications they power.</CardDescription></CardHeader>
      <CardContent className="flex flex-wrap gap-3"><Button onClick={() => onNavigate("llm")}>Open orchestration</Button><Button variant="outline" onClick={() => onNavigate("applications")}>Preview an application</Button></CardContent>
    </Card>
    {health.isPending && organizationId && <p role="status">Loading workflow health…</p>}
    {health.error && <div role="alert" className="rounded-lg border p-4 text-destructive">Workflow health unavailable: {health.error.message} <Button variant="outline" onClick={() => void health.refetch()}>Retry</Button></div>}
    {health.data && <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[["Workers", health.data.workers.length], ["Queued runs", health.data.queueDepth], ["Running", health.data.runningRuns], ["Waiting", health.data.waitingRuns]].map(([label, value]) => <Card key={label}><CardHeader><CardDescription>{label}</CardDescription><CardTitle className="text-3xl">{value}</CardTitle></CardHeader></Card>)}
      </div>
      {health.data.workers.length === 0 && <p className="rounded-lg border p-4" role="status">No active workflow workers. Accepted runs will remain queued until a worker is available.</p>}
      <p className="text-sm text-muted-foreground">Manual review: {health.data.manualReviewRuns} · Expired leases: {health.data.expiredLeases} · Pending notifications: {health.data.notificationBacklog}</p>
    </>}
    <Card><CardHeader><CardTitle>Dataspace integrations</CardTitle><CardDescription>PDC configuration and resources remain available for your existing gateway and workflow integrations.</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-3"><Button variant="outline" onClick={() => onNavigate("pdc")}>PDC Configuration</Button><Button variant="outline" onClick={() => onNavigate("resources")}>Resources</Button></CardContent></Card>
  </div>;
}
