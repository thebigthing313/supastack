import { createRelationReader } from './relation-reader.ts'
import type { SupabaseRelationClient } from './relation-reader.ts'
import type { LoadSubsetOptions } from '@tanstack/db'

export interface QueryPipelineConfig {
  supabase: SupabaseRelationClient
  /**
   * Relation name passed to Supabase's `.from()`.
   *
   * The query-pipeline helpers keep the historical `tableName` option for
   * compatibility. New custom read integrations should prefer
   * `createRelationReader`, which uses `relationName` and covers both tables
   * and views directly.
   */
  tableName: string
  syncMode: 'eager' | 'on-demand'
  /** Column selection passed to Supabase's .select(). Defaults to '*'. */
  select?: string
  pageSize?: number
  inArrayChunkSize?: number
}

export type QueryFn = (context: { meta?: { loadSubsetOptions?: LoadSubsetOptions } }) => Promise<any[]>

/**
 * Compatibility adapter that turns the relation reader into a TanStack
 * DB/Query `queryFn`.
 *
 * It owns only the TanStack query function shape. Pagination, in-array
 * chunking, and on-demand safeguards are delegated to `createRelationReader`.
 * New custom read integrations should call `createRelationReader` directly
 * unless they specifically need a TanStack query function.
 */
export function createQueryFn(config: QueryPipelineConfig): QueryFn {
  const reader = createRelationReader(toRelationReaderConfig(config))
  return (context) => reader.read(context.meta?.loadSubsetOptions)
}

/**
 * Convenience read entry point for advanced integrations that want a single
 * query result without managing a reader instance.
 *
 * It preserves the current query-pipeline config shape and delegates the
 * actual read behavior to `createRelationReader`.
 */
export async function executeQuery(
  config: QueryPipelineConfig,
  loadSubsetOptions?: LoadSubsetOptions,
): Promise<any[]> {
  const reader = createRelationReader(toRelationReaderConfig(config))
  return reader.read(loadSubsetOptions)
}

function toRelationReaderConfig(config: QueryPipelineConfig) {
  const { tableName, ...rest } = config
  return { ...rest, relationName: tableName }
}
