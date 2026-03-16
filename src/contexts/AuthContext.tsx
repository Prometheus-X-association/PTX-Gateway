import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { User, Session } from "@supabase/supabase-js";
import { AuthUser, AuthState, AppRole, Organization, Profile, OrgMembership } from "@/types/auth";

const ACTIVE_ORG_KEY = "pdc_active_org_id";

interface AuthContextType extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  toggleDebugMode: () => Promise<void>;
  createOrganization: (name: string, slug: string) => Promise<{ error: Error | null; organizationId?: string }>;
  updateOrganization: (orgId: string, name: string, slug: string, description?: string | null) => Promise<{ error: Error | null }>;
  deleteOrganization: (orgId: string) => Promise<{ error: Error | null }>;
  switchOrganization: (organizationId: string) => Promise<void>;
  leaveOrganization: (organizationId: string) => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextType | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  const fetchUserDetails = useCallback(async (authUser: User): Promise<AuthUser> => {
    // Auto-accept pending org invitations for the signed-in email.
    // This makes invite links work for both new and existing users.
    await supabase.rpc('accept_my_pending_invitations');

    // Fetch profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', authUser.id)
      .single();

    // Fetch ALL organization memberships
    const { data: memberships } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', authUser.id)
      .eq('status', 'active');

    const orgMemberships: OrgMembership[] = [];

    if (memberships && memberships.length > 0) {
      const orgIds = memberships.map(m => m.organization_id);

      // Fetch all organizations
      const { data: orgs } = await supabase
        .from('organizations')
        .select('*')
        .in('id', orgIds);

      // Fetch all roles
      const { data: roles } = await supabase
        .from('user_roles')
        .select('organization_id, role')
        .eq('user_id', authUser.id)
        .in('organization_id', orgIds);

      if (orgs) {
        for (const org of orgs) {
          const userRole = roles?.find(r => r.organization_id === org.id);
          orgMemberships.push({
            organization: org as Organization,
            role: (userRole?.role as AppRole) || null,
          });
        }
      }
    }

    // Determine active organization
    const savedActiveOrgId = localStorage.getItem(ACTIVE_ORG_KEY);
    let activeOrg: OrgMembership | undefined;

    if (savedActiveOrgId) {
      activeOrg = orgMemberships.find(m => m.organization.id === savedActiveOrgId);
    }
    if (!activeOrg && orgMemberships.length > 0) {
      activeOrg = orgMemberships[0];
    }

    // Persist active org
    if (activeOrg) {
      localStorage.setItem(ACTIVE_ORG_KEY, activeOrg.organization.id);
    }

    // Fetch debug session for active org
    let isDebugMode = false;
    if (activeOrg) {
      const { data: debugSession } = await supabase
        .from('debug_sessions')
        .select('*')
        .eq('user_id', authUser.id)
        .eq('organization_id', activeOrg.organization.id)
        .eq('is_active', true)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      isDebugMode = !!debugSession;
    }

    return {
      id: authUser.id,
      email: authUser.email || '',
      profile: profile as Profile | null,
      organization: activeOrg?.organization || null,
      organizations: orgMemberships,
      role: activeOrg?.role || null,
      isDebugMode,
    };
  }, []);

  const loadUser = useCallback(async (authUser: User | null) => {
    if (!authUser) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    try {
      // Validate persisted session user against auth service.
      // After local DB resets, stale JWTs may still exist in localStorage.
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        await supabase.auth.signOut();
        localStorage.removeItem(ACTIVE_ORG_KEY);
        setSession(null);
        setUser(null);
        setIsLoading(false);
        return;
      }

      const userDetails = await fetchUserDetails(userData.user);
      setUser(userDetails);
    } catch (error) {
      console.error('Error loading user details:', error);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, [fetchUserDetails]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);

        if (event === 'SIGNED_OUT') {
          setUser(null);
          localStorage.removeItem(ACTIVE_ORG_KEY);
          setIsLoading(false);
        } else if (session?.user) {
          setTimeout(() => loadUser(session.user), 0);
        } else {
          setIsLoading(false);
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        loadUser(session.user);
      } else {
        setIsLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [loadUser]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signUp = async (email: string, password: string, fullName?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: fullName },
      },
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem(ACTIVE_ORG_KEY);
    setUser(null);
  };

  const refreshAuth = async () => {
    if (session?.user) {
      await loadUser(session.user);
    }
  };

  const switchOrganization = async (organizationId: string) => {
    localStorage.setItem(ACTIVE_ORG_KEY, organizationId);
    if (session?.user) {
      await loadUser(session.user);
    }
  };

  const leaveOrganization = async (organizationId: string) => {
    if (!user) return { error: new Error('Not authenticated') };

    try {
      // Cannot leave if you're the only super_admin
      const { data: superAdmins } = await supabase
        .from('user_roles')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('role', 'super_admin');

      const userRoleInOrg = user.organizations.find(m => m.organization.id === organizationId)?.role;
      if (userRoleInOrg === 'super_admin' && superAdmins && superAdmins.length <= 1) {
        return { error: new Error('Cannot leave: you are the only super admin. Transfer ownership first.') };
      }

      // Delete role
      await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', user.id)
        .eq('organization_id', organizationId);

      // Delete membership
      await supabase
        .from('organization_members')
        .delete()
        .eq('user_id', user.id)
        .eq('organization_id', organizationId);

      // If leaving active org, switch to another
      if (user.organization?.id === organizationId) {
        const remaining = user.organizations.filter(m => m.organization.id !== organizationId);
        if (remaining.length > 0) {
          localStorage.setItem(ACTIVE_ORG_KEY, remaining[0].organization.id);
        } else {
          localStorage.removeItem(ACTIVE_ORG_KEY);
        }
      }

      await refreshAuth();
      return { error: null };
    } catch (err) {
      return { error: err as Error };
    }
  };

  const toggleDebugMode = async () => {
    if (!user?.organization?.id) return;

    const existingSession = await supabase
      .from('debug_sessions')
      .select('*')
      .eq('user_id', user.id)
      .eq('organization_id', user.organization.id)
      .single();

    if (existingSession.data) {
      await supabase
        .from('debug_sessions')
        .update({
          is_active: !existingSession.data.is_active,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        })
        .eq('id', existingSession.data.id);
    } else {
      await supabase
        .from('debug_sessions')
        .insert({
          user_id: user.id,
          organization_id: user.organization.id,
          is_active: true,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });
    }

    await refreshAuth();
  };

  const createOrganization = async (name: string, slug: string) => {
    if (!session?.user) {
      return { error: new Error('Not authenticated') };
    }

    try {
      const { data, error } = await supabase.rpc('create_organization_with_admin', {
        _org_name: name,
        _org_slug: slug,
        _user_id: session.user.id,
      });

      if (error) {
        return { error: error as Error };
      }

      // Switch to the new org
      const newOrgId = data as string;
      localStorage.setItem(ACTIVE_ORG_KEY, newOrgId);

      await refreshAuth();
      return { error: null, organizationId: newOrgId };
    } catch (err) {
      return { error: err as Error };
    }
  };

  const updateOrganization = async (orgId: string, name: string, slug: string, description?: string | null) => {
    try {
      const { error } = await supabase.rpc('update_organization', {
        _org_id: orgId,
        _name: name,
        _slug: slug,
        _description: description || null,
      });
      if (error) return { error: error as unknown as Error };
      await refreshAuth();
      return { error: null };
    } catch (err) {
      return { error: err as Error };
    }
  };

  const deleteOrganization = async (orgId: string) => {
    try {
      const { error } = await supabase.rpc('delete_organization', {
        _org_id: orgId,
      });
      if (error) return { error: error as unknown as Error };
      localStorage.removeItem(ACTIVE_ORG_KEY);
      await refreshAuth();
      return { error: null };
    } catch (err) {
      return { error: err as Error };
    }
  };

  const isAuthenticated = !!user;
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const isSuperAdmin = user?.role === 'super_admin';

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated,
        isAdmin,
        isSuperAdmin,
        signIn,
        signUp,
        signOut,
        refreshAuth,
        toggleDebugMode,
        createOrganization,
        updateOrganization,
        deleteOrganization,
        switchOrganization,
        leaveOrganization,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;
