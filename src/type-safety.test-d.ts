import { describe, it, expectTypeOf } from 'vitest'
import { QueryClient } from '@tanstack/query-core'
import { z } from 'zod'
import { createSupabaseCollections, defineConfig } from './index'
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
    it('collection key type is inferred from keyColumn via defineConfig', () => {
      const define = defineConfig<Database>()
      const config = define({
        tables: {
          users: { keyColumn: 'id' },  // id: number
          posts: { keyColumn: 'id' },  // id: string
        },
        views: { active_users: { keyColumn: 'id' } }, // id: number
      })

      // Must pass both type params — specifying only <Database> resets TConfig to its default
      const db = createSupabaseCollections<Database, typeof config>(supabase, queryClient, config)

      // .has() accepts the key type — use it to verify key narrowing
      // users.id is number in the DB schema → key should be number
      expectTypeOf(db.tables.users.has).parameter(0).toEqualTypeOf<number>()
      // posts.id is string → key should be string
      expectTypeOf(db.tables.posts.has).parameter(0).toEqualTypeOf<string>()
      // active_users.id is number | null in views → not narrowable to string | number
      expectTypeOf(db.views.active_users.has).parameter(0).toEqualTypeOf<string | number>()
    })

    it('key type falls back to string | number without defineConfig', () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: { users: { keyColumn: 'id' } },
      })

      // Without defineConfig, TConfig defaults and key type is not narrowed
      expectTypeOf(db.tables.users.has).parameter(0).toEqualTypeOf<string | number>()
    })

    it('row schema output type flows through via defineConfig', () => {
      const userRowSchema = z.object({
        id: z.number(),
        username: z.string(),
        status: z.enum(['ONLINE', 'OFFLINE']).nullable(),
        created_at: z.string().transform((s) => new Date(s)),
      })

      const define = defineConfig<Database>()
      const config = define({
        tables: {
          users: { keyColumn: 'id', schemas: { row: userRowSchema } },
        },
      })

      const db = createSupabaseCollections<Database, typeof config>(supabase, queryClient, config)

      // created_at should be Date (from schema transform), not string (from DB)
      type UsersRow = NonNullable<ReturnType<typeof db.tables.users.get>>
      expectTypeOf<UsersRow['created_at']>().toEqualTypeOf<Date>()
    })

    it('row type falls back to DB row type without defineConfig', () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: { users: { keyColumn: 'id' } },
      })

      // Without defineConfig, created_at is the raw DB type (string)
      expectTypeOf(db.tables.users.get(1)!.created_at).toEqualTypeOf<string>()
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
