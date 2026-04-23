import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings, Bug, LogOut, Play, Sparkles } from "lucide-react";
import UserMenu from "@/components/UserMenu";
import OrganizationSetup from "@/components/auth/OrganizationSetup";
import { useEffect } from "react";
import { applyVisualizationSettings, getVisualizationSettingsFromOrgSettings } from "@/utils/visualizationSettings";

const DebugModePage = () => {
  const navigate = useNavigate();
  const { user, isAdmin, signOut, toggleDebugMode, refreshAuth } = useAuth();

  useEffect(() => {
    const cleanup = applyVisualizationSettings(
      getVisualizationSettingsFromOrgSettings(user?.organization?.settings)
    );
    return cleanup;
  }, [user?.organization?.settings]);

  const handleOpenAdmin = () => {
    navigate("/admin");
  };

  const getGatewayPath = () => {
    const orgSlug = user?.organization?.slug;
    return orgSlug ? `/${encodeURIComponent(orgSlug)}` : "/";
  };

  const handleOpenGatewayEndUser = async () => {
    if (user?.isDebugMode) {
      await toggleDebugMode();
    }
    navigate(getGatewayPath());
  };

  const handleOpenGatewayDebug = async () => {
    if (!user?.isDebugMode) {
      await toggleDebugMode();
    }
    navigate(getGatewayPath());
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  const handleOrganizationCreated = async () => {
    await refreshAuth();
  };

  // Show organization setup if user doesn't have an organization
  if (!user?.organization) {
    return <OrganizationSetup onComplete={handleOrganizationCreated} />;
  }

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Background Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] opacity-30 pointer-events-none">
        <div className="absolute inset-0" style={{ background: "var(--gradient-glow)" }} />
      </div>

      <div className="relative z-10 container mx-auto px-4 py-8 max-w-2xl">
        {/* Header */}
        <header className="text-center mb-8 relative">
          <div className="absolute top-0 right-0">
            <UserMenu />
          </div>
          
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-6">
            <Bug className="w-4 h-4 text-primary" />
            <span className="text-sm text-primary font-medium">Debug Mode</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mb-2">
            Welcome, {user?.profile?.full_name || 'Admin'}
          </h1>
          <p className="text-muted-foreground">
            You're logged in as an administrator
          </p>
        </header>

        {/* User Info Card */}
        <Card className="glass-card mb-6">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Session Info
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Email</span>
              <span className="text-sm font-medium">{user?.email}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Organization</span>
              <Badge variant="outline">{user?.organization?.name || 'No Organization'}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Role</span>
              <Badge variant="secondary">{user?.role || 'user'}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Debug Mode</span>
              <Badge variant={user?.isDebugMode ? "default" : "outline"}>
                {user?.isDebugMode ? 'Active' : 'Inactive'}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Action Cards */}
        <div className="grid gap-4">
          {isAdmin && (
            <Card className="glass-card hover:border-primary/50 transition-colors cursor-pointer" onClick={handleOpenAdmin}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Settings className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base">Admin Dashboard</CardTitle>
                      <CardDescription className="text-sm">
                        Manage configurations, users, and resources
                      </CardDescription>
                    </div>
                  </div>
                  <Button variant="default" size="sm">
                    Open
                  </Button>
                </div>
              </CardHeader>
            </Card>
          )}

          <Card className="glass-card">
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Play className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Gateway</CardTitle>
                    <CardDescription className="text-sm">
                      Open the current organization gateway as an end user or with admin debug tools.
                    </CardDescription>
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button variant="outline" size="sm" onClick={() => void handleOpenGatewayEndUser()}>
                    End User View
                  </Button>
                  <Button variant="default" size="sm" onClick={() => void handleOpenGatewayDebug()}>
                    Debug View
                  </Button>
                </div>
              </div>
            </CardHeader>
          </Card>

          <Card className="glass-card hover:border-destructive/50 transition-colors cursor-pointer" onClick={handleSignOut}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center">
                    <LogOut className="h-5 w-5 text-destructive" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Sign Out</CardTitle>
                    <CardDescription className="text-sm">
                      End your session and return to login
                    </CardDescription>
                  </div>
                </div>
                <Button variant="ghost" size="sm">
                  Sign Out
                </Button>
              </div>
            </CardHeader>
          </Card>
        </div>

        {/* Footer */}
        <footer className="text-center mt-8 text-sm text-muted-foreground">
          <p>Debug mode provides access to configuration and validation features</p>
        </footer>
      </div>
    </div>
  );
};

export default DebugModePage;
