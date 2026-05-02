import { executeQuery } from './query-pipeline.ts'
import type { LoadSubsetOptions } from '@tanstack/db'

/**
 * @deprecated Compatibility options for `fetchTableData`. New code should use
 * `executeQuery` for a one-shot read or `createRelationReader` for a reusable
 * custom read boundary.
 */
export interface FetchTableDataOptions {
  supabase: any
  tableName: string
  syncMode: 'eager' | 'on-demand'
  select?: string
  loadSubsetOptions?: LoadSubsetOptions
  pageSize?: number
  inArrayChunkSize?: number
}

/**
 * @deprecated Compatibility wrapper retained for the current major version.
 * Delegates to `executeQuery`; new integrations should use `executeQuery` or
 * `createRelationReader` directly.
 */
export async function fetchTableData(options: FetchTableDataOptions): Promise<any[]> {
  const { loadSubsetOptions, ...config } = options
  return executeQuery(config, loadSubsetOptions)
}
