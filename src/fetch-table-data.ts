// Backward-compatible wrapper around the relation reader.
// New code should import createRelationReader or executeQuery instead.
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
