import { applyLoadSubsetOptions, findInArrayExpression, replaceInArrayExpression } from './apply-load-subset-options'
import type { LoadSubsetOptions } from '@tanstack/db'

const DEFAULT_PAGE_SIZE = 1000
const DEFAULT_IN_ARRAY_CHUNK_SIZE = 200
const EMPTY_LOAD_SUBSET_OPTIONS: LoadSubsetOptions = {}

export interface FetchTableDataOptions {
  /** A Supabase client instance. Typed as `any` for flexibility; `createSupabaseCollections` enforces `SupabaseClient`. */
  supabase: any
  tableName: string
  syncMode: 'eager' | 'on-demand'
  loadSubsetOptions?: LoadSubsetOptions
  pageSize?: number
  inArrayChunkSize?: number
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

/**
 * Fetches a single query from Supabase with loadSubsetOptions applied.
 */
async function fetchSingleQuery(
  supabase: any,
  tableName: string,
  loadSubsetOptions: LoadSubsetOptions,
): Promise<any[]> {
  let query = supabase.from(tableName).select('*')
  query = applyLoadSubsetOptions(query, loadSubsetOptions)
  const { data, error } = await query
  if (error) throw error
  return data as any[]
}

/**
 * Fetches all rows by paginating via .range() until fewer than pageSize rows are returned.
 * Used by both eager and on-demand modes.
 */
async function fetchAllPages(
  supabase: any,
  tableName: string,
  loadSubsetOptions: LoadSubsetOptions,
  pageSize: number,
): Promise<any[]> {
  const allRows: any[] = []
  let offset = 0

  const hasOptions = loadSubsetOptions.where || loadSubsetOptions.orderBy || loadSubsetOptions.cursor || loadSubsetOptions.limit != null || loadSubsetOptions.offset != null

  while (true) {
    let query = supabase.from(tableName).select('*')
    if (hasOptions) query = applyLoadSubsetOptions(query, loadSubsetOptions)
    query = query.range(offset, offset + pageSize - 1)

    const { data, error } = await query
    if (error) throw error

    const rows = data as any[]
    for (let i = 0; i < rows.length; i++) allRows.push(rows[i])

    if (rows.length < pageSize) break
    offset += pageSize
  }

  return allRows
}

export async function fetchTableData(options: FetchTableDataOptions): Promise<any[]> {
  const {
    supabase,
    tableName,
    syncMode,
    loadSubsetOptions,
    pageSize = DEFAULT_PAGE_SIZE,
    inArrayChunkSize = DEFAULT_IN_ARRAY_CHUNK_SIZE,
  } = options

  if (syncMode === 'on-demand') {
    if (!loadSubsetOptions?.where && !loadSubsetOptions?.limit && !loadSubsetOptions?.cursor) {
      throw new Error(
        `On-demand collection "${tableName}" requires a where clause, limit, or cursor. ` +
        `Predicateless queries on on-demand collections would fetch the entire table.`,
      )
    }

    // Check if the where tree contains an in() with a large array.
    // If so, chunk into multiple parallel HTTP requests to avoid URL length limits.
    const inExpr = loadSubsetOptions.where
      ? findInArrayExpression(loadSubsetOptions.where)
      : null

    if (inExpr && inExpr.items.length > inArrayChunkSize) {
      const chunks = chunk(inExpr.items, inArrayChunkSize)
      const results = await Promise.all(
        chunks.map((itemChunk) => {
          const chunkedWhere = replaceInArrayExpression(
            loadSubsetOptions.where,
            inExpr.field,
            itemChunk,
          )
          return fetchSingleQuery(supabase, tableName, { ...loadSubsetOptions, where: chunkedWhere })
        }),
      )
      return results.flat()
    }

    // If the caller specifies limit/offset, do a single fetch (no auto-pagination).
    if (loadSubsetOptions.limit != null || loadSubsetOptions.offset != null) {
      return fetchSingleQuery(supabase, tableName, loadSubsetOptions)
    }

    return fetchAllPages(supabase, tableName, loadSubsetOptions, pageSize)
  }

  // Eager mode: fetch all rows with auto-pagination
  return fetchAllPages(supabase, tableName, EMPTY_LOAD_SUBSET_OPTIONS, pageSize)
}
