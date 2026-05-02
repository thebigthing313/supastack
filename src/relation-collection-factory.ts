import { createCollection as createTanStackCollection } from '@tanstack/db'
import { queryCollectionOptions as createTanStackQueryCollectionOptions } from '@tanstack/query-db-collection'
import type { QueryClient } from '@tanstack/query-core'
import { createQueryFn } from './query-pipeline.ts'
import type { QueryFn, QueryPipelineConfig } from './query-pipeline.ts'
import { createMutationHandlers } from './mutation-handlers.ts'
import type { MutationHandlerConfig, MutationHandlers } from './mutation-handlers.ts'
import { attachRowSchema } from './schema-boundary.ts'
import type { TableSchemas, ViewSchemas } from './schema-boundary.ts'
export type { TableSchemas, ViewSchemas } from './schema-boundary.ts'

// Structural type instead of SupabaseClient class -- avoids version mismatch
// issues with protected members when consumers use a different supabase-js version.
export interface SupabaseClientLike {
  from(relationName: string): any
  rpc(fn: string, args?: any): any
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
  syncMode?: SyncMode
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

type SyncMode = 'eager' | 'on-demand'
type CrudOperation = 'insert' | 'update' | 'delete'

export interface TableConfig<TRow extends Record<string, unknown>> extends BaseCollectionConfig<TRow> {
  schemas?: TableSchemas
  /** Which mutation operations to enable. Defaults to all: ['insert', 'update', 'delete']. */
  operations?: CrudOperation[]
}

export interface ViewConfig<TRow extends Record<string, unknown>> extends BaseCollectionConfig<TRow> {
  schemas?: ViewSchemas
}

type RelationCollectionKind = 'table' | 'view'
type RelationConfig<TRow extends Record<string, unknown>> = TableConfig<TRow> | ViewConfig<TRow>

export interface RelationCollectionFactoryDependencies {
  createCollection: (options: any) => any
  queryCollectionOptions: (options: any) => any
  createQueryFn: (config: QueryPipelineConfig) => QueryFn
  createMutationHandlers: (config: MutationHandlerConfig) => MutationHandlers
}

export interface CreateRelationCollectionInput<TRow extends Record<string, unknown>> {
  kind: RelationCollectionKind
  relationName: string
  config: RelationConfig<TRow>
  supabase: SupabaseClientLike
  queryClient: QueryClient
  wrapOptions?: (options: any) => any
  dependencies?: Partial<RelationCollectionFactoryDependencies>
}

const QUERY_OPTION_KEYS = ['staleTime', 'refetchInterval', 'enabled', 'retry', 'retryDelay', 'gcTime'] as const
const ON_DEMAND_QUERY_KEY_FIELDS = ['where', 'orderBy', 'cursor', 'limit', 'offset'] as const

const DEFAULT_DEPENDENCIES: RelationCollectionFactoryDependencies = {
  createCollection: createTanStackCollection as (options: any) => any,
  queryCollectionOptions: createTanStackQueryCollectionOptions as (options: any) => any,
  createQueryFn,
  createMutationHandlers,
}

export function createRelationCollection<TRow extends Record<string, unknown>>(
  input: CreateRelationCollectionInput<TRow>,
): any {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...input.dependencies }
  const relationOptions = buildRelationOptions(input, dependencies)
  const collectionOptions = dependencies.queryCollectionOptions(relationOptions as any)
  const wrappedOptions = input.wrapOptions ? input.wrapOptions(collectionOptions) : collectionOptions

  return dependencies.createCollection(wrappedOptions)
}

function buildRelationOptions<TRow extends Record<string, unknown>>(
  input: CreateRelationCollectionInput<TRow>,
  dependencies: RelationCollectionFactoryDependencies,
): Record<string, any> {
  const options = buildReadableRelationOptions(input, dependencies)

  addRowSchema(options, input.config)
  addMutableRelationOptions(options, input, dependencies)

  return options
}

function buildReadableRelationOptions<TRow extends Record<string, unknown>>(
  input: CreateRelationCollectionInput<TRow>,
  dependencies: RelationCollectionFactoryDependencies,
): Record<string, any> {
  const {
    keyColumn,
    syncMode = 'eager',
    startSync = true,
    select = '*',
    autoIndex,
    defaultIndexType,
  } = input.config

  return {
    id: `supabase-sync:${input.relationName}`,
    queryKey: createRelationQueryKey(input.relationName, syncMode),
    queryFn: dependencies.createQueryFn({
      supabase: input.supabase,
      tableName: input.relationName,
      syncMode,
      select,
      ...pickDefined(input.config, ['pageSize', 'inArrayChunkSize']),
    }),
    queryClient: input.queryClient,
    syncMode,
    startSync,
    getKey: (row: Record<string, unknown>) => row[keyColumn],
    ...(autoIndex !== undefined && { autoIndex }),
    ...(defaultIndexType !== undefined && { defaultIndexType }),
    ...pickDefined(input.config, QUERY_OPTION_KEYS),
  }
}

function addRowSchema<TRow extends Record<string, unknown>>(
  options: Record<string, any>,
  config: RelationConfig<TRow>,
): void {
  attachRowSchema(options, config.schemas?.row)
}

function addMutableRelationOptions<TRow extends Record<string, unknown>>(
  options: Record<string, any>,
  input: CreateRelationCollectionInput<TRow>,
  dependencies: RelationCollectionFactoryDependencies,
): void {
  if (input.kind !== 'table') return

  const config = input.config as TableConfig<TRow>
  Object.assign(options, dependencies.createMutationHandlers({
    tableName: input.relationName,
    keyColumn: config.keyColumn,
    schemas: config.schemas,
    supabase: input.supabase,
    operations: config.operations,
  }))
}

function createRelationQueryKey(
  relationName: string,
  syncMode: SyncMode,
): readonly unknown[] | ((options?: Record<string, unknown>) => readonly unknown[]) {
  if (syncMode !== 'on-demand') return [relationName]

  return (options: Record<string, unknown> = {}) => {
    const key: Record<string, unknown> = {}
    for (const field of ON_DEMAND_QUERY_KEY_FIELDS) {
      if (options[field] !== undefined) {
        key[field] = options[field]
      }
    }
    return Object.keys(key).length > 0 ? [relationName, key] : [relationName]
  }
}

function pickDefined(source: object, keys: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const values = source as Record<string, unknown>
  for (const key of keys) {
    if (values[key] !== undefined) result[key] = values[key]
  }
  return result
}
