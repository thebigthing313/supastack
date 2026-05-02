import type { LoadSubsetOptions } from '@tanstack/db'
import { applyQueryPlan } from './apply-load-subset-options.ts'
import {
  compileLoadSubsetOptions,
  findChunkableInPredicate,
  withInPredicateValues,
} from './load-subset-query-plan.ts'
import type { ChunkableInPredicate, SupabaseQueryPlan } from './load-subset-query-plan.ts'

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

/**
 * Preferred advanced read boundary for custom table or view integrations.
 *
 * The reader owns Supabase read execution, auto-pagination, large IN predicate
 * chunking, and on-demand safety checks. It intentionally exposes only the
 * `read` method, keeping query-plan internals private.
 */
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
  const plan = compileLoadSubsetOptions(loadSubsetOptions ?? {})

  if (config.syncMode === 'on-demand') {
    assertSafeOnDemandRead(config.relationName, plan)
  }

  const chunkedInPredicate = getChunkedInPredicate(plan, config.inArrayChunkSize)
  if (chunkedInPredicate) {
    return fetchChunkedQueries(config, plan, chunkedInPredicate)
  }

  if (hasExplicitWindow(plan)) {
    return fetchSingleQuery(config, plan)
  }

  return fetchAllPages(config, plan)
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

function assertSafeOnDemandRead(relationName: string, plan: SupabaseQueryPlan): void {
  if (plan.predicates.length === 0 && !hasExplicitWindow(plan)) {
    throw new Error(
      `On-demand collection "${relationName}" requires a where clause, limit, or cursor. ` +
      `Predicateless queries on on-demand collections would fetch the entire table.`,
    )
  }
}

function hasExplicitWindow(plan: SupabaseQueryPlan): boolean {
  return plan.limit != null || plan.range != null
}

function getChunkedInPredicate(
  plan: SupabaseQueryPlan,
  chunkSize: number,
): ChunkableInPredicate | null {
  const inPredicate = findChunkableInPredicate(plan)
  if (!inPredicate || inPredicate.values.length <= chunkSize) return null

  return inPredicate
}

async function fetchChunkedQueries(
  config: NormalizedRelationReaderConfig,
  plan: SupabaseQueryPlan,
  inPredicate: ChunkableInPredicate,
): Promise<any[]> {
  const requests = chunk(inPredicate.values, config.inArrayChunkSize).map((itemChunk) => {
    const chunkedPlan = withInPredicateValues(plan, inPredicate.field, itemChunk)
    return fetchSingleQuery(config, chunkedPlan)
  })

  const results = await Promise.all(requests)
  return results.flat()
}

async function fetchSingleQuery(
  config: NormalizedRelationReaderConfig,
  plan: SupabaseQueryPlan,
): Promise<any[]> {
  let query = createSelectQuery(config)
  query = applyQueryPlan(query, plan)

  return resolveRows(query)
}

async function fetchAllPages(
  config: NormalizedRelationReaderConfig,
  plan: SupabaseQueryPlan,
): Promise<any[]> {
  const rows: any[] = []
  let offset = 0

  while (true) {
    let query = createSelectQuery(config)
    query = applyQueryPlan(query, plan)
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
