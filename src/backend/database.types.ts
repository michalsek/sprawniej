// Generated from the database by `bunx supabase gen types typescript --linked --schema public`. Do not edit:
// regenerate after a migration changes a table or a function.

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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      comments: {
        Row: {
          author_id: string | null
          body: string
          changed_at: string
          created_at: string
          edited_at: string | null
          extra: Json
          id: string
          issue_id: string
          linear_id: string | null
          workspace_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          changed_at?: string
          created_at?: string
          edited_at?: string | null
          extra?: Json
          id: string
          issue_id: string
          linear_id?: string | null
          workspace_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          changed_at?: string
          created_at?: string
          edited_at?: string | null
          extra?: Json
          id?: string
          issue_id?: string
          linear_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_workspace_id_issue_id_fkey"
            columns: ["workspace_id", "issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      deletions: {
        Row: {
          deleted_at: string
          id: number
          row_key: Json
          table_name: string
          workspace_id: string
        }
        Insert: {
          deleted_at?: string
          id?: never
          row_key: Json
          table_name: string
          workspace_id: string
        }
        Update: {
          deleted_at?: string
          id?: never
          row_key?: Json
          table_name?: string
          workspace_id?: string
        }
        Relationships: []
      }
      inbox: {
        Row: {
          actor_id: string | null
          at: string
          changed_at: string
          comment_id: string | null
          extra: Json
          id: string
          issue_id: string
          read_at: string | null
          recipient_id: string
          status: string | null
          type: string
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          at?: string
          changed_at?: string
          comment_id?: string | null
          extra?: Json
          id: string
          issue_id: string
          read_at?: string | null
          recipient_id: string
          status?: string | null
          type: string
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          at?: string
          changed_at?: string
          comment_id?: string | null
          extra?: Json
          id?: string
          issue_id?: string
          read_at?: string | null
          recipient_id?: string
          status?: string | null
          type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbox_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbox_workspace_id_comment_id_fkey"
            columns: ["workspace_id", "comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "inbox_workspace_id_issue_id_fkey"
            columns: ["workspace_id", "issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          expires_at: string
          for_email: string | null
          for_login: string | null
          for_profile: string | null
          id: string
          invited_by: string | null
          role: string
          token: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          expires_at?: string
          for_email?: string | null
          for_login?: string | null
          for_profile?: string | null
          id?: string
          invited_by?: string | null
          role?: string
          token?: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          expires_at?: string
          for_email?: string | null
          for_login?: string | null
          for_profile?: string | null
          id?: string
          invited_by?: string | null
          role?: string
          token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_for_profile_fkey"
            columns: ["for_profile"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_events: {
        Row: {
          actor_id: string | null
          at: string
          changes: Json
          id: number
          issue_id: string
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          at?: string
          changes: Json
          id?: never
          issue_id: string
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          at?: string
          changes?: Json
          id?: never
          issue_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_events_workspace_id_issue_id_fkey"
            columns: ["workspace_id", "issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      issue_followers: {
        Row: {
          changed_at: string
          following: boolean
          issue_id: string
          profile_id: string
          workspace_id: string
        }
        Insert: {
          changed_at?: string
          following: boolean
          issue_id: string
          profile_id: string
          workspace_id: string
        }
        Update: {
          changed_at?: string
          following?: boolean
          issue_id?: string
          profile_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_followers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_followers_workspace_id_issue_id_fkey"
            columns: ["workspace_id", "issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      issue_labels: {
        Row: {
          changed_at: string
          issue_id: string
          label_id: string
          workspace_id: string
        }
        Insert: {
          changed_at?: string
          issue_id: string
          label_id: string
          workspace_id: string
        }
        Update: {
          changed_at?: string
          issue_id?: string
          label_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_labels_workspace_id_issue_id_fkey"
            columns: ["workspace_id", "issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "issue_labels_workspace_id_label_id_fkey"
            columns: ["workspace_id", "label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      issue_numbers: {
        Row: {
          number: number
          team_id: string
          workspace_id: string
        }
        Insert: {
          number: number
          team_id: string
          workspace_id: string
        }
        Update: {
          number?: number
          team_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_numbers_workspace_id_team_id_fkey"
            columns: ["workspace_id", "team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      issues: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          assignee_id: string | null
          changed_at: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string
          due_date: string | null
          duplicate_of: string | null
          estimate: number | null
          extra: Json
          former_refs: string[]
          id: string
          linear_id: string | null
          number: number
          parent_id: string | null
          priority: number
          project_id: string | null
          sort_order: string
          status: string
          team_id: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          assignee_id?: string | null
          changed_at?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          due_date?: string | null
          duplicate_of?: string | null
          estimate?: number | null
          extra?: Json
          former_refs?: string[]
          id: string
          linear_id?: string | null
          number?: number
          parent_id?: string | null
          priority?: number
          project_id?: string | null
          sort_order: string
          status?: string
          team_id: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          assignee_id?: string | null
          changed_at?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          due_date?: string | null
          duplicate_of?: string | null
          estimate?: number | null
          extra?: Json
          former_refs?: string[]
          id?: string
          linear_id?: string | null
          number?: number
          parent_id?: string | null
          priority?: number
          project_id?: string | null
          sort_order?: string
          status?: string
          team_id?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issues_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issues_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issues_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issues_workspace_id_duplicate_of_fkey"
            columns: ["workspace_id", "duplicate_of"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "issues_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issues_workspace_id_parent_id_fkey"
            columns: ["workspace_id", "parent_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "issues_workspace_id_project_id_fkey"
            columns: ["workspace_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "issues_workspace_id_team_id_fkey"
            columns: ["workspace_id", "team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      labels: {
        Row: {
          changed_at: string
          color: string
          extra: Json
          id: string
          linear_id: string | null
          name: string
          workspace_id: string
        }
        Insert: {
          changed_at?: string
          color: string
          extra?: Json
          id: string
          linear_id?: string | null
          name: string
          workspace_id: string
        }
        Update: {
          changed_at?: string
          color?: string
          extra?: Json
          id?: string
          linear_id?: string | null
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "labels_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string
          changed_at: string
          created_at: string
          extra: Json
          github_id: number | null
          guest_of: string | null
          id: string
          linear_ids: string[]
          login: string
          name: string
          name_set_here: boolean
          user_id: string | null
        }
        Insert: {
          avatar_url?: string
          changed_at?: string
          created_at?: string
          extra?: Json
          github_id?: number | null
          guest_of?: string | null
          id?: string
          linear_ids?: string[]
          login: string
          name?: string
          name_set_here?: boolean
          user_id?: string | null
        }
        Update: {
          avatar_url?: string
          changed_at?: string
          created_at?: string
          extra?: Json
          github_id?: number | null
          guest_of?: string | null
          id?: string
          linear_ids?: string[]
          login?: string
          name?: string
          name_set_here?: boolean
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_guest_of_fkey"
            columns: ["guest_of"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      project_teams: {
        Row: {
          changed_at: string
          project_id: string
          team_id: string
          workspace_id: string
        }
        Insert: {
          changed_at?: string
          project_id: string
          team_id: string
          workspace_id: string
        }
        Update: {
          changed_at?: string
          project_id?: string
          team_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_teams_workspace_id_project_id_fkey"
            columns: ["workspace_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "project_teams_workspace_id_team_id_fkey"
            columns: ["workspace_id", "team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      projects: {
        Row: {
          changed_at: string
          created_at: string
          description: string
          emoji: string
          extra: Json
          id: string
          lead_id: string | null
          linear_id: string | null
          name: string
          status: string
          target_date: string | null
          workspace_id: string
        }
        Insert: {
          changed_at?: string
          created_at?: string
          description?: string
          emoji?: string
          extra?: Json
          id: string
          lead_id?: string | null
          linear_id?: string | null
          name: string
          status?: string
          target_date?: string | null
          workspace_id: string
        }
        Update: {
          changed_at?: string
          created_at?: string
          description?: string
          emoji?: string
          extra?: Json
          id?: string
          lead_id?: string | null
          linear_id?: string | null
          name?: string
          status?: string
          target_date?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      read_state: {
        Row: {
          changed_at: string
          extra: Json
          profile_id: string
          read_until: string | null
          workspace_id: string
        }
        Insert: {
          changed_at?: string
          extra?: Json
          profile_id: string
          read_until?: string | null
          workspace_id: string
        }
        Update: {
          changed_at?: string
          extra?: Json
          profile_id?: string
          read_until?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "read_state_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "read_state_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          changed_at: string
          profile_id: string
          team_id: string
          workspace_id: string
        }
        Insert: {
          changed_at?: string
          profile_id: string
          team_id: string
          workspace_id: string
        }
        Update: {
          changed_at?: string
          profile_id?: string
          team_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_workspace_id_team_id_fkey"
            columns: ["workspace_id", "team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      teams: {
        Row: {
          auto_archive: number
          changed_at: string
          created_at: string
          emoji: string
          extra: Json
          id: string
          key: string
          last_number: number
          linear_id: string | null
          name: string
          workspace_id: string
        }
        Insert: {
          auto_archive?: number
          changed_at?: string
          created_at?: string
          emoji?: string
          extra?: Json
          id?: string
          key: string
          last_number?: number
          linear_id?: string | null
          name: string
          workspace_id: string
        }
        Update: {
          auto_archive?: number
          changed_at?: string
          created_at?: string
          emoji?: string
          extra?: Json
          id?: string
          key?: string
          last_number?: number
          linear_id?: string | null
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      views: {
        Row: {
          changed_at: string
          created_at: string
          description: string
          display: Json
          emoji: string
          extra: Json
          filters: Json
          id: string
          linear_id: string | null
          name: string
          owner_id: string | null
          team_id: string | null
          workspace_id: string
        }
        Insert: {
          changed_at?: string
          created_at?: string
          description?: string
          display: Json
          emoji?: string
          extra?: Json
          filters?: Json
          id: string
          linear_id?: string | null
          name: string
          owner_id?: string | null
          team_id?: string | null
          workspace_id: string
        }
        Update: {
          changed_at?: string
          created_at?: string
          description?: string
          display?: Json
          emoji?: string
          extra?: Json
          filters?: Json
          id?: string
          linear_id?: string | null
          name?: string
          owner_id?: string | null
          team_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "views_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "views_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "views_workspace_id_team_id_fkey"
            columns: ["workspace_id", "team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          changed_at: string
          joined_at: string
          profile_id: string
          removed_at: string | null
          role: string
          workspace_id: string
        }
        Insert: {
          changed_at?: string
          joined_at?: string
          profile_id: string
          removed_at?: string | null
          role?: string
          workspace_id: string
        }
        Update: {
          changed_at?: string
          joined_at?: string
          profile_id?: string
          removed_at?: string | null
          role?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          changed_at: string
          created_at: string
          created_by: string | null
          extra: Json
          id: string
          name: string
        }
        Insert: {
          changed_at?: string
          created_at?: string
          created_by?: string | null
          extra?: Json
          id?: string
          name: string
        }
        Update: {
          changed_at?: string
          created_at?: string
          created_by?: string | null
          extra?: Json
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invite: { Args: { p_token: string }; Returns: string }
      create_profile: {
        Args: { p_login: string; p_name: string }
        Returns: {
          avatar_url: string
          changed_at: string
          created_at: string
          extra: Json
          github_id: number | null
          guest_of: string | null
          id: string
          linear_ids: string[]
          login: string
          name: string
          name_set_here: boolean
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: true
        }
      }
      create_workspace: {
        Args: {
          p_name: string
          p_team_emoji: string
          p_team_key: string
          p_team_name: string
        }
        Returns: string
      }
      ensure_profile: {
        Args: never
        Returns: {
          avatar_url: string
          changed_at: string
          created_at: string
          extra: Json
          github_id: number | null
          guest_of: string | null
          id: string
          linear_ids: string[]
          login: string
          name: string
          name_set_here: boolean
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: true
        }
      }
      guest_emails: {
        Args: { p_ws: string }
        Returns: {
          email: string
          profile_id: string
        }[]
      }
      import_rows: {
        Args: { p_rows: Json; p_table: string; p_ws: string }
        Returns: number
      }
      invite_info: {
        Args: { p_token: string }
        Returns: {
          for_login: string
          for_name: string
          invited_by_avatar: string
          invited_by_login: string
          invited_by_name: string
          people: Json
          role: string
          state: string
          workspace_id: string
          workspace_name: string
        }[]
      }
      leave_workspace: { Args: { p_ws: string }; Returns: undefined }
      link_person: {
        Args: { p_guest: string; p_to: string; p_ws: string }
        Returns: undefined
      }
      move_issue_to_team: {
        Args: { p_issue: string; p_team: string }
        Returns: {
          archived_at: string | null
          archived_by: string | null
          assignee_id: string | null
          changed_at: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string
          due_date: string | null
          duplicate_of: string | null
          estimate: number | null
          extra: Json
          former_refs: string[]
          id: string
          linear_id: string | null
          number: number
          parent_id: string | null
          priority: number
          project_id: string | null
          sort_order: string
          status: string
          team_id: string
          title: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "issues"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_guest_email: {
        Args: { p_email: string; p_profile: string }
        Returns: undefined
      }
      signup_code_needed: { Args: never; Returns: boolean }
      use_signup_code: {
        Args: { p_code?: string; p_invite?: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
