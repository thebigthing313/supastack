import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/query-core'

const { queryCollectionOptionsSpy } = vi.hoisted(() => ({
  queryCollectionOptionsSpy: vi.fn((opts: any) => opts),
}))

vi.mock('@tanstack/query-db-collection', () => ({
  queryCollectionOptions: queryCollectionOptionsSpy,
}))

vi.mock('@tanstack/db', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@tanstack/db')>()
  return {
    ...mod,
    createCollection: vi.fn(() => ({ __stub: true })),
  }
})

import { createSupabaseCollections } from './index'
import type { Database } from './test-utils/database.types'

function createMockSupabaseClient() {
  const rangeSpy = vi.fn().mockResolvedValue({ data: [], error: null })
  const selectSpy = vi.fn(() => ({ range: rangeSpy }))
  return {
    from: vi.fn(() => ({ select: selectSpy })),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  } as any
}

describe('on-demand queryKey (issue #5)', () => {
  let supabase: ReturnType<typeof createMockSupabaseClient>
  let queryClient: QueryClient

  beforeEach(() => {
    supabase = createMockSupabaseClient()
    queryClient = new QueryClient()
    queryCollectionOptionsSpy.mockClear()
  })

  it('uses a function-based queryKey for on-demand collections', () => {
    const db = createSupabaseCollections<Database>(supabase, queryClient, {
      tables: { users: { keyColumn: 'id', syncMode: 'on-demand' } },
    })
    db.tables.users

    const opts = queryCollectionOptionsSpy.mock.calls[0][0]
    expect(typeof opts.queryKey).toBe('function')
  })

  it('uses a static array queryKey for eager collections', () => {
    const db = createSupabaseCollections<Database>(supabase, queryClient, {
      tables: { users: { keyColumn: 'id', syncMode: 'eager' } },
    })
    db.tables.users

    const opts = queryCollectionOptionsSpy.mock.calls[0][0]
    expect(opts.queryKey).toEqual(['users'])
  })

  it('base key from empty opts is [name]', () => {
    const db = createSupabaseCollections<Database>(supabase, queryClient, {
      tables: { users: { keyColumn: 'id', syncMode: 'on-demand' } },
    })
    db.tables.users

    const queryKeyFn = queryCollectionOptionsSpy.mock.calls[0][0].queryKey
    const baseKey = queryKeyFn({})

    expect(baseKey).toEqual(['users'])
  })

  it('full key with query params extends the base prefix', () => {
    const db = createSupabaseCollections<Database>(supabase, queryClient, {
      tables: { users: { keyColumn: 'id', syncMode: 'on-demand' } },
    })
    db.tables.users

    const queryKeyFn = queryCollectionOptionsSpy.mock.calls[0][0].queryKey

    const baseKey = queryKeyFn({})
    const fullKey = queryKeyFn({
      where: { id: 1 },
      orderBy: [{ column: 'name', direction: 'asc' }],
      cursor: { whereFrom: { id: { gt: 1 } } },
      limit: 100,
      offset: 0,
    })

    // Base [name] is a prefix of [name, { ... }]
    expect(baseKey).toEqual(['users'])
    expect(fullKey[0]).toBe('users')
    expect(fullKey[1]).toEqual({
      where: { id: 1 },
      orderBy: [{ column: 'name', direction: 'asc' }],
      cursor: { whereFrom: { id: { gt: 1 } } },
      limit: 100,
      offset: 0,
    })
  })

  it('only includes serializable fields, not the full opts object', () => {
    const db = createSupabaseCollections<Database>(supabase, queryClient, {
      tables: { users: { keyColumn: 'id', syncMode: 'on-demand' } },
    })
    db.tables.users

    const queryKeyFn = queryCollectionOptionsSpy.mock.calls[0][0].queryKey
    const opts = {
      where: { id: 1 },
      limit: 10,
      somethingCircular: { self: null as any },
    }
    opts.somethingCircular.self = opts.somethingCircular
    const key = queryKeyFn(opts)

    // Only where/orderBy/limit/offset are picked — no extra fields leak through
    expect(key[1]).toEqual({ where: { id: 1 }, limit: 10 })
    expect(key[1]).not.toHaveProperty('somethingCircular')
  })

  it('includes cursor params for paginated on-demand reads', () => {
    const db = createSupabaseCollections<Database>(supabase, queryClient, {
      tables: { users: { keyColumn: 'id', syncMode: 'on-demand' } },
    })
    db.tables.users

    const queryKeyFn = queryCollectionOptionsSpy.mock.calls[0][0].queryKey
    const cursor = { whereFrom: { id: { gt: 10 } }, whereCurrent: { id: 10 } }
    const key = queryKeyFn({ cursor })

    expect(key).toEqual(['users', { cursor }])
  })

  it('key is JSON-serializable', () => {
    const db = createSupabaseCollections<Database>(supabase, queryClient, {
      tables: { users: { keyColumn: 'id', syncMode: 'on-demand' } },
    })
    db.tables.users

    const queryKeyFn = queryCollectionOptionsSpy.mock.calls[0][0].queryKey
    const key = queryKeyFn({
      where: { status: 'active' },
      orderBy: [{ column: 'name', direction: 'asc' }],
      limit: 50,
      offset: 10,
    })

    expect(() => JSON.stringify(key)).not.toThrow()
  })

  it('works for on-demand view collections', () => {
    const db = createSupabaseCollections<Database>(supabase, queryClient, {
      views: { active_users: { keyColumn: 'id', syncMode: 'on-demand' } },
    })
    db.views.active_users

    const queryKeyFn = queryCollectionOptionsSpy.mock.calls[0][0].queryKey
    const baseKey = queryKeyFn({})

    expect(baseKey).toEqual(['active_users'])
  })

  it('different query params produce different keys', () => {
    const db = createSupabaseCollections<Database>(supabase, queryClient, {
      tables: { users: { keyColumn: 'id', syncMode: 'on-demand' } },
    })
    db.tables.users

    const queryKeyFn = queryCollectionOptionsSpy.mock.calls[0][0].queryKey
    const key1 = queryKeyFn({ where: { id: 1 }, limit: 10 })
    const key2 = queryKeyFn({ where: { id: 2 }, limit: 20 })

    expect(key1).not.toEqual(key2)
  })
})
