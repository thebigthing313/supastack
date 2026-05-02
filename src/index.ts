import type { QueryClient } from '@tanstack/query-core'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Collection } from '@tanstack/db'
import type { QueryCollectionUtils } from '@tanstack/query-db-collection'
import { createRelationCollection } from './relation-collection-factory.ts'
import type { SupabaseClientLike, TableConfig, ViewConfig } from './relation-collection-factory.ts'
import { createLazyRegistry } from './lazy-registry.ts'
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
export type { QueryOptions, TableConfig, TableSchemas, ViewConfig } from './relation-collection-factory.ts'
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
// Main function
// ---------------------------------------------------------------------------

export function createSupabaseCollections<DB, const TConfig extends SupabaseCollectionsConfig<DB> = SupabaseCollectionsConfig<DB>>(
  supabase: SupabaseClientLike,
  queryClient: QueryClient,
  config: TConfig,
): SupabaseCollectionsResult<DB, TConfig> {
  const { wrapOptions } = config

  const tables = createLazyRegistry({
    entries: config.tables as Record<string, any> | undefined,
    create: (name, tableConfig) => createRelationCollection({
      kind: 'table',
      relationName: name,
      config: tableConfig,
      supabase,
      queryClient,
      wrapOptions,
    }),
  })

  const views = createLazyRegistry({
    entries: config.views as Record<string, any> | undefined,
    create: (name, viewConfig) => createRelationCollection({
      kind: 'view',
      relationName: name,
      config: viewConfig,
      supabase,
      queryClient,
      wrapOptions,
    }),
  })

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
