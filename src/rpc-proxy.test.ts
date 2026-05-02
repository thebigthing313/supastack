import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createRpcProxy } from './rpc-proxy.ts'

describe('createRpcProxy', () => {
  it('uses cached dynamic factories for RPC query options', () => {
    const supabase = {
      rpc: vi.fn(),
    }
    const rpc = createRpcProxy(supabase, {
      search_users: {
        staleTime: 1000,
      },
    })

    expect(rpc.search_users).toBe(rpc.search_users)

    const configuredOptions = rpc.search_users({ query: 'Ada' })
    const dynamicOptions = rpc.unconfigured_function({ id: 1 })

    expect(configuredOptions).toMatchObject({
      queryKey: ['rpc', 'search_users', { query: 'Ada' }],
      staleTime: 1000,
    })
    expect(dynamicOptions.queryKey).toEqual(['rpc', 'unconfigured_function', { id: 1 }])
    expect(dynamicOptions.queryFn).toBeTypeOf('function')
  })

  it('applies RPC arg and return transforms around the network call', async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: { count: '2' },
        error: null,
      }),
    }
    const rpc = createRpcProxy(supabase, {
      search_users: {
        schemas: {
          args: z.object({ query: z.string().trim() }),
          returns: z.object({ count: z.string() }).transform(({ count }) => Number(count)),
        },
      },
    })

    const options = rpc.search_users({ query: '  Ada  ' })
    const result = await options.queryFn()

    expect(supabase.rpc).toHaveBeenCalledWith('search_users', { query: 'Ada' })
    expect(result).toBe(2)
  })
})
