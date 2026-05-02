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
import { createQueryFn } from './query-pipeline.ts'
import { createMutationHandlers } from './mutation-handlers.ts'
import { createRpcProxy } from './rpc-proxy.ts'
import type { RpcConfig } from './rpc-proxy.ts'
export { applyLoadSubsetOptions } from './apply-load-subset-options.ts'
export { fetchTableData } from './fetch-table-data.ts'
export { createQueryFn, executeQuery } from './query-pipeline.ts'
export { createRelationReader } from './relation-reader.ts'
export { createMutationHandlers } from './mutation-handlers.ts'
export type { MutationHandlerConfig, MutationHandlers } from './mutation-handlers.ts'
export { createRpcProxy } from './rpc-proxy.ts'
export type { RpcConfig } from './rpc-proxy.ts'
export type { RelationReader, RelationReaderConfig, SupabaseRelationClient } from './relation-reader.ts'

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
  /** Whether to start syncing immediately on creation. Defaults to true. Set false for auth-gated collections. */
  startSync?: boolean
  /** Column selection passed to Supabase's .select(). Defaults to '*'. */
  select?: string
  /** Automatic index creation for where expressions. */
  autoIndex?: 'off' | 'eager'
  /** Index constructor to use when autoIndex is 'eager'. Required when autoIndex is 'eager'. */
  defaultIndexType?: any
  pageSize?: number
  inArrayChunkSize?: number
}

type CrudOperation = 'insert' | 'update' | 'delete'

