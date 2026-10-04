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
      agent_runs: {
        Row: {
          agent_id: string
          created_at: string
          credits: number | null
          duration_ms: number | null
          id: string
          input: Json | null
          output: string | null
          status: string
          tool_calls: Json | null
        }
        Insert: {
          agent_id: string
          created_at?: string
          credits?: number | null
          duration_ms?: number | null
          id?: string
          input?: Json | null
          output?: string | null
          status: string
          tool_calls?: Json | null
        }
        Update: {
          agent_id?: string
          created_at?: string
          credits?: number | null
          duration_ms?: number | null
          id?: string
          input?: Json | null
          output?: string | null
          status?: string
          tool_calls?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          framework: string
          id: string
          instructions: string | null
          item_key: string | null
          model: string
          name: string
          project_id: string | null
          schedule: string | null
          studio_synced_at: string | null
          tools: string[]
          workspace_id: string
        }
        Insert: {
          framework?: string
          id?: string
          instructions?: string | null
          item_key?: string | null
          model?: string
          name: string
          project_id?: string | null
          schedule?: string | null
          studio_synced_at?: string | null
          tools?: string[]
          workspace_id: string
        }
        Update: {
          framework?: string
          id?: string
          instructions?: string | null
          item_key?: string | null
          model?: string
          name?: string
          project_id?: string | null
          schedule?: string | null
          studio_synced_at?: string | null
          tools?: string[]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      approvals: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          kind: string
          payload: Json
          project_id: string | null
          reason: string | null
          requested_by: string | null
          status: string
          title: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          kind: string
          payload?: Json
          project_id?: string | null
          reason?: string | null
          requested_by?: string | null
          status?: string
          title: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          kind?: string
          payload?: Json
          project_id?: string | null
          reason?: string | null
          requested_by?: string | null
          status?: string
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approvals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor: string
          created_at: string
          details: Json
          id: number
          target: string | null
          workspace_id: string
        }
        Insert: {
          action: string
          actor: string
          created_at?: string
          details?: Json
          id?: number
          target?: string | null
          workspace_id: string
        }
        Update: {
          action?: string
          actor?: string
          created_at?: string
          details?: Json
          id?: number
          target?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      blueprints: {
        Row: {
          agreed_at: string | null
          created_at: string
          created_by: string | null
          est_minutes: number | null
          id: string
          project_id: string
          prompt: string
          status: string
          summary: string | null
          total_high: number | null
          total_likely: number | null
          total_low: number | null
          version: number
        }
        Insert: {
          agreed_at?: string | null
          created_at?: string
          created_by?: string | null
          est_minutes?: number | null
          id?: string
          project_id: string
          prompt: string
          status?: string
          summary?: string | null
          total_high?: number | null
          total_likely?: number | null
          total_low?: number | null
          version: number
        }
        Update: {
          agreed_at?: string | null
          created_at?: string
          created_by?: string | null
          est_minutes?: number | null
          id?: string
          project_id?: string
          prompt?: string
          status?: string
          summary?: string | null
          total_high?: number | null
          total_likely?: number | null
          total_low?: number | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "blueprints_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      change_proposals: {
        Row: {
          conflict: Json | null
          created_at: string
          diff: Json
          est_minutes: number | null
          estimate_likely: number | null
          id: string
          message_id: string | null
          project_id: string
          status: string
        }
        Insert: {
          conflict?: Json | null
          created_at?: string
          diff: Json
          est_minutes?: number | null
          estimate_likely?: number | null
          id?: string
          message_id?: string | null
          project_id: string
          status?: string
        }
        Update: {
          conflict?: Json | null
          created_at?: string
          diff?: Json
          est_minutes?: number | null
          estimate_likely?: number | null
          id?: string
          message_id?: string | null
          project_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "change_proposals_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_proposals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      checks: {
        Row: {
          description: string
          id: string
          item_id: string
          kind: string
          locked: boolean
          written_at: string
          written_by: string
        }
        Insert: {
          description: string
          id?: string
          item_id: string
          kind: string
          locked?: boolean
          written_at?: string
          written_by?: string
        }
        Update: {
          description?: string
          id?: string
          item_id?: string
          kind?: string
          locked?: boolean
          written_at?: string
          written_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "checks_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      connections: {
        Row: {
          created_at: string
          id: string
          provider: string
          scopes: string[]
          status: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          provider: string
          scopes?: string[]
          status: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          provider?: string
          scopes?: string[]
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      defaults: {
        Row: {
          alternatives: Json
          blueprint_id: string
          id: string
          label: string
          value: string
        }
        Insert: {
          alternatives?: Json
          blueprint_id: string
          id?: string
          label: string
          value: string
        }
        Update: {
          alternatives?: Json
          blueprint_id?: string
          id?: string
          label?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "defaults_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "blueprints"
            referencedColumns: ["id"]
          },
        ]
      }
      deployments: {
        Row: {
          blueprint_version: number
          checks: Json
          created_at: string
          created_by: string | null
          environment: string
          id: string
          project_id: string
          status: string
        }
        Insert: {
          blueprint_version: number
          checks?: Json
          created_at?: string
          created_by?: string | null
          environment: string
          id?: string
          project_id: string
          status: string
        }
        Update: {
          blueprint_version?: number
          checks?: Json
          created_at?: string
          created_by?: string | null
          environment?: string
          id?: string
          project_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "deployments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      environments: {
        Row: {
          id: string
          name: string
          project_id: string
          status: string
          url: string | null
        }
        Insert: {
          id?: string
          name: string
          project_id: string
          status?: string
          url?: string | null
        }
        Update: {
          id?: string
          name?: string
          project_id?: string
          status?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "environments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          actor: string
          actor_label: string | null
          created_at: string
          id: number
          item_id: string | null
          payload: Json
          project_id: string
          run_id: string | null
          type: string
        }
        Insert: {
          actor: string
          actor_label?: string | null
          created_at?: string
          id?: number
          item_id?: string | null
          payload?: Json
          project_id: string
          run_id?: string | null
          type: string
        }
        Update: {
          actor?: string
          actor_label?: string | null
          created_at?: string
          id?: number
          item_id?: string | null
          payload?: Json
          project_id?: string
          run_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      files: {
        Row: {
          created_at: string
          id: string
          kind: string
          path: string
          project_id: string
          storage_path: string | null
          used_by: string[]
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          path: string
          project_id: string
          storage_path?: string | null
          used_by?: string[]
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          path?: string
          project_id?: string
          storage_path?: string | null
          used_by?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          blueprint_id: string
          confidence: string | null
          cost_actual: number
          description: string | null
          drop_reason: string | null
          estimate_high: number | null
          estimate_likely: number | null
          estimate_low: number | null
          fix_attempts: number
          grp: string
          id: string
          key: string
          position: number
          project_id: string
          proved_when: string
          source_quote: string | null
          status: string
          status_detail: string | null
          title: string
        }
        Insert: {
          blueprint_id: string
          confidence?: string | null
          cost_actual?: number
          description?: string | null
          drop_reason?: string | null
          estimate_high?: number | null
          estimate_likely?: number | null
          estimate_low?: number | null
          fix_attempts?: number
          grp: string
          id?: string
          key: string
          position?: number
          project_id: string
          proved_when: string
          source_quote?: string | null
          status?: string
          status_detail?: string | null
          title: string
        }
        Update: {
          blueprint_id?: string
          confidence?: string | null
          cost_actual?: number
          description?: string | null
          drop_reason?: string | null
          estimate_high?: number | null
          estimate_likely?: number | null
          estimate_low?: number | null
          fix_attempts?: number
          grp?: string
          id?: string
          key?: string
          position?: number
          project_id?: string
          proved_when?: string
          source_quote?: string | null
          status?: string
          status_detail?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          accepted_at: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          invite_token: string | null
          invited_by: string | null
          invited_email: string | null
          role: string
          status: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          invite_token?: string | null
          invited_by?: string | null
          invited_email?: string | null
          role: string
          status?: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          invite_token?: string | null
          invited_by?: string | null
          invited_email?: string | null
          role?: string
          status?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachments: string[]
          content: string
          created_at: string
          id: string
          mode: string
          model: string | null
          project_id: string
          role: string
          status: string
        }
        Insert: {
          attachments?: string[]
          content: string
          created_at?: string
          id?: string
          mode?: string
          model?: string | null
          project_id: string
          role: string
          status?: string
        }
        Update: {
          attachments?: string[]
          content?: string
          created_at?: string
          id?: string
          mode?: string
          model?: string | null
          project_id?: string
          role?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      policies: {
        Row: {
          config: Json
          id: string
          kind: string
          workspace_id: string
        }
        Insert: {
          config: Json
          id?: string
          kind: string
          workspace_id: string
        }
        Update: {
          config?: Json
          id?: string
          kind?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "policies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          budget_credits: number | null
          created_at: string
          current_version: number | null
          icon: string
          id: string
          model: string
          name: string
          owner_display_name: string | null
          owner_id: string | null
          prompt: string | null
          repo_full_name: string | null
          stack: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          budget_credits?: number | null
          created_at?: string
          current_version?: number | null
          icon?: string
          id?: string
          model?: string
          name: string
          owner_display_name?: string | null
          owner_id?: string | null
          prompt?: string | null
          repo_full_name?: string | null
          stack?: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          budget_credits?: number | null
          created_at?: string
          current_version?: number | null
          icon?: string
          id?: string
          model?: string
          name?: string
          owner_display_name?: string | null
          owner_id?: string | null
          prompt?: string | null
          repo_full_name?: string | null
          stack?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      proofs: {
        Row: {
          assertions_passed: number | null
          assertions_total: number | null
          attempt: number
          check_id: string | null
          created_at: string
          id: string
          item_id: string
          log: string | null
          result: string
          screenshot_url: string | null
          summary: string | null
        }
        Insert: {
          assertions_passed?: number | null
          assertions_total?: number | null
          attempt?: number
          check_id?: string | null
          created_at?: string
          id?: string
          item_id: string
          log?: string | null
          result: string
          screenshot_url?: string | null
          summary?: string | null
        }
        Update: {
          assertions_passed?: number | null
          assertions_total?: number | null
          attempt?: number
          check_id?: string | null
          created_at?: string
          id?: string
          item_id?: string
          log?: string | null
          result?: string
          screenshot_url?: string | null
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proofs_check_id_fkey"
            columns: ["check_id"]
            isOneToOne: false
            referencedRelation: "checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proofs_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      questions: {
        Row: {
          affects: string[]
          answer: string | null
          answered_at: string | null
          blocking: boolean
          blueprint_id: string
          id: string
          options: Json
          recommended: string
          text: string
        }
        Insert: {
          affects?: string[]
          answer?: string | null
          answered_at?: string | null
          blocking?: boolean
          blueprint_id: string
          id?: string
          options: Json
          recommended: string
          text: string
        }
        Update: {
          affects?: string[]
          answer?: string | null
          answered_at?: string | null
          blocking?: boolean
          blueprint_id?: string
          id?: string
          options?: Json
          recommended?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "questions_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "blueprints"
            referencedColumns: ["id"]
          },
        ]
      }
      repo_imports: {
        Row: {
          analysis: Json | null
          branch: string
          created_at: string
          folder: string
          full_name: string
          id: string
          project_id: string | null
        }
        Insert: {
          analysis?: Json | null
          branch?: string
          created_at?: string
          folder?: string
          full_name: string
          id?: string
          project_id?: string | null
        }
        Update: {
          analysis?: Json | null
          branch?: string
          created_at?: string
          folder?: string
          full_name?: string
          id?: string
          project_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "repo_imports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      runs: {
        Row: {
          blueprint_id: string | null
          finished_at: string | null
          id: string
          kind: string
          project_id: string
          scenario: string
          started_at: string | null
          started_by: string | null
          status: string
        }
        Insert: {
          blueprint_id?: string | null
          finished_at?: string | null
          id?: string
          kind: string
          project_id: string
          scenario?: string
          started_at?: string | null
          started_by?: string | null
          status?: string
        }
        Update: {
          blueprint_id?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          project_id?: string
          scenario?: string
          started_at?: string | null
          started_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "runs_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "blueprints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          created_at: string
          id: number
          project_id: string | null
          question: string
          status: string
          transcript: Json | null
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          id?: number
          project_id?: string | null
          question: string
          status?: string
          transcript?: Json | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          id?: number
          project_id?: string | null
          question?: string
          status?: string
          transcript?: Json | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_ledger: {
        Row: {
          created_at: string
          credits: number
          id: string
          item_id: string | null
          kind: string
          note: string | null
          project_id: string | null
          run_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          credits: number
          id?: string
          item_id?: string | null
          kind: string
          note?: string | null
          project_id?: string | null
          run_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          credits?: number
          id?: string
          item_id?: string | null
          kind?: string
          note?: string | null
          project_id?: string | null
          run_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_ledger_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_ledger_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_ledger_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_ledger_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          credits_reset_on: string
          credits_total: number
          governance_enabled: boolean
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          credits_reset_on?: string
          credits_total?: number
          governance_enabled?: boolean
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          credits_reset_on?: string
          credits_total?: number
          governance_enabled?: boolean
          id?: string
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_build: { Args: { ws: string }; Returns: boolean }
      create_demo_workspace: {
        Args: { p_email: string; p_name: string; p_user: string }
        Returns: string
      }
      is_member: { Args: { ws: string }; Returns: boolean }
      reset_demo_workspace: {
        Args: { p_owner: string; p_workspace: string }
        Returns: undefined
      }
      seed_demo_workspace: {
        Args: { p_owner: string; p_workspace: string }
        Returns: undefined
      }
      workspace_name_for: {
        Args: { p_email: string; p_name: string }
        Returns: string
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
