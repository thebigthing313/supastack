import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/query-core'
import { createRelationCollection } from './relation-collection-factory.ts'
import type { RelationCollectionFactoryDependencies } from './relation-collection-factory.ts'

function createHarness() {
  const queryFn = vi.fn()
  const queryCollectionResult = { source: 'queryCollectionOptions' }
  const collectionResult = { source: 'createCollection' }

  const dependencies = {
    createCollection: vi.fn(() => collectionResult),
    queryCollectionOptions: vi.fn(() => queryCollectionResult),
    createQueryFn: vi.fn(() => queryFn),
    createMutationHandlers: vi.fn(() => ({})),
  } satisfies RelationCollectionFactoryDependencies

  const supabase = { from: vi.fn(), rpc: vi.fn() }
  const queryClient = new QueryClient()

  return {
    collectionResult,
    dependencies,
    queryClient,
    queryCollectionResult,
    queryFn,
    supabase,
  }
}

function getRawOptions(dependencies: RelationCollectionFactoryDependencies): Record<string, any> {
  return vi.mocked(dependencies.queryCollectionOptions).mock.calls[0][0]
}

describe('createRelationCollection', () => {
  it('wires table reads and enabled mutation handlers', () => {
    const harness = createHarness()
    const onInsert = vi.fn()
    harness.dependencies.createMutationHandlers.mockReturnValue({ onInsert })

    const collection = createRelationCollection({
      kind: 'table',
      relationName: 'users',
      config: {
        keyColumn: 'id',
        operations: ['insert'],
        select: 'id,username',
        pageSize: 500,
        inArrayChunkSize: 50,
      },
      supabase: harness.supabase,
      queryClient: harness.queryClient,
      dependencies: harness.dependencies,
    })

    const rawOptions = getRawOptions(harness.dependencies)

    expect(collection).toBe(harness.collectionResult)
    expect(harness.dependencies.createQueryFn).toHaveBeenCalledWith({
      supabase: harness.supabase,
      tableName: 'users',
      syncMode: 'eager',
      select: 'id,username',
      pageSize: 500,
      inArrayChunkSize: 50,
    })
    expect(harness.dependencies.createMutationHandlers).toHaveBeenCalledWith({
      tableName: 'users',
      keyColumn: 'id',
      schemas: undefined,
      supabase: harness.supabase,
      operations: ['insert'],
    })
    expect(rawOptions).toEqual(expect.objectContaining({
      id: 'supabase-sync:users',
      queryFn: harness.queryFn,
      onInsert,
    }))
    expect(rawOptions.onUpdate).toBeUndefined()
    expect(rawOptions.onDelete).toBeUndefined()
  })

  it('wires view reads and row schemas without mutation handlers', () => {
    const harness = createHarness()
    const rowSchema = { '~standard': { validate: vi.fn() } } as any

    createRelationCollection({
      kind: 'view',
      relationName: 'active_users',
      config: {
        keyColumn: 'id',
        schemas: { row: rowSchema },
      },
      supabase: harness.supabase,
      queryClient: harness.queryClient,
      dependencies: harness.dependencies,
    })

    const rawOptions = getRawOptions(harness.dependencies)

    expect(harness.dependencies.createMutationHandlers).not.toHaveBeenCalled()
    expect(rawOptions).toEqual(expect.objectContaining({
      id: 'supabase-sync:active_users',
      queryFn: harness.queryFn,
      schema: rowSchema,
    }))
  })

  it('passes query options through to TanStack collection options once', () => {
    const harness = createHarness()

    createRelationCollection({
      kind: 'table',
      relationName: 'users',
      config: {
        keyColumn: 'id',
        staleTime: 30_000,
        refetchInterval: 60_000,
        enabled: false,
        retry: 3,
        retryDelay: 1000,
        gcTime: 300_000,
      },
      supabase: harness.supabase,
      queryClient: harness.queryClient,
      dependencies: harness.dependencies,
    })

    const rawOptions = getRawOptions(harness.dependencies)

    expect(harness.dependencies.queryCollectionOptions).toHaveBeenCalledTimes(1)
    expect(harness.dependencies.createCollection).toHaveBeenCalledWith(harness.queryCollectionResult)
    expect(rawOptions).toEqual(expect.objectContaining({
      staleTime: 30_000,
      refetchInterval: 60_000,
      enabled: false,
      retry: 3,
      retryDelay: 1000,
      gcTime: 300_000,
    }))
  })

  it('wraps final collection options exactly once', () => {
    const harness = createHarness()
    const wrappedOptions = { source: 'wrappedOptions' }
    const wrapOptions = vi.fn(() => wrappedOptions)

    createRelationCollection({
      kind: 'table',
      relationName: 'users',
      config: { keyColumn: 'id' },
      supabase: harness.supabase,
      queryClient: harness.queryClient,
      wrapOptions,
      dependencies: harness.dependencies,
    })

    expect(harness.dependencies.queryCollectionOptions).toHaveBeenCalledTimes(1)
    expect(wrapOptions).toHaveBeenCalledTimes(1)
    expect(wrapOptions).toHaveBeenCalledWith(harness.queryCollectionResult)
    expect(harness.dependencies.createCollection).toHaveBeenCalledWith(wrappedOptions)
  })

  it('creates eager and on-demand query keys', () => {
    const eagerHarness = createHarness()
    createRelationCollection({
      kind: 'table',
      relationName: 'users',
      config: { keyColumn: 'id' },
      supabase: eagerHarness.supabase,
      queryClient: eagerHarness.queryClient,
      dependencies: eagerHarness.dependencies,
    })

    expect(getRawOptions(eagerHarness.dependencies).queryKey).toEqual(['users'])

    const onDemandHarness = createHarness()
    createRelationCollection({
      kind: 'table',
      relationName: 'logs',
      config: { keyColumn: 'id', syncMode: 'on-demand' },
      supabase: onDemandHarness.supabase,
      queryClient: onDemandHarness.queryClient,
      dependencies: onDemandHarness.dependencies,
    })

    const queryKey = getRawOptions(onDemandHarness.dependencies).queryKey
    const where = { type: 'eq', field: 'user_id', value: 1 }
    const orderBy = [{ field: 'created_at', direction: 'desc' }]

    expect(queryKey()).toEqual(['logs'])
    expect(queryKey({
      where,
      orderBy,
      cursor: 'cursor-1',
      limit: 20,
      offset: 40,
      ignored: true,
    })).toEqual(['logs', {
      where,
      orderBy,
      cursor: 'cursor-1',
      limit: 20,
      offset: 40,
    }])
  })

  it('extracts keys from the configured key column', () => {
    const harness = createHarness()
    createRelationCollection({
      kind: 'table',
      relationName: 'users',
      config: { keyColumn: 'username' },
      supabase: harness.supabase,
      queryClient: harness.queryClient,
      dependencies: harness.dependencies,
    })

    const rawOptions = getRawOptions(harness.dependencies)

    expect(rawOptions.getKey({ id: 1, username: 'alice' })).toBe('alice')
  })
})
