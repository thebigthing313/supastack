import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/query-core'

// vi.hoisted ensures the spy is available when the hoisted vi.mock factory runs
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

  it('base key from empty opts is [name, {}] with no extra keys', () => {
    const db = createSupabaseCollections<Database>(supabase, queryClient, {
      tables: { users: { keyColumn: 'id', syncMode: 'on-demand' } },
    })
    db.tables.users

    const queryKeyFn = queryCollectionOptionsSpy.mock.calls[0][0].queryKey
    const baseKey = queryKeyFn({})

    expect(baseKey).toEqual(['users', {}])
    // Must have zero own keys — undefined-valued keys like { where: undefined }
    // would break TanStack Query's prefix matching (the original bug).
    expect(Object.keys(baseKey[1])).toEqual([])
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
      limit: 100,
      offset: 0,
    })

    // Same array length — [name, opts]
    expect(fullKey[0]).toBe('users')
    expect(fullKey[1]).toEqual({
      where: { id: 1 },
      orderBy: [{ column: 'name', direction: 'asc' }],
      limit: 100,
      offset: 0,
    })

    // TanStack Query prefix matching: every key in the base object must exist
    // with the same value in the full object. Since base is {}, any object matches.
    for (const key of Object.keys(baseKey[1])) {
      expect(fullKey[1][key]).toEqual(baseKey[1][key])
    }
  })

  it('queryKey passthrough preserves the opts object identity', () => {
    const db = createSupabaseCollections<Database>(supabase, queryClient, {
      tables: { users: { keyColumn: 'id', syncMode: 'on-demand' } },
    })
    db.tables.users

    const queryKeyFn = queryCollectionOptionsSpy.mock.calls[0][0].queryKey
    const opts = { where: { status: 'active' } }
    const key = queryKeyFn(opts)

    // The opts object is passed through directly, not destructured
    expect(key[1]).toBe(opts)
  })

  it('works for on-demand view collections', () => {
    const db = createSupabaseCollections<Database>(supabase, queryClient, {
      views: { active_users: { keyColumn: 'id', syncMode: 'on-demand' } },
    })
    db.views.active_users

    const queryKeyFn = queryCollectionOptionsSpy.mock.calls[0][0].queryKey
    const baseKey = queryKeyFn({})

    expect(baseKey).toEqual(['active_users', {}])
    expect(Object.keys(baseKey[1])).toEqual([])
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
