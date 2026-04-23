import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNavigate } from "react-router-dom";
import { LogOut, Settings, User, Bug, BugOff, KeyRound, Building2, Plus, Check, LogOutIcon, Loader2, ExternalLink, Home } from "lucide-react";
import ChangePasswordDialog from "./ChangePasswordDialog";
import { toast } from "sonner";

const UserMenu = () => {
  const { user, isAuthenticated, isAdmin, signOut, toggleDebugMode, createOrganization, switchOrganization, leaveOrganization, refreshAuth } = useAuth();
  const navigate = useNavigate();
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [showCreateOrgDialog, setShowCreateOrgDialog] = useState(false);
  const [showLeaveOrgDialog, setShowLeaveOrgDialog] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  if (!isAuthenticated || !user) {
    return null;
  }

  const initials = (user.profile?.full_name || user.email || 'U')
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const handleNameChange = (value: string) => {
    setOrgName(value);
  };

  const handleCreateOrg = async () => {
    if (!orgName.trim()) {
      toast.error("Name is required");
      return;
    }
    setIsCreating(true);
    const slug = crypto.randomUUID();
    const { error } = await createOrganization(orgName.trim(), slug);
    if (error) {
      toast.error(error.message || "Failed to create organization");
    } else {
      toast.success("Organization created!");
      setShowCreateOrgDialog(false);
      setOrgName("");
    }
    setIsCreating(false);
  };

  const handleSwitchOrg = async (orgId: string) => {
    if (orgId === user.organization?.id) return;
    await switchOrganization(orgId);
    toast.success("Switched organization");
    // Navigate to debug page to reflect new context
    navigate("/debug");
  };

  const handleLeaveOrg = async () => {
    if (!showLeaveOrgDialog) return;
    setIsLeaving(true);
    const { error } = await leaveOrganization(showLeaveOrgDialog);
    if (error) {
      toast.error(error.message || "Failed to leave organization");
    } else {
      toast.success("Left organization");
      setShowLeaveOrgDialog(null);
    }
    setIsLeaving(false);
  };

  const handleOpenGateway = () => {
    const orgSlug = user.organization?.slug;
    if (!orgSlug) {
      toast.error("No active organization gateway is available");
      return;
    }

    navigate(`/${encodeURIComponent(orgSlug)}`);
  };

  const leaveOrgName = user.organizations.find(m => m.organization.id === showLeaveOrgDialog)?.organization.name;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="relative h-9 w-9 rounded-full">
            <Avatar className="h-9 w-9">
              <AvatarFallback className="bg-primary/10 text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64" align="end">
          <div className="flex items-center justify-start gap-2 p-2">
            <div className="flex flex-col space-y-1 leading-none">
              <p className="font-medium">{user.profile?.full_name || 'User'}</p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
              {user.organization && (
                <Badge variant="outline" className="mt-1 w-fit text-xs">
                  {user.organization.name}
                </Badge>
              )}
            </div>
          </div>
          <DropdownMenuSeparator />

          {/* Organization Switcher */}
          {user.organizations.length > 0 && (
            <>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Building2 className="mr-2 h-4 w-4" />
                  Organizations
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Switch Organization
                  </DropdownMenuLabel>
                  {user.organizations.map((membership) => (
                    <DropdownMenuItem
                      key={membership.organization.id}
                      onClick={() => handleSwitchOrg(membership.organization.id)}
                      className="flex items-center justify-between"
                    >
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="truncate text-sm">{membership.organization.name}</span>
                        <span className="text-xs text-muted-foreground">{membership.role || 'member'}</span>
                      </div>
                      {membership.organization.id === user.organization?.id && (
                        <Check className="h-4 w-4 text-primary ml-2 shrink-0" />
                      )}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setShowCreateOrgDialog(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Organization
                  </DropdownMenuItem>
                  {user.organizations.length > 1 && user.organization && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setShowLeaveOrgDialog(user.organization!.id)}
                        className="text-destructive focus:text-destructive"
                      >
                        <LogOutIcon className="mr-2 h-4 w-4" />
                        Leave {user.organization.name}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
            </>
          )}

          {isAdmin && (
            <>
              <DropdownMenuItem onClick={() => navigate('/admin')}>
                <Settings className="mr-2 h-4 w-4" />
                Admin Dashboard
              </DropdownMenuItem>
              <DropdownMenuItem onClick={toggleDebugMode}>
                {user.isDebugMode ? (
                  <>
                    <BugOff className="mr-2 h-4 w-4" />
                    Disable Debug Mode
                  </>
                ) : (
                  <>
                    <Bug className="mr-2 h-4 w-4" />
                    Enable Debug Mode
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onClick={handleOpenGateway} disabled={!user.organization?.slug}>
            <ExternalLink className="mr-2 h-4 w-4" />
            Open Gateway
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate('/')}>
            <Home className="mr-2 h-4 w-4" />
            Home Page
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShowPasswordDialog(true)}>
            <KeyRound className="mr-2 h-4 w-4" />
            Change Password
          </DropdownMenuItem>
          <DropdownMenuItem onClick={signOut}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ChangePasswordDialog
        open={showPasswordDialog}
        onOpenChange={setShowPasswordDialog}
      />

      {/* Create Organization Dialog */}
      <Dialog open={showCreateOrgDialog} onOpenChange={setShowCreateOrgDialog}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Create Organization</DialogTitle>
            <DialogDescription>
              Create a new organization. You'll be the super admin.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Organization Name</Label>
              <Input
                placeholder="Acme Corporation"
                value={orgName}
                onChange={(e) => handleNameChange(e.target.value)}
                disabled={isCreating}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              A unique gateway URL will be automatically generated.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateOrgDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateOrg} disabled={isCreating}>
              {isCreating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Leave Organization Dialog */}
      <Dialog open={!!showLeaveOrgDialog} onOpenChange={() => setShowLeaveOrgDialog(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Leave Organization</DialogTitle>
            <DialogDescription>
              Are you sure you want to leave <strong>{leaveOrgName}</strong>? You'll lose access to its resources and settings.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLeaveOrgDialog(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleLeaveOrg} disabled={isLeaving}>
              {isLeaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Leave Organization
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default UserMenu;
