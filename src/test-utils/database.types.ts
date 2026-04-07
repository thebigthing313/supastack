// Minimal Supabase-generated types for testing purposes.
// Mirrors the shape of a real `supabase gen types` output.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: number
          username: string
          status: Database['public']['Enums']['user_status'] | null
          created_at: string
        }
        Insert: {
          id?: number
          username: string
          status?: Database['public']['Enums']['user_status'] | null
          created_at?: string
        }
        Update: {
          id?: number
          username?: string
          status?: Database['public']['Enums']['user_status'] | null
          created_at?: string
        }
        Relationships: []
      }
      posts: {
        Row: {
          id: string
          title: string
          body: string
          user_id: number
          published: boolean
          created_at: string
        }
        Insert: {
          id?: string
          title: string
          body: string
          user_id: number
          published?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          title?: string
          body?: string
          user_id?: number
          published?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'posts_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      active_users: {
        Row: {
          id: number | null
          username: string | null
          status: Database['public']['Enums']['user_status'] | null
        }
        Relationships: []
      }
    }
    Functions: {
      get_user_status: {
        Args: { user_id: number }
        Returns: Database['public']['Enums']['user_status']
      }
      search_posts: {
        Args: { query: string }
        Returns: {
          id: string
          title: string
        }[]
      }
      get_server_time: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      get_messages:
        | {
            Args: { channel_id: number }
            Returns: { id: string; body: string }[]
          }
        | {
            Args: { user_id: number }
            Returns: { id: string; body: string }[]
          }
    }
    Enums: {
      user_status: 'ONLINE' | 'OFFLINE'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
