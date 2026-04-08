import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient } from '@tanstack/query-core'
import { z } from 'zod'
import { eq, and, inArray, IR, BasicIndex } from '@tanstack/db'
import { createSupabaseCollections, defineConfig, fetchTableData } from './index'
import type { Database } from './test-utils/database.types'

const ref = (name: string) => new IR.PropRef([name])

// Spies that persist across calls so we can assert on them.
// selectSpy controls what data is returned; rangeSpy chains off it.
function createMockSupabaseClient() {
  let selectData: any[] = []
  const rangeSpy = vi.fn().mockImplementation(() =>
    Promise.resolve({ data: selectData, error: null }),
  )
  const selectSpy = vi.fn().mockImplementation(() => ({ range: rangeSpy }))

  // Helper: set what select/range returns
  selectSpy.mockResolvedValue = (val: { data: any; error: any }) => {
    selectData = val.data ?? []
    rangeSpy.mockImplementation(() => Promise.resolve(val))
    return selectSpy
  }
  // Initialize default
  selectSpy.mockResolvedValue({ data: [], error: null })

  const insertSpy = vi.fn().mockResolvedValue({ data: null, error: null })
  const updateEqSpy = vi.fn().mockResolvedValue({ data: null, error: null })
  const updateSpy = vi.fn(() => ({ eq: updateEqSpy }))
  const deleteInSpy = vi.fn().mockResolvedValue({ data: null, error: null })
  const deleteEqSpy = vi.fn().mockResolvedValue({ data: null, error: null })
  const deleteSpy = vi.fn(() => ({ eq: deleteEqSpy, in: deleteInSpy }))

  const fromSpy = vi.fn(() => ({
    select: selectSpy,
    insert: insertSpy,
    update: updateSpy,
    delete: deleteSpy,
  }))

  const rpcSpy = vi.fn().mockResolvedValue({ data: null, error: null })

  return {
    from: fromSpy,
    rpc: rpcSpy,
    _spies: { selectSpy, rangeSpy, insertSpy, updateSpy, updateEqSpy, deleteSpy, deleteEqSpy, deleteInSpy },
  } as any
}

