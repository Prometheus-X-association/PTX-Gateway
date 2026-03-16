import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Users, UserPlus, Mail, Trash2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AppRole } from "@/types/auth";

interface OrgMember {
  id: string;
  user_id: string;
  status: string;
  email?: string;
  full_name?: string;
  role?: AppRole;
}

interface OrgInvitation {
  id: string;
  email: string;
  role: AppRole;
  status: string;
  created_at: string;
  expires_at: string;
}

const UsersManagementSection = () => {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invitations, setInvitations] = useState<OrgInvitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("user");
  const [isInviting, setIsInviting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [resendingInvitationId, setResendingInvitationId] = useState<string | null>(null);
  const [isInvitationStoreReady, setIsInvitationStoreReady] = useState(true);

  const isInvitationStoreMissing = (err: unknown) => {
    const msg = String((err as { message?: string })?.message || "").toLowerCase();
    const code = String((err as { code?: string })?.code || "").toLowerCase();
    return (
      msg.includes("organization_invitations") ||
      msg.includes("does not exist") ||
      code === "42p01" ||
      code.startsWith("pgrst")
    );
  };

  const formatInviteError = (err: unknown) => {
    const message = err instanceof Error ? err.message : "Failed to send invitation";
    if (
      /edge function/i.test(message) ||
      /Failed to fetch/i.test(message) ||
      /network/i.test(message)
    ) {
      return "Failed to connect to Edge Function. Deploy 'invite-org-user' and verify VITE_SUPABASE_URL / key.";
    }
    return message;
  };

  const formatSentAgo = (createdAt: string) => {
    const sentAt = new Date(createdAt).getTime();
    const now = Date.now();
    const diffSeconds = Math.max(0, Math.floor((now - sentAt) / 1000));

    if (diffSeconds < 60) return `${diffSeconds}s ago`;
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
    if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
    return `${Math.floor(diffSeconds / 86400)}d ago`;
  };

  const sendInvitation = async (email: string, role: AppRole) => {
    if (!user?.organization?.id) {
      throw new Error("No active organization selected");
    }

    const { data, error } = await supabase.functions.invoke("invite-org-user", {
      body: {
        organization_id: user.organization.id,
        email,
        role,
        redirect_to: `${window.location.origin}/`,
      },
    });

    if (error) throw new Error(error.message);
    if (!data?.ok) throw new Error(data?.error || "Failed to send invitation");
  };

  const fetchMembers = async () => {
    if (!user?.organization?.id) return;

    setIsLoading(true);
    try {
      // Fetch members
      const { data: membersData, error: membersError } = await supabase
        .from('organization_members')
        .select('id, user_id, status')
        .eq('organization_id', user.organization.id);

      if (membersError) throw membersError;

      // Fetch profiles and roles for each member
      const enrichedMembers = await Promise.all(
        (membersData || []).map(async (member) => {
          const [profileResult, roleResult] = await Promise.all([
            supabase.from('profiles').select('email, full_name').eq('user_id', member.user_id).single(),
            supabase.from('user_roles').select('role').eq('user_id', member.user_id).eq('organization_id', user.organization!.id).single(),
          ]);

          return {
            ...member,
            email: profileResult.data?.email,
            full_name: profileResult.data?.full_name,
            role: roleResult.data?.role as AppRole | undefined,
          };
        })
      );

      setMembers(enrichedMembers);

      const { data: invitationData, error: invitationError } = await supabase
        .from("organization_invitations")
        .select("id, email, role, status, created_at, expires_at")
        .eq("organization_id", user.organization.id)
        .order("created_at", { ascending: false });

      if (invitationError) {
        if (isInvitationStoreMissing(invitationError)) {
          setIsInvitationStoreReady(false);
          setInvitations([]);
        } else {
          throw invitationError;
        }
      } else {
        setIsInvitationStoreReady(true);
        setInvitations((invitationData || []) as OrgInvitation[]);
      }
    } catch (err) {
      toast.error("Failed to load users");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, [user?.organization?.id]);

  // Server-side admin verification for defense-in-depth
  // Uses auth.uid() on server-side to prevent information leakage
  const verifyAdminAccess = async (): Promise<boolean> => {
    if (!user?.organization?.id) return false;
    
    const { data, error } = await supabase.rpc('verify_admin_access', {
      _organization_id: user.organization.id,
    });
    
    if (error || !data) {
      toast.error("Unauthorized: Admin access required");
      return false;
    }
    return true;
  };

  const handleRoleChange = async (memberId: string, userId: string, newRole: AppRole) => {
    try {
      // Server-side verification before critical operation
      if (!(await verifyAdminAccess())) return;

      const { error } = await supabase
        .from('user_roles')
        .upsert({
          user_id: userId,
          organization_id: user?.organization?.id,
          role: newRole,
        });

      if (error) throw error;
      
      toast.success("Role updated");
      await fetchMembers();
    } catch (err) {
      toast.error("Failed to update role");
    }
  };

  const handleRemoveMember = async (memberId: string, userId: string) => {
    if (userId === user?.id) {
      toast.error("You cannot remove yourself");
      return;
    }

    try {
      // Server-side verification before critical operation
      if (!(await verifyAdminAccess())) return;

      await supabase.from('user_roles').delete().eq('user_id', userId).eq('organization_id', user?.organization?.id);
      await supabase.from('organization_members').delete().eq('id', memberId);
      
      toast.success("Member removed");
      await fetchMembers();
    } catch (err) {
      toast.error("Failed to remove member");
    }
  };

  const handleInvite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      toast.error("Email is required");
      return;
    }

    setIsInviting(true);
    try {
      await sendInvitation(email, inviteRole);

      toast.success(`Invitation sent to ${email}`);
      setInviteEmail("");
      setInviteRole("user");
      setIsDialogOpen(false);
      await fetchMembers();
    } catch (err) {
      toast.error(formatInviteError(err));
    } finally {
      setIsInviting(false);
    }
  };

  const handleResendInvitation = async (invitation: OrgInvitation) => {
    setResendingInvitationId(invitation.id);
    try {
      await sendInvitation(invitation.email, invitation.role);
      toast.success(`Invitation resent to ${invitation.email}`);
      await fetchMembers();
    } catch (err) {
      toast.error(formatInviteError(err));
    } finally {
      setResendingInvitationId(null);
    }
  };

  const getRoleBadgeVariant = (role?: AppRole) => {
    switch (role) {
      case 'super_admin': return 'destructive';
      case 'admin': return 'default';
      default: return 'secondary';
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              User Management
            </CardTitle>
            <CardDescription>
              Manage organization members and their roles
            </CardDescription>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <UserPlus className="h-4 w-4 mr-2" />
                Invite User
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite User</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    placeholder="user@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as AppRole)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="super_admin">Super Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleInvite} disabled={isInviting} className="w-full">
                  {isInviting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Mail className="h-4 w-4 mr-2" />
                      Send Invitation
                    </>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-8">
          <h4 className="text-sm font-medium mb-3">Organization Members</h4>
        
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <TableRow key={member.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-sm font-medium text-primary">
                        {(member.full_name || member.email || '?')[0].toUpperCase()}
                      </span>
                    </div>
                    <span>{member.full_name || 'No name'}</span>
                    {member.user_id === user?.id && (
                      <Badge variant="outline" className="text-xs">You</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>{member.email || '-'}</TableCell>
                <TableCell>
                  <Badge variant={member.status === 'active' ? 'default' : 'secondary'}>
                    {member.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Select
                    value={member.role || 'user'}
                    onValueChange={(v) => handleRoleChange(member.id, member.user_id, v as AppRole)}
                    disabled={member.user_id === user?.id}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="super_admin">Super Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveMember(member.id, member.user_id)}
                    disabled={member.user_id === user?.id}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>

        <div>
          <h4 className="text-sm font-medium mb-3">Invitations</h4>
          {!isInvitationStoreReady && (
            <p className="text-xs text-amber-600 mb-3">
              Invitations storage is not available yet. Run latest Supabase migration to enable invitations list and resend.
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="w-28">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No invitations yet.
                  </TableCell>
                </TableRow>
              ) : (
                invitations.map((invitation) => {
                  const isResending = resendingInvitationId === invitation.id;
                  const canResend = invitation.status !== "accepted" && invitation.status !== "revoked";

                  return (
                    <TableRow key={invitation.id}>
                      <TableCell>{invitation.email}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{invitation.role}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={invitation.status === "accepted" ? "default" : "secondary"}>
                          {invitation.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatSentAgo(invitation.created_at)}</TableCell>
                      <TableCell>{new Date(invitation.expires_at).toLocaleString()}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleResendInvitation(invitation)}
                          disabled={!canResend || isResending || !isInvitationStoreReady}
                        >
                          {isResending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};

export default UsersManagementSection;
