import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, Building2 } from "lucide-react";

interface OrganizationSetupProps {
  onComplete: () => void;
}

const OrganizationSetup = ({ onComplete }: OrganizationSetupProps) => {
  const { createOrganization } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [orgSlug] = useState(() => crypto.randomUUID());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!orgName.trim()) {
      toast.error("Organization name is required");
      return;
    }

    setIsLoading(true);

    const { error } = await createOrganization(orgName.trim(), orgSlug.trim());

    if (error) {
      toast.error(error.message || "Failed to create organization");
    } else {
      toast.success("Organization created successfully!");
      onComplete();
    }

    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {/* Background Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] opacity-30 pointer-events-none">
        <div className="absolute inset-0" style={{ background: "var(--gradient-glow)" }} />
      </div>

      <Card className="w-full max-w-md relative z-10 glass-card">
        <CardHeader className="text-center">
          <div className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-4 mx-auto">
            <Building2 className="w-4 h-4 text-primary" />
            <span className="text-sm text-primary font-medium">Setup</span>
          </div>
          <CardTitle className="text-2xl">Create Your Organization</CardTitle>
          <CardDescription>
            Set up your organization to start using the PDC Gateway
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="org-name">Organization Name</Label>
              <Input
                id="org-name"
                type="text"
                placeholder="Acme Corporation"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              A unique gateway URL will be automatically generated for your organization.
            </p>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating organization...
                </>
              ) : (
                "Create Organization"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default OrganizationSetup;