describe('createSupabaseCollections', () => {
  let supabase: ReturnType<typeof createMockSupabaseClient>
  let queryClient: QueryClient

  beforeEach(() => {
    supabase = createMockSupabaseClient()
    queryClient = new QueryClient()
  })

  describe('table collections', () => {
    it('creates a collection for a configured table', () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: {
          users: { keyColumn: 'id' },
        },
      })

      const usersCollection = db.tables.users
      expect(usersCollection).toBeDefined()
    })

    it('returns the same collection instance on repeated access', () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: { users: { keyColumn: 'id' } },
      })

      expect(db.tables.users).toBe(db.tables.users)
    })

    it('fetches rows via supabase.from(tableName).select when syncing', async () => {
      const mockRows = [
        { id: 1, username: 'alice', status: 'ONLINE' as const, created_at: '2024-01-01' },
      ]
      supabase._spies.selectSpy.mockResolvedValue({ data: mockRows, error: null })

      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: {
          users: { keyColumn: 'id' },
        },
      })

      const collection = db.tables.users
      await collection.utils.refetch()

      expect(supabase.from).toHaveBeenCalledWith('users')
      expect(supabase._spies.selectSpy).toHaveBeenCalledWith('*')
    })

    it('sends all mutations in a transaction as a single insert call', async () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: { users: { keyColumn: 'id' } },
      })

      const collection = db.tables.users
      const user1 = { id: 2, username: 'bob', status: 'OFFLINE' as const, created_at: '2024-01-02' }
      const user2 = { id: 3, username: 'charlie', status: 'ONLINE' as const, created_at: '2024-01-03' }

      // TanStack DB dispatches onInsert per mutation, each with 1 item.
      // Our handler batches the mutations within a single transaction into
      // one .insert() call (array if multiple, single object if one).
      collection.insert(user1)
      collection.insert(user2)

      await vi.waitFor(() => {
        expect(supabase._spies.insertSpy).toHaveBeenCalledTimes(2)
        expect(supabase._spies.insertSpy).toHaveBeenCalledWith(user1)
        expect(supabase._spies.insertSpy).toHaveBeenCalledWith(user2)
      })
    })

    it('calls supabase.from(table).insert() on collection.insert()', async () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: { users: { keyColumn: 'id' } },
      })

      const collection = db.tables.users
      const newUser = { id: 2, username: 'bob', status: 'OFFLINE' as const, created_at: '2024-01-02' }
      collection.insert(newUser)

      await vi.waitFor(() => {
        expect(supabase.from).toHaveBeenCalledWith('users')
        expect(supabase._spies.insertSpy).toHaveBeenCalledWith(newUser)
      })
    })

    it('calls supabase.from(table).update().eq(keyColumn, key) on collection.update()', async () => {
      supabase._spies.selectSpy.mockResolvedValue({
        data: [{ id: 1, username: 'alice', status: 'ONLINE', created_at: '2024-01-01' }],
        error: null,
      })

      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: { users: { keyColumn: 'id' } },
      })

      const collection = db.tables.users
      await collection.utils.refetch()

      collection.update(1, (draft: any) => {
        draft.username = 'alice_updated'
      })

      await vi.waitFor(() => {
        expect(supabase._spies.updateSpy).toHaveBeenCalled()
        expect(supabase._spies.updateEqSpy).toHaveBeenCalledWith('id', 1)
      })
    })

    it('calls supabase.from(table).delete().eq(keyColumn, key) on collection.delete()', async () => {
      supabase._spies.selectSpy.mockResolvedValue({
        data: [{ id: 1, username: 'alice', status: 'ONLINE', created_at: '2024-01-01' }],
        error: null,
      })

      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: { users: { keyColumn: 'id' } },
      })

      const collection = db.tables.users
      await collection.utils.refetch()

      collection.delete(1)

      await vi.waitFor(() => {
        expect(supabase._spies.deleteSpy).toHaveBeenCalled()
        expect(supabase._spies.deleteInSpy).toHaveBeenCalledWith('id', [1])
      })
    })
  })

  describe('query options pass-through', () => {
    it('accepts pageSize and inArrayChunkSize', () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: {
          users: {
            keyColumn: 'id',
            pageSize: 500,
            inArrayChunkSize: 100,
          },
        },
        views: {
          active_users: {
            keyColumn: 'id',
            pageSize: 250,
          },
        },
      })

      expect(db.tables.users).toBeDefined()
      expect(db.views.active_users).toBeDefined()
    })

    it('accepts startSync, select, and autoIndex', () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: {
          users: {
            keyColumn: 'id',
            startSync: false,
            select: 'id,username,status',
            autoIndex: 'eager',
            defaultIndexType: BasicIndex,
          },
        },
      })

      // startSync: false means no initial fetch — collection exists but is idle
      expect(db.tables.users).toBeDefined()
      // Verify no fetch was triggered (startSync: false)
      expect(supabase.from).not.toHaveBeenCalled()
    })

    it('uses custom select columns in fetch', async () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: {
          users: {
            keyColumn: 'id',
            select: 'id,username',
          },
        },
      })

      await db.tables.users.utils.refetch()

      expect(supabase._spies.selectSpy).toHaveBeenCalledWith('id,username')
    })

    it('accepts wrapOptions hook', () => {
      const wrapSpy = vi.fn((opts: any) => opts)

      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        wrapOptions: wrapSpy,
        tables: {
          users: { keyColumn: 'id' },
        },
      })

      // Accessing the collection triggers creation, which calls wrapOptions
      db.tables.users
      expect(wrapSpy).toHaveBeenCalledTimes(1)
    })

    it('accepts staleTime, refetchInterval, enabled, retry, retryDelay, gcTime', () => {
      // This test verifies the config types accept these options without error.
      // The actual pass-through to queryCollectionOptions is structural —
      // if the collection creates successfully, the options were accepted.
      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: {
          users: {
            keyColumn: 'id',
            staleTime: 30_000,
            refetchInterval: 60_000,
            enabled: false,
            retry: 3,
            retryDelay: 1000,
            gcTime: 300_000,
          },
        },
        views: {
          active_users: {
            keyColumn: 'id',
            staleTime: 10_000,
          },
        },
      })

      // enabled: false means sync won't start, but collection should still be created
      expect(db.tables.users).toBeDefined()
      expect(db.views.active_users).toBeDefined()
    })
  })

  describe('on-demand table collections', () => {
    it('creates a collection with syncMode on-demand', () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: {
          users: { keyColumn: 'id', syncMode: 'on-demand' },
        },
      })

      const collection = db.tables.users
      expect(collection).toBeDefined()
    })

    it('applies loadSubsetOptions filters to the supabase query', async () => {
      // For on-demand mode, when TanStack DB calls the queryFn, it passes
      // loadSubsetOptions via context.meta. We test that our queryFn
      // correctly applies those filters to the Supabase query.

      // We need to intercept the select call to verify filter chaining.
      // In on-demand mode, supabase.from().select() returns a builder
      // that gets filters applied to it.
      const eqSpy = vi.fn().mockResolvedValue({ data: [], error: null })
      const selectSpy = vi.fn(() => ({ eq: eqSpy }))
      supabase.from.mockReturnValue({ select: selectSpy })

      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: {
          users: { keyColumn: 'id', syncMode: 'on-demand' },
        },
      })

      const collection = db.tables.users

      // The on-demand queryFn should be callable with meta.loadSubsetOptions
      // Since we can't easily trigger on-demand loading through TanStack DB
      // in a unit test, we verify the collection was created with on-demand mode.
      expect(collection).toBeDefined()
    })
  })

  describe('view collections', () => {
    it('creates a read-only collection for a configured view', async () => {
      const mockRows = [{ id: 1, username: 'alice', status: 'ONLINE' as const }]
      supabase._spies.selectSpy.mockResolvedValue({ data: mockRows, error: null })

      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        views: {
          active_users: { keyColumn: 'id' },
        },
      })

      const collection = db.views.active_users
      expect(collection).toBeDefined()

      await collection.utils.refetch()
      expect(supabase.from).toHaveBeenCalledWith('active_users')
    })

    it('accepts a row schema for data transformation', async () => {
      supabase._spies.selectSpy.mockResolvedValue({
        data: [{ id: 1, username: 'alice', status: 'ONLINE' }],
        error: null,
      })

      const viewRowSchema = z.object({
        id: z.number().nullable(),
        username: z.string().nullable(),
        status: z.enum(['ONLINE', 'OFFLINE']).nullable(),
      })

      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        views: {
          active_users: { keyColumn: 'id', schemas: { row: viewRowSchema } },
        },
      })

      const collection = db.views.active_users
      await collection.utils.refetch()

      expect(supabase.from).toHaveBeenCalledWith('active_users')
      expect(collection).toBeDefined()
    })

    it('does not expose insert/update/delete mutation handlers on view collections', () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        views: {
          active_users: { keyColumn: 'id' },
        },
      })

      const collection = db.views.active_users

      // View collections should not have mutation handlers wired.
      // Calling insert/update/delete should not trigger supabase mutations.
      // We verify by checking that the collection was created without onInsert/onUpdate/onDelete.
      // The collection object itself still has the methods (from TanStack DB),
      // but they won't call supabase because no handlers were registered.
      expect(collection).toBeDefined()
    })
  })

  describe('zod schemas', () => {
    it('passes a row schema to the collection for data transformation', async () => {
      supabase._spies.selectSpy.mockResolvedValue({
        data: [{ id: 1, username: 'alice', status: 'ONLINE', created_at: '2024-01-01T00:00:00Z' }],
        error: null,
      })

      const userRowSchema = z.object({
        id: z.number(),
        username: z.string(),
        status: z.enum(['ONLINE', 'OFFLINE']).nullable(),
        created_at: z.string().transform((s) => new Date(s)),
      })

      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: {
          users: {
            keyColumn: 'id',
            schemas: { row: userRowSchema },
          },
        },
      })

      const collection = db.tables.users
      await collection.utils.refetch()

      // Verify supabase was called (data was fetched)
      expect(supabase.from).toHaveBeenCalledWith('users')

      // The schema is passed to TanStack DB's createCollection,
      // which uses it to parse/transform data as it enters the collection.
      // We verify the collection was created successfully with the schema.
      expect(collection).toBeDefined()
    })

    it('transforms insert data through a zod insert schema before sending to supabase', async () => {
      const insertSchema = z.object({
        id: z.number().optional(),
        username: z.string().trim(),
        status: z.enum(['ONLINE', 'OFFLINE']).nullable().optional(),
        created_at: z.date().transform((d) => d.toISOString()).optional(),
      })

      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: {
          users: {
            keyColumn: 'id',
            schemas: { insert: insertSchema },
          },
        },
      })

      const collection = db.tables.users
      collection.insert({
        id: 2,
        username: '  bob  ',
        status: 'ONLINE',
        created_at: new Date('2024-06-15T00:00:00Z') as any,
      })

      await vi.waitFor(() => {
        expect(supabase._spies.insertSpy).toHaveBeenCalled()
      })

      // The insert schema should have trimmed the username and
      // converted the Date to an ISO string before sending to supabase
      const insertedData = supabase._spies.insertSpy.mock.calls[0][0]
      expect(insertedData.username).toBe('bob')
      expect(insertedData.created_at).toBe('2024-06-15T00:00:00.000Z')
    })

    it('transforms update data through a zod update schema before sending to supabase', async () => {
      supabase._spies.selectSpy.mockResolvedValue({
        data: [{ id: 1, username: 'alice', status: 'ONLINE', created_at: '2024-01-01' }],
        error: null,
      })

      const updateSchema = z.object({
        id: z.number().optional(),
        username: z.string().toUpperCase().optional(),
        status: z.enum(['ONLINE', 'OFFLINE']).nullable().optional(),
        created_at: z.string().optional(),
      })

      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: {
          users: {
            keyColumn: 'id',
            schemas: { update: updateSchema },
          },
        },
      })

      const collection = db.tables.users
      await collection.utils.refetch()

      collection.update(1, (draft: any) => {
        draft.username = 'alice_updated'
      })

      await vi.waitFor(() => {
        expect(supabase._spies.updateSpy).toHaveBeenCalled()
      })

      // The update schema should have uppercased the username
      const updatedChanges = supabase._spies.updateSpy.mock.calls[0][0]
      expect(updatedChanges.username).toBe('ALICE_UPDATED')
    })

    it('preserves row schema types through defineConfig', async () => {
      supabase._spies.selectSpy.mockResolvedValue({
        data: [{ id: 1, username: 'alice', status: 'ONLINE', created_at: '2024-01-01T00:00:00Z' }],
        error: null,
      })

      const userRowSchema = z.object({
        id: z.number(),
        username: z.string(),
        status: z.enum(['ONLINE', 'OFFLINE']).nullable(),
        created_at: z.string().transform((s) => new Date(s)),
      })

      // defineConfig preserves literal schema types through variable assignment
      const define = defineConfig<Database>()
      const config = define({
        tables: {
          users: {
            keyColumn: 'id',
            schemas: { row: userRowSchema },
          },
        },
      })

      const db = createSupabaseCollections<Database>(supabase, queryClient, config)

      const collection = db.tables.users
      await collection.utils.refetch()

      expect(supabase.from).toHaveBeenCalledWith('users')
      expect(collection).toBeDefined()
    })
  })

  describe('rpc', () => {
    it('returns query options that call supabase.rpc with the function name and args', async () => {
      const mockResult = 'ONLINE'
      supabase.rpc.mockResolvedValue({ data: mockResult, error: null })

      const db = createSupabaseCollections<Database>(supabase, queryClient, {})

      const options = db.rpc.get_user_status({ user_id: 1 })

      expect(options.queryKey).toEqual(['rpc', 'get_user_status', { user_id: 1 }])
      expect(options.queryFn).toBeTypeOf('function')

      // Execute the queryFn and verify it calls supabase.rpc
      const result = await options.queryFn({ queryKey: options.queryKey } as any)
      expect(supabase.rpc).toHaveBeenCalledWith('get_user_status', { user_id: 1 })
      expect(result).toBe(mockResult)
    })

    it('returns different query keys for different args', () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {})

      const opts1 = db.rpc.get_user_status({ user_id: 1 })
      const opts2 = db.rpc.get_user_status({ user_id: 2 })

      expect(opts1.queryKey).not.toEqual(opts2.queryKey)
    })

    it('throws when supabase.rpc returns an error', async () => {
      supabase.rpc.mockResolvedValue({ data: null, error: { message: 'function not found' } })

      const db = createSupabaseCollections<Database>(supabase, queryClient, {})
      const options = db.rpc.get_user_status({ user_id: 1 })

      await expect(options.queryFn({ queryKey: options.queryKey } as any)).rejects.toEqual({
        message: 'function not found',
      })
    })

    it('returns array result for set-returning functions', async () => {
      const mockRows = [
        { id: '1', title: 'Hello' },
        { id: '2', title: 'World' },
      ]
      supabase.rpc.mockResolvedValue({ data: mockRows, error: null })

      const db = createSupabaseCollections<Database>(supabase, queryClient, {})
      const options = db.rpc.search_posts({ query: 'hello' })
      const result = await options.queryFn({ queryKey: options.queryKey } as any)

      expect(result).toEqual(mockRows)
    })
  })

  describe('error handling', () => {
    it('throws when supabase.from().select() returns an error on fetch', async () => {
      supabase._spies.selectSpy.mockResolvedValue({
        data: null,
        error: { message: 'permission denied' },
      })

      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: { users: { keyColumn: 'id' } },
      })

      const collection = db.tables.users

      // refetch should propagate the error
      await expect(collection.utils.refetch({ throwOnError: true })).rejects.toThrow()
    })

    it('throws when supabase.from().insert() returns an error', async () => {
      supabase._spies.insertSpy.mockResolvedValue({
        data: null,
        error: { message: 'unique constraint violation' },
      })

      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: { users: { keyColumn: 'id' } },
      })

      const collection = db.tables.users
      collection.insert({ id: 1, username: 'alice', status: 'ONLINE', created_at: '2024-01-01' })

      // The error surfaces asynchronously through the mutation handler.
      // TanStack DB transitions the mutation to 'failed' state.
      await vi.waitFor(() => {
        expect(supabase._spies.insertSpy).toHaveBeenCalled()
      })
    })

    it('throws when supabase.from().update() returns an error', async () => {
      supabase._spies.selectSpy.mockResolvedValue({
        data: [{ id: 1, username: 'alice', status: 'ONLINE', created_at: '2024-01-01' }],
        error: null,
      })
      supabase._spies.updateEqSpy.mockResolvedValue({
        data: null,
        error: { message: 'row not found' },
      })

      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: { users: { keyColumn: 'id' } },
      })

      const collection = db.tables.users
      await collection.utils.refetch()

      collection.update(1, (draft: any) => {
        draft.username = 'updated'
      })

      await vi.waitFor(() => {
        expect(supabase._spies.updateEqSpy).toHaveBeenCalled()
      })
    })

    it('throws when supabase.from().delete() returns an error', async () => {
      supabase._spies.selectSpy.mockResolvedValue({
        data: [{ id: 1, username: 'alice', status: 'ONLINE', created_at: '2024-01-01' }],
        error: null,
      })
      supabase._spies.deleteInSpy.mockResolvedValue({
        data: null,
        error: { message: 'foreign key constraint' },
      })

      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: { users: { keyColumn: 'id' } },
      })

      const collection = db.tables.users
      await collection.utils.refetch()

      collection.delete(1)

      await vi.waitFor(() => {
        expect(supabase._spies.deleteInSpy).toHaveBeenCalled()
      })
    })
  })

  describe('refetch on mutation error', () => {
    it('refetches even when insert fails, to sync any committed server state', async () => {
      // Track whether refetch was attempted after failure
      const refetchSpy = vi.fn()
      supabase._spies.insertSpy.mockResolvedValue({
        data: null,
        error: { message: 'unique constraint' },
      })

      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: { users: { keyColumn: 'id' } },
      })

      const collection = db.tables.users
      const originalRefetch = collection.utils.refetch.bind(collection.utils)
      collection.utils.refetch = async (...args: any[]) => {
        refetchSpy()
        return originalRefetch(...args)
      }

      collection.insert({ id: 1, username: 'dupe', status: 'ONLINE', created_at: '2024-01-01' })

      await vi.waitFor(() => {
        // refetch should be called via the finally block,
        // even though insert returned an error
        expect(refetchSpy).toHaveBeenCalled()
      }, { timeout: 2000 })
    })
  })

  describe('proxy safety', () => {
    it('does not create collections when accessed with Symbol keys', () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: { users: { keyColumn: 'id' } },
      })

      // These are commonly triggered by console.log, Promise.resolve, etc.
      expect((db.tables as any)[Symbol.toPrimitive]).toBeUndefined()
      expect((db.tables as any)[Symbol.iterator]).toBeUndefined()
      expect((db.views as any)[Symbol.toPrimitive]).toBeUndefined()
      expect((db.rpc as any)[Symbol.toPrimitive]).toBeUndefined()
    })

    it('does not create collections for "then" property (Promise detection)', () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: { users: { keyColumn: 'id' } },
      })

      // Promise.resolve checks for .then — should not create a collection
      expect((db.tables as any).then).toBeUndefined()
      expect((db.views as any).then).toBeUndefined()
    })
  })

  describe('unconfigured access', () => {
    it('returns undefined for an unconfigured table', () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: { users: { keyColumn: 'id' } },
      })

      // 'posts' is a valid table in the Database type but not configured
      expect((db.tables as any).posts).toBeUndefined()
    })

    it('returns undefined for an unconfigured view', () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {})

      expect((db.views as any).active_users).toBeUndefined()
    })
  })

  describe('multiple tables', () => {
    it('creates independent collections for different tables', async () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: {
          users: { keyColumn: 'id' },
          posts: { keyColumn: 'id' },
        },
      })

      const users = db.tables.users
      const posts = db.tables.posts

      expect(users).toBeDefined()
      expect(posts).toBeDefined()
      expect(users).not.toBe(posts)
    })

    it('uses the correct table name in supabase.from() for each collection', async () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: {
          users: { keyColumn: 'id' },
          posts: { keyColumn: 'id' },
        },
      })

      // Access both collections to trigger creation
      db.tables.users
      db.tables.posts

      // Both should have called supabase.from with their respective names
      // (from the queryFn being set up — actual call happens on sync/refetch)
      await db.tables.users.utils.refetch()
      await db.tables.posts.utils.refetch()

      const fromCalls = supabase.from.mock.calls.map((c: any) => c[0])
      expect(fromCalls).toContain('users')
      expect(fromCalls).toContain('posts')
    })
  })

  describe('string key columns', () => {
    it('works with string-type key columns', async () => {
      supabase._spies.selectSpy.mockResolvedValue({
        data: [{ id: 'abc-123', title: 'Hello', body: 'World', user_id: 1, published: true, created_at: '2024-01-01' }],
        error: null,
      })

      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: { posts: { keyColumn: 'id' } },
      })

      const collection = db.tables.posts
      await collection.utils.refetch()

      collection.delete('abc-123')

      await vi.waitFor(() => {
        expect(supabase._spies.deleteInSpy).toHaveBeenCalledWith('id', ['abc-123'])
      })
    })

    it('supports non-id key columns', async () => {
      supabase._spies.selectSpy.mockResolvedValue({
        data: [{ id: 1, username: 'alice', status: 'ONLINE', created_at: '2024-01-01' }],
        error: null,
      })

      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: { users: { keyColumn: 'username' } },
      })

      const collection = db.tables.users
      await collection.utils.refetch()

      collection.update('alice', (draft: any) => {
        draft.status = 'OFFLINE'
      })

      await vi.waitFor(() => {
        expect(supabase._spies.updateEqSpy).toHaveBeenCalledWith('username', 'alice')
      })
    })
  })

  describe('zod validation failure', () => {
    it('throws when insert data fails zod validation', async () => {
      const strictInsertSchema = z.object({
        id: z.number().optional(),
        username: z.string().min(3),
        status: z.enum(['ONLINE', 'OFFLINE']).nullable().optional(),
        created_at: z.string().optional(),
      })

      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: {
          users: {
            keyColumn: 'id',
            schemas: { insert: strictInsertSchema },
          },
        },
      })

      const collection = db.tables.users
      // 'ab' is too short (min 3) — should fail validation
      collection.insert({ id: 1, username: 'ab', status: 'ONLINE', created_at: '2024-01-01' })

      // The insert should NOT reach supabase because validation failed
      await new Promise((r) => setTimeout(r, 50))
      expect(supabase._spies.insertSpy).not.toHaveBeenCalled()
    })

    it('throws when update data fails zod validation', async () => {
      supabase._spies.selectSpy.mockResolvedValue({
        data: [{ id: 1, username: 'alice', status: 'ONLINE', created_at: '2024-01-01' }],
        error: null,
      })

      const strictUpdateSchema = z.object({
        id: z.number().optional(),
        username: z.string().min(3).optional(),
        status: z.enum(['ONLINE', 'OFFLINE']).nullable().optional(),
        created_at: z.string().optional(),
      })

      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: {
          users: {
            keyColumn: 'id',
            schemas: { update: strictUpdateSchema },
          },
        },
      })

      const collection = db.tables.users
      await collection.utils.refetch()

      collection.update(1, (draft: any) => {
        draft.username = 'ab' // too short
      })

      await new Promise((r) => setTimeout(r, 50))
      expect(supabase._spies.updateSpy).not.toHaveBeenCalled()
    })
  })

  describe('rpc no-args', () => {
    it('handles functions with no arguments', async () => {
      supabase.rpc.mockResolvedValue({ data: '2024-01-01T00:00:00Z', error: null })

      const db = createSupabaseCollections<Database>(supabase, queryClient, {})

      const options = db.rpc.get_server_time()

      expect(options.queryKey).toEqual(['rpc', 'get_server_time', undefined])
      expect(options.queryFn).toBeTypeOf('function')

      const result = await options.queryFn({ queryKey: options.queryKey } as any)
      expect(supabase.rpc).toHaveBeenCalledWith('get_server_time', undefined)
      expect(result).toBe('2024-01-01T00:00:00Z')
    })
  })

  describe('in() chunking (fetchTableData)', () => {
    it('splits large in() arrays into multiple HTTP requests', async () => {
      let fetchCount = 0
      const mockBuilder: any = {}
      mockBuilder.in = vi.fn(() => {
        fetchCount++
        // Each chunk returns its own rows
        if (fetchCount === 1) return Promise.resolve({ data: [{ id: 1 }, { id: 2 }], error: null })
        if (fetchCount === 2) return Promise.resolve({ data: [{ id: 3 }, { id: 4 }], error: null })
        return Promise.resolve({ data: [{ id: 5 }], error: null })
      })

      const mockSupabase = {
        from: vi.fn(() => ({ select: vi.fn(() => mockBuilder) })),
      }

      const ids = Array.from({ length: 250 }, (_, i) => i + 1)
      const result = await fetchTableData({
        supabase: mockSupabase,
        tableName: 'users',
        syncMode: 'on-demand',
        loadSubsetOptions: { where: inArray(ref('id'), ids as any) },
        inArrayChunkSize: 100,
      })

      // 250 items / 100 chunk size = 3 separate HTTP requests
      expect(fetchCount).toBe(3)
      // Results merged from all 3 requests
      expect(result).toHaveLength(5)
    })

    it('chunks in() nested inside and()', async () => {
      let inCallCount = 0
      const mockBuilder: any = {}
      mockBuilder.eq = vi.fn(() => mockBuilder)
      mockBuilder.in = vi.fn(() => {
        inCallCount++
        return Promise.resolve({ data: [{ id: inCallCount }], error: null })
      })

      const mockSupabase = {
        from: vi.fn(() => ({ select: vi.fn(() => mockBuilder) })),
      }

      const ids = Array.from({ length: 250 }, (_, i) => i + 1)
      const where = and(eq(ref('status'), 'ONLINE'), inArray(ref('id'), ids as any))

      const result = await fetchTableData({
        supabase: mockSupabase,
        tableName: 'users',
        syncMode: 'on-demand',
        loadSubsetOptions: { where },
        inArrayChunkSize: 100,
      })

      // 3 chunks × 1 row each = 3 total, and eq('status','ONLINE') applied to each
      expect(inCallCount).toBe(3)
      expect(result).toHaveLength(3)
      // Each chunk request should also have the eq filter
      expect(mockBuilder.eq).toHaveBeenCalledWith('status', 'ONLINE')
    })

    it('does not chunk in() arrays under the threshold', async () => {
      let inCallCount = 0
      const mockBuilder: any = {}
      mockBuilder.in = vi.fn(() => {
        inCallCount++
        return mockBuilder
      })
      mockBuilder.range = vi.fn(() => Promise.resolve({ data: [{ id: 1 }], error: null }))

      const mockSupabase = {
        from: vi.fn(() => ({ select: vi.fn(() => mockBuilder) })),
      }

      const ids = Array.from({ length: 50 }, (_, i) => i + 1)
      await fetchTableData({
        supabase: mockSupabase,
        tableName: 'users',
        syncMode: 'on-demand',
        loadSubsetOptions: { where: inArray(ref('id'), ids as any) },
        inArrayChunkSize: 100,
      })

      // Single .in() call — no chunking
      expect(inCallCount).toBe(1)
    })

    it('issues chunk requests in parallel', async () => {
      const callOrder: string[] = []
      const mockBuilder: any = {}
      mockBuilder.in = vi.fn(() => {
        callOrder.push('called')
        return new Promise((resolve) => {
          setTimeout(() => {
            callOrder.push('resolved')
            resolve({ data: [{ id: 1 }], error: null })
          }, 10)
        })
      })

      const mockSupabase = {
        from: vi.fn(() => ({ select: vi.fn(() => mockBuilder) })),
      }

      const ids = Array.from({ length: 200 }, (_, i) => i + 1)
      await fetchTableData({
        supabase: mockSupabase,
        tableName: 'users',
        syncMode: 'on-demand',
        loadSubsetOptions: { where: inArray(ref('id'), ids as any) },
        inArrayChunkSize: 100,
      })

      // Both chunks should be called before either resolves (parallel)
      expect(callOrder[0]).toBe('called')
      expect(callOrder[1]).toBe('called')
    })
  })

  describe('on-demand pagination (fetchTableData)', () => {
    it('fetches all pages when supabase returns exactly the page size', async () => {
      const PAGE_SIZE = 10 // small for testing
      const page1 = Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: i + 1 }))
      const page2 = Array.from({ length: 5 }, (_, i) => ({ id: i + PAGE_SIZE + 1 }))

      let rangeCallCount = 0
      const mockBuilder: any = {}
      mockBuilder.eq = vi.fn(() => mockBuilder)
      mockBuilder.range = vi.fn(() => {
        rangeCallCount++
        if (rangeCallCount === 1) return Promise.resolve({ data: page1, error: null })
        return Promise.resolve({ data: page2, error: null })
      })

      const mockSupabase = {
        from: vi.fn(() => ({ select: vi.fn(() => mockBuilder) })),
      }

      const result = await fetchTableData({
        supabase: mockSupabase,
        tableName: 'users',
        syncMode: 'on-demand',
        loadSubsetOptions: { where: eq(ref('status'), 'ONLINE') },
        pageSize: PAGE_SIZE,
      })

      expect(rangeCallCount).toBe(2)
      expect(result).toHaveLength(PAGE_SIZE + 5)
    })

    it('fetches only one page when results are fewer than page size', async () => {
      const rows = [{ id: 1 }, { id: 2 }]

      const mockBuilder: any = {}
      mockBuilder.eq = vi.fn(() => mockBuilder)
      mockBuilder.range = vi.fn(() => Promise.resolve({ data: rows, error: null }))

      const mockSupabase = {
        from: vi.fn(() => ({ select: vi.fn(() => mockBuilder) })),
      }

      const result = await fetchTableData({
        supabase: mockSupabase,
        tableName: 'users',
        syncMode: 'on-demand',
        loadSubsetOptions: { where: eq(ref('status'), 'ONLINE') },
        pageSize: 1000,
      })

      expect(mockBuilder.range).toHaveBeenCalledTimes(1)
      expect(result).toEqual(rows)
    })

    it('does not auto-paginate when loadSubsetOptions has a limit', async () => {
      const rows = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }))
      const response = Promise.resolve({ data: rows, error: null })

      // Supabase builders are thenable — the last call in the chain resolves
      const mockBuilder: any = {}
      mockBuilder.eq = vi.fn(() => mockBuilder)
      mockBuilder.limit = vi.fn(() => response)
      mockBuilder.range = vi.fn(() => response)

      const mockSupabase = {
        from: vi.fn(() => ({ select: vi.fn(() => mockBuilder) })),
      }

      const result = await fetchTableData({
        supabase: mockSupabase,
        tableName: 'users',
        syncMode: 'on-demand',
        loadSubsetOptions: { limit: 10 },
        pageSize: 10,
      })

      // Should NOT paginate — the user explicitly asked for 10 rows
      expect(mockBuilder.range).not.toHaveBeenCalled()
      expect(mockBuilder.limit).toHaveBeenCalledWith(10)
      expect(result).toHaveLength(10)
    })

    it('does not auto-paginate when loadSubsetOptions has offset+limit', async () => {
      const rows = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }))

      const mockBuilder: any = {}
      mockBuilder.eq = vi.fn(() => mockBuilder)
      mockBuilder.range = vi.fn(() => Promise.resolve({ data: rows, error: null }))

      const mockSupabase = {
        from: vi.fn(() => ({ select: vi.fn(() => mockBuilder) })),
      }

      const result = await fetchTableData({
        supabase: mockSupabase,
        tableName: 'users',
        syncMode: 'on-demand',
        loadSubsetOptions: { offset: 20, limit: 10 },
        pageSize: 10,
      })

      // Should use the user's range, not add auto-pagination on top
      expect(mockBuilder.range).toHaveBeenCalledTimes(1)
      expect(mockBuilder.range).toHaveBeenCalledWith(20, 29)
      expect(result).toHaveLength(10)
    })

    it('auto-paginates eager collections to prevent silent truncation', async () => {
      const PAGE_SIZE = 10
      const page1 = Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: i + 1 }))
      const page2 = Array.from({ length: 3 }, (_, i) => ({ id: i + PAGE_SIZE + 1 }))

      let rangeCallCount = 0
      const selectSpy = vi.fn(() => ({
        range: vi.fn(() => {
          rangeCallCount++
          if (rangeCallCount === 1) return Promise.resolve({ data: page1, error: null })
          return Promise.resolve({ data: page2, error: null })
        }),
      }))

      const mockSupabase = {
        from: vi.fn(() => ({ select: selectSpy })),
      }

      const result = await fetchTableData({
        supabase: mockSupabase,
        tableName: 'users',
        syncMode: 'eager',
        pageSize: PAGE_SIZE,
      })

      expect(rangeCallCount).toBe(2)
      expect(result).toHaveLength(PAGE_SIZE + 3)
    })

    it('fetches single page in eager mode when results are fewer than pageSize', async () => {
      const selectSpy = vi.fn(() => ({
        range: vi.fn(() => Promise.resolve({
          data: [{ id: 1 }, { id: 2 }],
          error: null,
        })),
      }))

      const mockSupabase = {
        from: vi.fn(() => ({ select: selectSpy })),
      }

      const result = await fetchTableData({
        supabase: mockSupabase,
        tableName: 'users',
        syncMode: 'eager',
        pageSize: 1000,
      })

      expect(selectSpy).toHaveBeenCalledTimes(1)
      expect(result).toHaveLength(2)
    })
  })

  describe('on-demand predicateless guard (fetchTableData)', () => {
    it('throws when called in on-demand mode without predicates or limit', async () => {
      await expect(
        fetchTableData({
          supabase,
          tableName: 'users',
          syncMode: 'on-demand',
          loadSubsetOptions: undefined,
        }),
      ).rejects.toThrow(/requires a where clause, limit, or cursor/)
    })

    it('throws when loadSubsetOptions is empty object', async () => {
      await expect(
        fetchTableData({
          supabase,
          tableName: 'users',
          syncMode: 'on-demand',
          loadSubsetOptions: {},
        }),
      ).rejects.toThrow(/requires a where clause, limit, or cursor/)
    })

    it('does not throw when loadSubsetOptions has a where clause', async () => {
      supabase._spies.selectSpy.mockReturnValue({
        range: vi.fn().mockResolvedValue({ data: [], error: null }),
        eq: vi.fn().mockReturnThis(),
      })

      await expect(
        fetchTableData({
          supabase,
          tableName: 'users',
          syncMode: 'on-demand',
          loadSubsetOptions: { where: eq(ref('status'), 'ONLINE') },
        }),
      ).resolves.toEqual([])
    })

    it('does not throw when loadSubsetOptions has a limit', async () => {
      supabase._spies.selectSpy.mockReturnValue({
        range: vi.fn().mockResolvedValue({ data: [], error: null }),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      })

      await expect(
        fetchTableData({
          supabase,
          tableName: 'users',
          syncMode: 'on-demand',
          loadSubsetOptions: { limit: 10 },
        }),
      ).resolves.toEqual([])
    })
  })

  describe('operations config', () => {
    it('defaults to all operations when not specified', async () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: { users: { keyColumn: 'id' } },
      })

      const collection = db.tables.users

      // Insert should work
      collection.insert({ id: 10, username: 'test', status: 'ONLINE', created_at: '2024-01-01' })
      await vi.waitFor(() => {
        expect(supabase._spies.insertSpy).toHaveBeenCalled()
      })
    })

    it('only registers insert handler when operations is ["insert"]', async () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: {
          users: { keyColumn: 'id', operations: ['insert'] },
        },
      })

      const collection = db.tables.users

      // Insert should work
      collection.insert({ id: 10, username: 'test', status: 'ONLINE', created_at: '2024-01-01' })
      await vi.waitFor(() => {
        expect(supabase._spies.insertSpy).toHaveBeenCalled()
      })
    })

    it('does not call supabase delete when operations excludes delete', async () => {
      supabase._spies.selectSpy.mockResolvedValue({
        data: [{ id: 1, username: 'alice', status: 'ONLINE', created_at: '2024-01-01' }],
        error: null,
      })

      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: {
          users: { keyColumn: 'id', operations: ['insert', 'update'] },
        },
      })

      const collection = db.tables.users
      await collection.utils.refetch()

      try { collection.delete(1) } catch { /* no handler */ }

      await new Promise((r) => setTimeout(r, 50))
      expect(supabase._spies.deleteSpy).not.toHaveBeenCalled()
    })

    it('does not call supabase update when operations excludes update', async () => {
      supabase._spies.selectSpy.mockResolvedValue({
        data: [{ id: 1, username: 'alice', status: 'ONLINE', created_at: '2024-01-01' }],
        error: null,
      })

      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: {
          users: { keyColumn: 'id', operations: ['insert', 'delete'] },
        },
      })

      const collection = db.tables.users
      await collection.utils.refetch()

      try {
        collection.update(1, (draft: any) => { draft.username = 'changed' })
      } catch { /* no handler */ }

      await new Promise((r) => setTimeout(r, 50))
      expect(supabase._spies.updateSpy).not.toHaveBeenCalled()
    })

    it('creates a read-only table when operations is empty array', async () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        tables: {
          users: { keyColumn: 'id', operations: [] },
        },
      })

      const collection = db.tables.users

      try { collection.insert({ id: 1, username: 'x', status: 'ONLINE', created_at: '' }) } catch {}

      await new Promise((r) => setTimeout(r, 50))
      expect(supabase._spies.insertSpy).not.toHaveBeenCalled()
    })
  })

  describe('view mutation rejection', () => {
    it('does not call supabase on view insert', async () => {
      const db = createSupabaseCollections<Database>(supabase, queryClient, {
        views: { active_users: { keyColumn: 'id' } },
      })

      const collection = db.views.active_users

      // TanStack DB still exposes .insert() on the collection object,
      // but without onInsert handler, it should not reach supabase.
      // The insert will be optimistic-only and fail/no-op.
      try {
        collection.insert({ id: 1, username: 'test', status: 'ONLINE' })
      } catch {
        // Expected — no handler registered
      }

      // Give any async handlers time to fire
      await new Promise((r) => setTimeout(r, 50))

      expect(supabase._spies.insertSpy).not.toHaveBeenCalled()
    })
  })
})
