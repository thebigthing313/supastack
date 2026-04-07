import { createCollection } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import type { QueryClient } from '@tanstack/query-core'
// Structural type instead of SupabaseClient class — avoids version mismatch
// issues with protected members when consumers use a different supabase-js version.
interface SupabaseClientLike {
  from(table: string): any
  rpc(fn: string, args?: any): any
}
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Collection } from '@tanstack/db'
import type { QueryCollectionUtils } from '@tanstack/query-db-collection'
import { fetchTableData } from './fetch-table-data'
export { applyLoadSubsetOptions } from './apply-load-subset-options'
export { fetchTableData } from './fetch-table-data'

// ---------------------------------------------------------------------------
// Type-level utilities for extracting table/view/function info from Database
// ---------------------------------------------------------------------------

type SchemaOf<DB> = DB extends { public: infer S } ? S : never

type TablesOf<DB> = SchemaOf<DB> extends { Tables: infer T } ? T : never
type ViewsOf<DB> = SchemaOf<DB> extends { Views: infer V } ? V : never
type FunctionsOf<DB> = SchemaOf<DB> extends { Functions: infer F } ? F : never

type RowOf<T> = T extends { Row: infer R } ? R : never
type ArgsOf<T> = T extends { Args: infer A } ? A : never
type ReturnsOf<T> = T extends { Returns: infer R } ? R : never

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface TableSchemas {
  /** Schema to validate/transform row data fetched from Supabase. */
  row?: StandardSchemaV1
  /** Schema to validate/transform data before inserting. Receives the full row. */
  insert?: StandardSchemaV1
  /**
   * Schema to validate/transform data before updating.
   * Receives only the changed fields (partial), not the full row.
   * All fields in this schema should be optional.
   */
  update?: StandardSchemaV1
}

export interface QueryOptions {
  staleTime?: number
  refetchInterval?: number | false
  enabled?: boolean
  retry?: number | boolean
  retryDelay?: number
  gcTime?: number
}

interface BaseCollectionConfig<TRow extends Record<string, unknown>> extends QueryOptions {
  keyColumn: keyof TRow & string
  syncMode?: 'eager' | 'on-demand'
  pageSize?: number
  inArrayChunkSize?: number
}

export interface TableConfig<TRow extends Record<string, unknown>> extends BaseCollectionConfig<TRow> {
  schemas?: TableSchemas
}

export interface ViewConfig<TRow extends Record<string, unknown>> extends BaseCollectionConfig<TRow> {
  schemas?: { row?: StandardSchemaV1 }
}

type TableConfigs<DB> = {
  [K in keyof TablesOf<DB>]?: TableConfig<RowOf<TablesOf<DB>[K]> & Record<string, unknown>>
}

type ViewConfigs<DB> = {
  [K in keyof ViewsOf<DB>]?: ViewConfig<RowOf<ViewsOf<DB>[K]> & Record<string, unknown>>
}

export interface SupabaseCollectionsConfig<DB> {
  tables?: TableConfigs<DB>
  views?: ViewConfigs<DB>
}

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

type SyncCollection<TRow extends Record<string, unknown>> =
  Collection<TRow, string | number, QueryCollectionUtils<TRow, string | number, TRow, unknown>, any, TRow>

type AllTableCollections<DB> = {
  [K in keyof TablesOf<DB>]: SyncCollection<RowOf<TablesOf<DB>[K]> & Record<string, unknown>>
}

type AllViewCollections<DB> = {
  [K in keyof ViewsOf<DB>]: SyncCollection<RowOf<ViewsOf<DB>[K]> & Record<string, unknown>>
}

export type RpcQueryOptions<TReturns> = {
  queryKey: readonly unknown[]
  queryFn: (...args: any[]) => Promise<TReturns>
}

type IsEmptyArgs<T> = T extends Record<PropertyKey, never> ? true : false

type RpcResult<DB> = {
  [K in keyof FunctionsOf<DB>]: IsEmptyArgs<ArgsOf<FunctionsOf<DB>[K]>> extends true
    ? (args?: undefined) => RpcQueryOptions<ReturnsOf<FunctionsOf<DB>[K]>>
    : (args: ArgsOf<FunctionsOf<DB>[K]>) => RpcQueryOptions<ReturnsOf<FunctionsOf<DB>[K]>>
}

interface SupabaseCollectionsResult<DB> {
  tables: AllTableCollections<DB>
  views: AllViewCollections<DB>
  rpc: RpcResult<DB>
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const PROXY_GUARD_KEYS = new Set(['then', 'toJSON', 'valueOf', '$$typeof', 'constructor', 'prototype'])

const QUERY_OPTION_KEYS = ['staleTime', 'refetchInterval', 'enabled', 'retry', 'retryDelay', 'gcTime'] as const

function pickDefined(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    if (source[key] !== undefined) result[key] = source[key]
  }
  return result
}

