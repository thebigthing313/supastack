import { describe, it, expectTypeOf } from 'vitest'
import { QueryClient } from '@tanstack/query-core'
import { createSupabaseCollections } from './index'
import type { Database } from './test-utils/database.types'

const supabase = {} as any
const queryClient = new QueryClient()

describe('type safety', () => {
  describe('return types', () => {
    it('tables property should not be any', () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: { users: { keyColumn: 'id' } },
      })

      expectTypeOf(db.tables).not.toBeAny()
    })

    it('table collection should be typed to the Row type', () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: { users: { keyColumn: 'id' } },
      })

      expectTypeOf(db.tables.users).not.toBeAny()
    })

    it('views property should not be any', () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        views: { active_users: { keyColumn: 'id' } },
      })

      expectTypeOf(db.views).not.toBeAny()
    })

    it('rpc should not be any', () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {})

      expectTypeOf(db.rpc).not.toBeAny()
    })

    it('rpc function should return typed query options', () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {})

      const opts = db.rpc.get_user_status({ user_id: 1 })
      expectTypeOf(opts).not.toBeAny()
      expectTypeOf(opts.queryFn).returns.resolves.toEqualTypeOf<
        Database['public']['Enums']['user_status']
      >()
    })
    it('overloaded rpc function accepts any valid overload args', () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {})

      // Both overloads should be accepted
      const opts1 = db.rpc.get_messages({ channel_id: 1 })
      const opts2 = db.rpc.get_messages({ user_id: 1 })

      expectTypeOf(opts1).not.toBeAny()
      expectTypeOf(opts2).not.toBeAny()
    })
  })
})
