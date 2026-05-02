import { createLazyRegistry } from './lazy-registry.ts'
import { validateRpcArgs, validateRpcReturns } from './schema-boundary.ts'
import type { RpcSchemas } from './schema-boundary.ts'

interface SupabaseClientLike {
  rpc(fn: string, args?: any): any
}

export interface RpcConfig {
  schemas?: RpcSchemas
  staleTime?: number
  retry?: number | boolean
  gcTime?: number
}

export type RpcQueryOptions<TReturns = unknown> = {
  queryKey: readonly unknown[]
  queryFn: (...args: any[]) => Promise<TReturns>
  staleTime?: number
  retry?: number | boolean
  gcTime?: number
}

const RPC_QUERY_OPTION_KEYS = ['staleTime', 'retry', 'gcTime'] as const

export function createRpcProxy(
  supabase: SupabaseClientLike,
  rpcConfigs?: Record<string, RpcConfig>,
): any {
  return createLazyRegistry({
    mode: 'dynamic',
    entries: rpcConfigs,
    create: (fnName, fnConfig) => {
      return (args: any, callOpts?: Partial<Pick<RpcConfig, 'staleTime' | 'retry' | 'gcTime'>>) => {
        const queryOpts: Record<string, unknown> = {}
        for (const key of RPC_QUERY_OPTION_KEYS) {
          if (fnConfig?.[key] !== undefined) queryOpts[key] = fnConfig[key]
          if (callOpts?.[key] !== undefined) queryOpts[key] = callOpts[key]
        }

        return {
          queryKey: ['rpc', fnName, args] as const,
          queryFn: async () => {
            const rpcArgs = await validateRpcArgs(fnConfig?.schemas?.args, args)

            const { data, error } = await supabase.rpc(fnName, rpcArgs)
            if (error) throw error

            return validateRpcReturns(fnConfig?.schemas?.returns, data)
          },
          ...queryOpts,
        } as RpcQueryOptions
      }
    },
  })
}
