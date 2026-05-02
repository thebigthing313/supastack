import { createRelationReader } from './relation-reader.ts'
import type { LoadSubsetOptions } from '@tanstack/db'

export interface QueryPipelineConfig {
  supabase: any
  tableName: string
  syncMode: 'eager' | 'on-demand'
  /** Column selection passed to Supabase's .select(). Defaults to '*'. */
  select?: string
  pageSize?: number
  inArrayChunkSize?: number
}

export type QueryFn = (context: { meta?: { loadSubsetOptions?: LoadSubsetOptions } }) => Promise<any[]>

/**
 * Creates a queryFn compatible with TanStack DB/Query that handles
 * pagination, in-array chunking, and on-demand validation.
 */
export function createQueryFn(config: QueryPipelineConfig): QueryFn {
  const reader = createRelationReader(toRelationReaderConfig(config))
  return (context) => reader.read(context.meta?.loadSubsetOptions)
}

/**
 * Execute a query with explicit loadSubsetOptions.
 * Handles eager/on-demand routing, auto-pagination, and IN() chunking.
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
