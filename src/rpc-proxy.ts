import type { StandardSchemaV1 } from '@standard-schema/spec'

interface SupabaseClientLike {
  rpc(fn: string, args?: any): any
}

export interface RpcConfig {
  schemas?: {
    args?: StandardSchemaV1
    returns?: StandardSchemaV1
  }
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

const PROXY_GUARD_KEYS = new Set(['then', 'toJSON', 'valueOf', '$$typeof', 'constructor', 'prototype'])

const RPC_QUERY_OPTION_KEYS = ['staleTime', 'retry', 'gcTime'] as const

async function validateWithSchema(schema: StandardSchemaV1, data: unknown): Promise<unknown> {
  const result = await schema['~standard'].validate(data)
  if (result.issues) throw new Error(`Validation failed: ${JSON.stringify(result.issues)}`)
  return result.value
}

export function createRpcProxy(
  supabase: SupabaseClientLike,
  rpcConfigs?: Record<string, RpcConfig>,
): any {
  return new Proxy({} as any, {
    get(_target, fnName: string | symbol) {
      if (typeof fnName !== 'string' || PROXY_GUARD_KEYS.has(fnName)) return undefined

      const fnConfig = rpcConfigs?.[fnName]

      return (args: any, callOpts?: Partial<Pick<RpcConfig, 'staleTime' | 'retry' | 'gcTime'>>) => {
        // Merge query options: config-level defaults, then per-call overrides
        const queryOpts: Record<string, unknown> = {}
        if (fnConfig) {
          for (const key of RPC_QUERY_OPTION_KEYS) {
            if (fnConfig[key] !== undefined) queryOpts[key] = fnConfig[key]
          }
        }
        if (callOpts) {
          for (const key of RPC_QUERY_OPTION_KEYS) {
            if (callOpts[key] !== undefined) queryOpts[key] = callOpts[key]
          }
        }

        return {
          queryKey: ['rpc', fnName, args] as const,
          queryFn: async () => {
            let rpcArgs = args
            if (fnConfig?.schemas?.args) {
              rpcArgs = await validateWithSchema(fnConfig.schemas.args, args)
            }

            const { data, error } = await supabase.rpc(fnName, rpcArgs)
            if (error) throw error

            if (fnConfig?.schemas?.returns) {
              return await validateWithSchema(fnConfig.schemas.returns, data)
            }
            return data
          },
          ...queryOpts,
        } as RpcQueryOptions
      }
    },
  })
}
