export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      dataspace_configs: {
        Row: {
          bearer_token_secret_name: string | null
          created_at: string | null
          export_api_configs: Json | null
          fallback_result_authorization: string | null
          fallback_result_url: string | null
          id: string
          is_active: boolean | null
          name: string
          organization_id: string | null
          pdc_url: string
          updated_at: string | null
        }
        Insert: {
          bearer_token_secret_name?: string | null
          created_at?: string | null
          export_api_configs?: Json | null
          fallback_result_authorization?: string | null
          fallback_result_url?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string | null
          pdc_url: string
          updated_at?: string | null
        }
        Update: {
          bearer_token_secret_name?: string | null
          created_at?: string | null
          export_api_configs?: Json | null
          fallback_result_authorization?: string | null
          fallback_result_url?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string | null
          pdc_url?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dataspace_configs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dataspace_params: {
        Row: {
          api_response_representation: Json | null
          config_id: string | null
          contract_url: string
          created_at: string | null
          custom_result_url: string | null
          id: string
          is_visible: boolean | null
          llm_context: string | null
          organization_id: string | null
          param_actions: string[] | null
          parameters: Json | null
          provider: string | null
          resource_description: string | null
          resource_name: string | null
          resource_type: Database["public"]["Enums"]["resource_type"]
          resource_url: string
          result_authorization: string | null
          result_query_params: Json | null
          result_url_source: string | null
          service_offering: string | null
          updated_at: string | null
          upload_authorization: string | null
          upload_file: boolean | null
          upload_url: string | null
          use_fallback_result_url: boolean | null
          visualization_type:
            | Database["public"]["Enums"]["visualization_type"]
            | null
        }
        Insert: {
          api_response_representation?: Json | null
          config_id?: string | null
          contract_url: string
          created_at?: string | null
          custom_result_url?: string | null
          id?: string
          is_visible?: boolean | null
          llm_context?: string | null
          organization_id?: string | null
          param_actions?: string[] | null
          parameters?: Json | null
          provider?: string | null
          resource_description?: string | null
          resource_name?: string | null
          resource_type: Database["public"]["Enums"]["resource_type"]
          resource_url: string
          result_authorization?: string | null
          result_query_params?: Json | null
          result_url_source?: string | null
          service_offering?: string | null
          updated_at?: string | null
          upload_authorization?: string | null
          upload_file?: boolean | null
          upload_url?: string | null
          use_fallback_result_url?: boolean | null
          visualization_type?:
            | Database["public"]["Enums"]["visualization_type"]
            | null
        }
        Update: {
          api_response_representation?: Json | null
          config_id?: string | null
          contract_url?: string
          created_at?: string | null
          custom_result_url?: string | null
          id?: string
          is_visible?: boolean | null
          llm_context?: string | null
          organization_id?: string | null
          param_actions?: string[] | null
          parameters?: Json | null
          provider?: string | null
          resource_description?: string | null
          resource_name?: string | null
          resource_type?: Database["public"]["Enums"]["resource_type"]
          resource_url?: string
          result_authorization?: string | null
          result_query_params?: Json | null
          result_url_source?: string | null
          service_offering?: string | null
          updated_at?: string | null
          upload_authorization?: string | null
          upload_file?: boolean | null
          upload_url?: string | null
          use_fallback_result_url?: boolean | null
          visualization_type?:
            | Database["public"]["Enums"]["visualization_type"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "dataspace_params_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "dataspace_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dataspace_params_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      debug_sessions: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "debug_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      global_configs: {
        Row: {
          app_name: string | null
          app_version: string | null
          created_at: string | null
          environment: string | null
          features: Json | null
          id: string
          logging: Json | null
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          app_name?: string | null
          app_version?: string | null
          created_at?: string | null
          environment?: string | null
          features?: Json | null
          id?: string
          logging?: Json | null
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          app_name?: string | null
          app_version?: string | null
          created_at?: string | null
          environment?: string | null
          features?: Json | null
          id?: string
          logging?: Json | null
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "global_configs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string | null
          id: string
          invited_by: string | null
          organization_id: string
          status: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          invited_by?: string | null
          organization_id: string
          status?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          invited_by?: string | null
          organization_id?: string
          status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          settings: Json | null
          slug: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          settings?: Json | null
          slug: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          settings?: Json | null
          slug?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      param_placeholders: {
        Row: {
          created_at: string
          custom_function_code: string | null
          description: string | null
          generator_type: string | null
          id: string
          organization_id: string
          placeholder_key: string
          placeholder_type: string
          static_value: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          custom_function_code?: string | null
          description?: string | null
          generator_type?: string | null
          id?: string
          organization_id: string
          placeholder_key: string
          placeholder_type?: string
          static_value?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          custom_function_code?: string | null
          description?: string | null
          generator_type?: string | null
          id?: string
          organization_id?: string
          placeholder_key?: string
          placeholder_type?: string
          static_value?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "param_placeholders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pdc_execution_logs: {
        Row: {
          config_id: string | null
          created_at: string | null
          error_message: string | null
          id: string
          organization_id: string | null
          payload: Json
          pdc_response: Json | null
          status_code: number | null
          trace_id: string
          user_id: string | null
        }
        Insert: {
          config_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          organization_id?: string | null
          payload: Json
          pdc_response?: Json | null
          status_code?: number | null
          trace_id?: string
          user_id?: string | null
        }
        Update: {
          config_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          organization_id?: string | null
          payload?: Json
          pdc_response?: Json | null
          status_code?: number | null
          trace_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pdc_execution_logs_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "dataspace_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdc_execution_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      service_chains: {
        Row: {
          basis_information: Json | null
          catalog_id: string
          config_id: string | null
          contract_url: string
          created_at: string | null
          custom_result_url: string | null
          embedded_resources: Json | null
          id: string
          is_visible: boolean | null
          llm_context: string | null
          organization_id: string | null
          result_authorization: string | null
          result_query_params: Json | null
          result_url_source: string | null
          services: Json | null
          status: string | null
          updated_at: string | null
          visualization_type:
            | Database["public"]["Enums"]["visualization_type"]
            | null
        }
        Insert: {
          basis_information?: Json | null
          catalog_id: string
          config_id?: string | null
          contract_url: string
          created_at?: string | null
          custom_result_url?: string | null
          embedded_resources?: Json | null
          id?: string
          is_visible?: boolean | null
          llm_context?: string | null
          organization_id?: string | null
          result_authorization?: string | null
          result_query_params?: Json | null
          result_url_source?: string | null
          services?: Json | null
          status?: string | null
          updated_at?: string | null
          visualization_type?:
            | Database["public"]["Enums"]["visualization_type"]
            | null
        }
        Update: {
          basis_information?: Json | null
          catalog_id?: string
          config_id?: string | null
          contract_url?: string
          created_at?: string | null
          custom_result_url?: string | null
          embedded_resources?: Json | null
          id?: string
          is_visible?: boolean | null
          llm_context?: string | null
          organization_id?: string | null
          result_authorization?: string | null
          result_query_params?: Json | null
          result_url_source?: string | null
          services?: Json | null
          status?: string | null
          updated_at?: string | null
          visualization_type?:
            | Database["public"]["Enums"]["visualization_type"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "service_chains_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "dataspace_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_chains_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      profiles_secure: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email?: never
          full_name?: string | null
          id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: never
          full_name?: string | null
          id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      create_organization_with_admin: {
        Args: { _org_name: string; _org_slug: string; _user_id: string }
        Returns: string
      }
      accept_my_pending_invitations: { Args: Record<PropertyKey, never>; Returns: number }
      delete_organization: { Args: { _org_id: string }; Returns: undefined }
      get_user_organization: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _organization_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_org_admin: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
      is_org_member: {
        Args: { _organization_id: string; _user_id: string }
        Returns: boolean
      }
      is_slug_available: {
        Args: { _exclude_org_id?: string; _slug: string }
        Returns: boolean
      }
      mask_email: {
        Args: { email: string; profile_user_id: string; viewer_id: string }
        Returns: string
      }
      update_organization: {
        Args: {
          _description?: string
          _name: string
          _org_id: string
          _slug: string
        }
        Returns: undefined
      }
      verify_admin_access: {
        Args: { _organization_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "super_admin" | "admin" | "user"
      resource_type: "software" | "data" | "service_chain"
      visualization_type: "upload_document" | "manual_json_input" | "data_api"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["super_admin", "admin", "user"],
      resource_type: ["software", "data", "service_chain"],
      visualization_type: ["upload_document", "manual_json_input", "data_api"],
    },
  },
} as const