async function validateWithSchema(schema: StandardSchemaV1, data: unknown): Promise<unknown> {
  const result = await schema['~standard'].validate(data)
  if (result.issues) throw new Error(`Validation failed: ${JSON.stringify(result.issues)}`)
  return result.value
}

function buildBaseCollectionOptions(
  name: string,
  config: Record<string, any>,
  supabase: SupabaseClientLike,
  queryClient: QueryClient,
): Record<string, any> {
  const { keyColumn, syncMode = 'eager' } = config

  return {
    id: `supabase-sync:${name}`,
    queryKey: [name],
    queryFn: async (context: any) => {
      return fetchTableData({
        supabase,
        tableName: name,
        syncMode,
        loadSubsetOptions: context.meta?.loadSubsetOptions,
        ...pickDefined(config, ['pageSize', 'inArrayChunkSize']),
      })
    },
    queryClient,
    syncMode,
    startSync: true,
    getKey: (row: any) => row[keyColumn],
    ...pickDefined(config, QUERY_OPTION_KEYS),
  }
}

async function withRefetch(col: any, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } finally {
    await col.utils.refetch()
  }
}

function buildMutationHandlers(
  tableName: string,
  keyColumn: string,
  schemas: TableSchemas | undefined,
  supabase: any,
): Record<string, any> {
  const table = () => supabase.from(tableName)

  return {
    onInsert: async ({ transaction, collection: col }: any) => {
      await withRefetch(col, async () => {
        const items = []
        for (const mutation of transaction.mutations) {
          let item = mutation.modified
          if (schemas?.insert) {
            item = await validateWithSchema(schemas.insert, item)
          }
          items.push(item)
        }
        const payload = items.length === 1 ? items[0] : items
        const { error } = await table().insert(payload)
        if (error) throw error
      })
    },
    onUpdate: async ({ transaction, collection: col }: any) => {
      await withRefetch(col, async () => {
        for (const mutation of transaction.mutations) {
          const { key, changes } = mutation
          let updateData = changes
          if (schemas?.update) {
            updateData = await validateWithSchema(schemas.update, changes)
          }
          const { error } = await table().update(updateData).eq(keyColumn, key)
          if (error) throw error
        }
      })
    },
    onDelete: async ({ transaction, collection: col }: any) => {
      await withRefetch(col, async () => {
        const keys = transaction.mutations.map((m: any) => m.key)
        const { error } = await table().delete().in(keyColumn, keys)
        if (error) throw error
      })
    },
  }
}

function createCachedProxy(
  cache: Map<string, any>,
  configMap: Record<string, any> | undefined,
  factory: (name: string, config: any) => any,
) {
  return new Proxy({} as any, {
    get(_target, name: string | symbol) {
      if (typeof name !== 'string' || PROXY_GUARD_KEYS.has(name)) return undefined
      if (cache.has(name)) return cache.get(name)

      const itemConfig = configMap?.[name]
      if (!itemConfig) return undefined

      const item = factory(name, itemConfig)
      cache.set(name, item)
      return item
    },
  })
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export function createSupabaseCollections<DB>(
  supabase: SupabaseClientLike,
  queryClient: QueryClient,
  config: SupabaseCollectionsConfig<DB>,
): SupabaseCollectionsResult<DB> {
  const tables = createCachedProxy(
    new Map(),
    config.tables as any,
    (name, tableConfig) => {
      const opts = buildBaseCollectionOptions(name, tableConfig, supabase, queryClient)
      Object.assign(opts, buildMutationHandlers(name, tableConfig.keyColumn, tableConfig.schemas, supabase))
      if (tableConfig.schemas?.row) opts.schema = tableConfig.schemas.row
      return createCollection(queryCollectionOptions(opts as any))
    },
  )

  const views = createCachedProxy(
    new Map(),
    config.views as any,
    (name, viewConfig) => {
      const opts = buildBaseCollectionOptions(name, viewConfig, supabase, queryClient)
      if (viewConfig.schemas?.row) opts.schema = viewConfig.schemas.row
      return createCollection(queryCollectionOptions(opts as any))
    },
  )

  const rpc = new Proxy({} as any, {
    get(_target, fnName: string | symbol) {
      if (typeof fnName !== 'string' || PROXY_GUARD_KEYS.has(fnName)) return undefined
      return (args: any) => ({
        queryKey: ['rpc', fnName, args] as const,
        queryFn: async () => {
          const { data, error } = await (supabase as any).rpc(fnName, args)
          if (error) throw error
          return data
        },
      })
    },
  })

  return { tables, views, rpc } as SupabaseCollectionsResult<DB>
}
