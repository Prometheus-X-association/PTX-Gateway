import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plug } from "lucide-react";

const ChooseAnalyticsPageSettingsSection = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose Analytics Page Plugins (Dummy)</CardTitle>
        <CardDescription>
          Placeholder section to install/manage plugins for the Choose Analytics page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">0 plugin config(s)</Badge>
          <Badge variant="outline">Coming soon</Badge>
        </div>
        <div className="rounded-md border p-4 bg-muted/30 text-sm text-muted-foreground">
          <div className="flex items-center gap-2 mb-2">
            <Plug className="h-4 w-4" />
            Choose Analytics page plugin installer is not active yet.
          </div>
          This is a dummy scaffold similar to other plugin sections and can be extended later for JS/CSS bundle uploads.
        </div>
      </CardContent>
    </Card>
  );
};

export default ChooseAnalyticsPageSettingsSection;
