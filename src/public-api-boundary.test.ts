import { afterEach, describe, expect, it, vi } from 'vitest'

const ADVANCED_FUNCTION_EXPORTS = [
  'createSupabaseCollections',
  'defineConfig',
  'createRelationReader',
  'executeQuery',
  'createQueryFn',
  'createMutationHandlers',
  'createRpcProxy',
  'applyLoadSubsetOptions',
  'fetchTableData',
] as const

const PRIVATE_HELPERS = [
  'applyQueryPlan',
  'compileLoadSubsetOptions',
  'createLazyRegistry',
] as const

afterEach(() => {
  vi.doUnmock('./query-pipeline.ts')
  vi.doUnmock('./relation-reader.ts')
  vi.resetModules()
  vi.clearAllMocks()
})

describe('public API boundary', () => {
  it('keeps the current root function exports available', async () => {
    const api = await import('./index.ts') as Record<string, unknown>

    for (const name of ADVANCED_FUNCTION_EXPORTS) {
      expect(api[name]).toBeTypeOf('function')
    }
  })

  it('does not expose private helper modules from the root entry point', async () => {
    const api = await import('./index.ts') as Record<string, unknown>

    for (const name of PRIVATE_HELPERS) {
      expect(api).not.toHaveProperty(name)
    }
  })

  it('keeps fetchTableData as a compatibility wrapper around executeQuery', async () => {
    const rows = [{ id: 1 }]
    const executeQuery = vi.fn().mockResolvedValue(rows)
    const createQueryFn = vi.fn()

    vi.doMock('./query-pipeline.ts', () => ({
      createQueryFn,
      executeQuery,
    }))

    const { fetchTableData } = await import('./index.ts')
    const supabase = {}
    const loadSubsetOptions = { limit: 1 } as any

    await expect(fetchTableData({
      supabase,
      tableName: 'users',
      syncMode: 'on-demand',
      select: 'id,username',
      loadSubsetOptions,
      pageSize: 50,
      inArrayChunkSize: 10,
    })).resolves.toBe(rows)

    expect(executeQuery).toHaveBeenCalledWith({
      supabase,
      tableName: 'users',
      syncMode: 'on-demand',
      select: 'id,username',
      pageSize: 50,
      inArrayChunkSize: 10,
    }, loadSubsetOptions)
  })

  it('keeps query-pipeline helpers delegated through the relation reader', async () => {
    const rows = [{ id: 1 }]
    const read = vi.fn().mockResolvedValue(rows)
    const createRelationReader = vi.fn(() => ({ read }))

    vi.doMock('./relation-reader.ts', () => ({
      createRelationReader,
    }))

    const { createQueryFn, executeQuery } = await import('./query-pipeline.ts')
    const supabase = {}
    const loadSubsetOptions = { limit: 1 } as any

    const queryFn = createQueryFn({
      supabase,
      tableName: 'users',
      syncMode: 'on-demand',
      select: 'id',
      pageSize: 25,
      inArrayChunkSize: 5,
    } as any)

    await expect(queryFn({ meta: { loadSubsetOptions } })).resolves.toBe(rows)

    expect(createRelationReader).toHaveBeenCalledWith({
      supabase,
      relationName: 'users',
      syncMode: 'on-demand',
      select: 'id',
      pageSize: 25,
      inArrayChunkSize: 5,
    })
    expect(read).toHaveBeenCalledWith(loadSubsetOptions)

    createRelationReader.mockClear()
    read.mockClear()

    await expect(executeQuery({
      supabase,
      tableName: 'active_users',
      syncMode: 'eager',
    } as any, loadSubsetOptions)).resolves.toBe(rows)

    expect(createRelationReader).toHaveBeenCalledWith({
      supabase,
      relationName: 'active_users',
      syncMode: 'eager',
    })
    expect(read).toHaveBeenCalledWith(loadSubsetOptions)
  })
})
