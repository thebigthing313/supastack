import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createMutationHandlers } from './mutation-handlers.ts'

function createHarness() {
  const insert = vi.fn().mockResolvedValue({ data: null, error: null })
  const updateEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const update = vi.fn(() => ({ eq: updateEq }))
  const from = vi.fn(() => ({ insert, update }))
  const collection = {
    utils: {
      refetch: vi.fn().mockResolvedValue(undefined),
    },
  }

  return {
    collection,
    insert,
    update,
    updateEq,
    supabase: { from },
  }
}

describe('createMutationHandlers schema boundaries', () => {
  it('applies insert transforms before calling Supabase', async () => {
    const harness = createHarness()
    const handlers = createMutationHandlers({
      tableName: 'users',
      keyColumn: 'id',
      supabase: harness.supabase,
      schemas: {
        insert: z.object({
          id: z.number(),
          username: z.string().trim(),
        }),
      },
    })

    await handlers.onInsert!({
      transaction: {
        mutations: [{ modified: { id: 1, username: '  ada  ' } }],
      },
      collection: harness.collection,
    })

    expect(harness.insert).toHaveBeenCalledWith({ id: 1, username: 'ada' })
  })

  it('applies update transforms before calling Supabase', async () => {
    const harness = createHarness()
    const handlers = createMutationHandlers({
      tableName: 'users',
      keyColumn: 'id',
      supabase: harness.supabase,
      schemas: {
        update: z.object({
          username: z.string().toUpperCase().optional(),
        }),
      },
    })

    await handlers.onUpdate!({
      transaction: {
        mutations: [{ key: 1, changes: { username: 'ada' } }],
      },
      collection: harness.collection,
    })

    expect(harness.update).toHaveBeenCalledWith({ username: 'ADA' })
    expect(harness.updateEq).toHaveBeenCalledWith('id', 1)
  })
})
