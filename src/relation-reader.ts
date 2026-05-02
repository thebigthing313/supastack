import { applyLoadSubsetOptions, findInArrayExpression, replaceInArrayExpression } from './apply-load-subset-options.ts'
import type { LoadSubsetOptions } from '@tanstack/db'

const DEFAULT_PAGE_SIZE = 1000
const DEFAULT_IN_ARRAY_CHUNK_SIZE = 200

type SyncMode = 'eager' | 'on-demand'
type SupabaseQueryBuilder = any

export interface SupabaseRelationClient {
  from(relationName: string): { select(columns: string): SupabaseQueryBuilder }
}

export interface RelationReaderConfig {
  supabase: SupabaseRelationClient
  relationName: string
  syncMode: SyncMode
  /** Column selection passed to Supabase's .select(). Defaults to '*'. */
  select?: string
  pageSize?: number
  inArrayChunkSize?: number
}

export interface RelationReader {
  read(loadSubsetOptions?: LoadSubsetOptions): Promise<any[]>
}

interface NormalizedRelationReaderConfig {
  supabase: SupabaseRelationClient
  relationName: string
  syncMode: SyncMode
  selectColumns: string
  pageSize: number
  inArrayChunkSize: number
}

export function createRelationReader(config: RelationReaderConfig): RelationReader {
  const normalizedConfig = normalizeRelationReaderConfig(config)

  return {
    read(loadSubsetOptions?: LoadSubsetOptions) {
      return readRelation(normalizedConfig, loadSubsetOptions)
    },
  }
}

async function readRelation(
  config: NormalizedRelationReaderConfig,
  loadSubsetOptions?: LoadSubsetOptions,
): Promise<any[]> {
  const options = loadSubsetOptions ?? {}

  if (config.syncMode === 'on-demand') {
    assertSafeOnDemandRead(config.relationName, options)
  }

  const chunkedInExpression = getChunkedInExpression(options, config.inArrayChunkSize)
  if (chunkedInExpression) {
    return fetchChunkedQueries(config, options, chunkedInExpression)
  }

  if (hasExplicitWindow(options)) {
    return fetchSingleQuery(config, options)
  }

  return fetchAllPages(config, options)
}

function normalizeRelationReaderConfig(config: RelationReaderConfig): NormalizedRelationReaderConfig {
  return {
    supabase: config.supabase,
    relationName: config.relationName,
    syncMode: config.syncMode,
    selectColumns: config.select ?? '*',
    pageSize: positiveIntegerOrDefault(config.pageSize, DEFAULT_PAGE_SIZE, 'pageSize'),
    inArrayChunkSize: positiveIntegerOrDefault(
      config.inArrayChunkSize,
      DEFAULT_IN_ARRAY_CHUNK_SIZE,
      'inArrayChunkSize',
    ),
  }
}

function positiveIntegerOrDefault(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return value
}

function assertSafeOnDemandRead(relationName: string, options: LoadSubsetOptions): void {
  if (!options.where && options.limit == null && !options.cursor) {
    throw new Error(
      `On-demand collection "${relationName}" requires a where clause, limit, or cursor. ` +
      `Predicateless queries on on-demand collections would fetch the entire table.`,
    )
  }
}

function hasExplicitWindow(options: LoadSubsetOptions): boolean {
  return options.limit != null || options.offset != null
}

function getChunkedInExpression(
  options: LoadSubsetOptions,
  chunkSize: number,
): { field: string; items: any[] } | null {
  if (!options.where) return null

  const inExpression = findInArrayExpression(options.where)
  if (!inExpression || inExpression.items.length <= chunkSize) return null

  return inExpression
}

async function fetchChunkedQueries(
  config: NormalizedRelationReaderConfig,
  options: LoadSubsetOptions,
  inExpression: { field: string; items: any[] },
): Promise<any[]> {
  const requests = chunk(inExpression.items, config.inArrayChunkSize).map((itemChunk) => {
    const where = replaceInArrayExpression(options.where, inExpression.field, itemChunk)
    return fetchSingleQuery(config, { ...options, where })
  })

  const results = await Promise.all(requests)
  return results.flat()
}

async function fetchSingleQuery(
  config: NormalizedRelationReaderConfig,
  options: LoadSubsetOptions,
): Promise<any[]> {
  let query = createSelectQuery(config)
  query = applyLoadSubsetOptions(query, options)

  return resolveRows(query)
}

async function fetchAllPages(
  config: NormalizedRelationReaderConfig,
  options: LoadSubsetOptions,
): Promise<any[]> {
  const rows: any[] = []
  let offset = 0

  while (true) {
    let query = createSelectQuery(config)
    query = applyLoadSubsetOptions(query, options)
    query = query.range(offset, offset + config.pageSize - 1)

    const page = await resolveRows(query)
    rows.push(...page)

    if (page.length < config.pageSize) break
    offset += config.pageSize
  }

  return rows
}

function createSelectQuery(config: NormalizedRelationReaderConfig): SupabaseQueryBuilder {
  return config.supabase.from(config.relationName).select(config.selectColumns)
}

async function resolveRows(query: SupabaseQueryBuilder): Promise<any[]> {
  const { data, error } = await query
  if (error) throw error
  return Array.isArray(data) ? data : []
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}