export interface TableConfig<TRow extends Record<string, unknown>> extends BaseCollectionConfig<TRow> {
  schemas?: TableSchemas
  /** Which mutation operations to enable. Defaults to all: ['insert', 'update', 'delete']. */
  operations?: CrudOperation[]
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

type RpcConfigs<DB> = {
  [K in keyof FunctionsOf<DB>]?: RpcConfig
}

export interface SupabaseCollectionsConfig<DB> {
  tables?: TableConfigs<DB>
  views?: ViewConfigs<DB>
  rpcs?: RpcConfigs<DB>
  /**
   * Optional hook to wrap collection options before `createCollection`.
   * Use this to add persistence (e.g., `persistedCollectionOptions` from @tanstack/db-sqlite-persistence-core).
   */
  wrapOptions?: (options: any) => any
}

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

type SyncCollection<TRow extends Record<string, unknown>, TKey extends string | number = string | number> =
  Collection<TRow, TKey, QueryCollectionUtils<TRow, TKey, TRow, unknown>, any, TRow>

type InferRowType<TDefault extends Record<string, unknown>, TConfig> =
  [TConfig] extends [never]
    ? TDefault
    : TConfig extends { schemas: { row: infer S extends StandardSchemaV1 } }
      ? StandardSchemaV1.InferOutput<S> extends Record<string, unknown>
        ? StandardSchemaV1.InferOutput<S>
        : TDefault
      : TDefault

type InferKeyType<TRow extends Record<string, unknown>, TConfig> =
  [TConfig] extends [never]
    ? string | number
    : TConfig extends { keyColumn: infer K extends keyof TRow }
      ? TRow[K] extends string | number ? TRow[K] : string | number
      : string | number

type AllTableCollections<DB, TConfigs> = {
  [K in keyof TablesOf<DB>]: SyncCollection<
    InferRowType<RowOf<TablesOf<DB>[K]> & Record<string, unknown>, K extends keyof NonNullable<TConfigs> ? NonNullable<TConfigs>[K] : never>,
    InferKeyType<RowOf<TablesOf<DB>[K]> & Record<string, unknown>, K extends keyof NonNullable<TConfigs> ? NonNullable<TConfigs>[K] : never>
  >
}

type AllViewCollections<DB, TConfigs> = {
  [K in keyof ViewsOf<DB>]: SyncCollection<
    InferRowType<RowOf<ViewsOf<DB>[K]> & Record<string, unknown>, K extends keyof NonNullable<TConfigs> ? NonNullable<TConfigs>[K] : never>,
    InferKeyType<RowOf<ViewsOf<DB>[K]> & Record<string, unknown>, K extends keyof NonNullable<TConfigs> ? NonNullable<TConfigs>[K] : never>
  >
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

interface SupabaseCollectionsResult<DB, TConfig extends SupabaseCollectionsConfig<DB>> {
  tables: AllTableCollections<DB, TConfig['tables']>
  views: AllViewCollections<DB, TConfig['views']>
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

function buildBaseCollectionOptions(
  name: string,
  config: Record<string, any>,
  supabase: SupabaseClientLike,
  queryClient: QueryClient,
): Record<string, any> {
  const { keyColumn, syncMode = 'eager', startSync = true, select = '*', autoIndex, defaultIndexType } = config

  const queryKey: any = syncMode === 'on-demand'
    ? (opts: any) => {
      const key: Record<string, unknown> = {}
      if (opts.where !== undefined) key.where = opts.where
      if (opts.orderBy !== undefined) key.orderBy = opts.orderBy
      if (opts.cursor !== undefined) key.cursor = opts.cursor
      if (opts.limit !== undefined) key.limit = opts.limit
      if (opts.offset !== undefined) key.offset = opts.offset
      return Object.keys(key).length > 0 ? [name, key] : [name]
    }
    : [name]

  return {
    id: `supabase-sync:${name}`,
    queryKey,
    queryFn: createQueryFn({
      supabase,
      tableName: name,
      syncMode,
      select,
      ...pickDefined(config, ['pageSize', 'inArrayChunkSize']),
    }),
    queryClient,
    syncMode,
    startSync,
    getKey: (row: any) => row[keyColumn],
    ...(autoIndex !== undefined && { autoIndex }),
    ...(defaultIndexType !== undefined && { defaultIndexType }),
    ...pickDefined(config, QUERY_OPTION_KEYS),
  }
}

function createCachedProxy(
  cache: Map<string, any>,
  configMap: Record<string, any> | undefined,
  factory: (name: string, config: any) => any,
) {
  const proxy = new Proxy({} as any, {
    get(_target, name: string | symbol) {
      if (typeof name !== 'string' || PROXY_GUARD_KEYS.has(name)) return undefined
      if (cache.has(name)) return cache.get(name)

      const itemConfig = configMap?.[name]
      if (!itemConfig) return undefined

      const item = factory(name, itemConfig)
      cache.set(name, item)
      return item
    },
    ownKeys() {
      return Object.keys(configMap ?? {})
    },
    getOwnPropertyDescriptor(_target, name): PropertyDescriptor | undefined {
      if (typeof name === 'string' && configMap && name in configMap) {
        if (!cache.has(name)) {
          cache.set(name, factory(name, configMap[name]))
        }
        return { configurable: true, enumerable: true, value: cache.get(name) }
      }
    },
  })
  return proxy
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export function createSupabaseCollections<DB, const TConfig extends SupabaseCollectionsConfig<DB> = SupabaseCollectionsConfig<DB>>(
  supabase: SupabaseClientLike,
  queryClient: QueryClient,
  config: TConfig,
): SupabaseCollectionsResult<DB, TConfig> {
  const { wrapOptions } = config

  const finalizeCollection = (opts: any) => {
    const collectionOpts = queryCollectionOptions(opts as any)
    return createCollection(wrapOptions ? wrapOptions(collectionOpts) : collectionOpts)
  }

  const tables = createCachedProxy(
    new Map(),
    config.tables as any,
    (name, tableConfig) => {
      const opts = buildBaseCollectionOptions(name, tableConfig, supabase, queryClient)
      Object.assign(opts, createMutationHandlers({
        tableName: name,
        keyColumn: tableConfig.keyColumn,
        schemas: tableConfig.schemas,
        supabase,
        operations: tableConfig.operations,
      }))
      if (tableConfig.schemas?.row) opts.schema = tableConfig.schemas.row
      return finalizeCollection(opts)
    },
  )

  const views = createCachedProxy(
    new Map(),
    config.views as any,
    (name, viewConfig) => {
      const opts = buildBaseCollectionOptions(name, viewConfig, supabase, queryClient)
      if (viewConfig.schemas?.row) opts.schema = viewConfig.schemas.row
      return finalizeCollection(opts)
    },
  )

  const rpc = createRpcProxy(supabase, config.rpcs as Record<string, RpcConfig> | undefined)

  return { tables, views, rpc } as SupabaseCollectionsResult<DB, TConfig>
}

/**
 * Returns a curried identity function that preserves literal schema types
 * through variable assignment. Use this when storing config in a separate
 * variable/file — without it, TypeScript widens the type and row schema
 * inference is lost.
 *
 * ```ts
 * const defineMyConfig = defineConfig<Database>()
 * export const config = defineMyConfig({ tables: { users: { keyColumn: 'id', schemas: { row: userSchema } } } })
 * ```
 */
export function defineConfig<DB>() {
  return <const T extends SupabaseCollectionsConfig<DB>>(config: T): T => config
}
