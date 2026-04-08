// Backward-compatible wrapper around the new query pipeline.
// New code should import from './query-pipeline.ts' instead.
import { executeQuery } from './query-pipeline.ts'
import type { LoadSubsetOptions } from '@tanstack/db'

export interface FetchTableDataOptions {
  supabase: any
  tableName: string
  syncMode: 'eager' | 'on-demand'
  select?: string
  loadSubsetOptions?: LoadSubsetOptions
  pageSize?: number
  inArrayChunkSize?: number
}

export async function fetchTableData(options: FetchTableDataOptions): Promise<any[]> {
  const { loadSubsetOptions, ...config } = options
  return executeQuery(config, loadSubsetOptions)
}
