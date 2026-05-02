import { describe, expect, it, vi } from 'vitest'
import { createLazyRegistry } from './lazy-registry.ts'

describe('createLazyRegistry', () => {
  it('does not create entries for symbol or Promise-like property access', () => {
    const create = vi.fn((name: string) => ({ name }))
    const registry = createLazyRegistry({
      entries: { users: {} },
      create,
    })

    expect(registry[Symbol.toPrimitive as any]).toBeUndefined()
    expect(registry[Symbol.iterator as any]).toBeUndefined()
    expect((registry as any).then).toBeUndefined()
    expect((registry as any).catch).toBeUndefined()
    expect((registry as any).finally).toBeUndefined()
    expect(create).not.toHaveBeenCalled()
  })

  it('returns the same cached value on repeated access', () => {
    const create = vi.fn((name: string) => ({ name }))
    const registry = createLazyRegistry({
      entries: { users: {} },
      create,
    })

    expect(registry.users).toBe(registry.users)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('returns undefined for unknown configured-map entries', () => {
    const create = vi.fn((name: string) => ({ name }))
    const registry = createLazyRegistry({
      entries: { users: {} },
      create,
    })

    expect(registry.posts).toBeUndefined()
    expect(create).not.toHaveBeenCalled()
  })

  it('enumerates configured names and preserves cached instances when spread', () => {
    const create = vi.fn((name: string, config: { key: string } | undefined) => ({ name, config }))
    const registry = createLazyRegistry({
      entries: {
        users: { key: 'id' },
        posts: { key: 'slug' },
      },
      create,
    })

    expect(Object.keys(registry)).toEqual(['users', 'posts'])
    expect(create).not.toHaveBeenCalled()

    const users = registry.users
    const spread = { ...registry }

    expect(spread.users).toBe(users)
    expect(spread.posts).toEqual({ name: 'posts', config: { key: 'slug' } })
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('allows dynamic registries to create any safe string key', () => {
    const create = vi.fn((name: string, config?: { staleTime: number }) =>
      (args: unknown) => ({
        queryKey: ['rpc', name, args] as const,
        staleTime: config?.staleTime,
      }),
    )
    const registry = createLazyRegistry({
      mode: 'dynamic',
      entries: { configured_rpc: { staleTime: 1000 } },
      create,
    })

    expect(registry.configured_rpc).toBe(registry.configured_rpc)
    expect(registry.configured_rpc?.({ id: 1 })).toEqual({
      queryKey: ['rpc', 'configured_rpc', { id: 1 }],
      staleTime: 1000,
    })
    expect(registry.unconfigured_rpc?.({ id: 2 })).toEqual({
      queryKey: ['rpc', 'unconfigured_rpc', { id: 2 }],
      staleTime: undefined,
    })
    expect(create).toHaveBeenCalledTimes(2)
  })
})
