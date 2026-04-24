// Authentication and Authorization Types

export type AppRole = 'super_admin' | 'admin' | 'user';

export type VisualizationType = 'upload_document' | 'manual_json_input' | 'data_api';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface OrgMembership {
  organization: Organization;
  role: AppRole | null;
}

export interface Profile {
  id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRole {
  id: string;
  user_id: string;
  organization_id: string;
  role: AppRole;
  created_at: string;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  invited_by: string | null;
  status: 'pending' | 'active' | 'suspended';
  created_at: string;
}

export interface DebugSession {
  id: string;
  user_id: string;
  organization_id: string;
  is_active: boolean;
  expires_at: string;
  created_at: string;
}

export interface GlobalConfig {
  id: string;
  organization_id: string;
  app_name: string;
  app_version: string;
  environment: 'development' | 'staging' | 'production';
  features: {
    enableFileUpload: boolean;
    enableApiConnections: boolean;
    enableTextInput: boolean;
    enableCustomApi: boolean;
    allowContinueOnPdcError: boolean;
    llmInsights: {
      enabled: boolean;
      provider: 'openai' | 'custom';
      apiBaseUrl: string;
      apiKey: string;
      model: string;
      promptTemplate: string;
    };
    externalOidc?: {
      enabled: boolean;
      grantType: 'client_credentials' | 'authorization_code';
      authorizationEndpoint: string;
      loginEndpoint: string;
      tokenEndpoint: string;
      discoveryUrl: string;
      issuerUrl: string;
      clientId: string;
      provider: string;
      scope: string;
      audience: string;
      resource: string;
      responseType: string;
      responseMode: string;
      clientAuthMethod: 'client_secret_basic' | 'client_secret_post';
      additionalTokenParams: string;
    };
    maxFileSizeMB: number;
    maxFilesCount: number;
  };
  logging: {
    enabled: boolean;
    level: 'debug' | 'info' | 'warn' | 'error';
  };
  created_at: string;
  updated_at: string;
}

export interface AuthUser {
  id: string;
  email: string;
  profile: Profile | null;
  /** Currently active organization */
  organization: Organization | null;
  /** All organizations the user belongs to */
  organizations: OrgMembership[];
  role: AppRole | null;
  isDebugMode: boolean;
}

export interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}
