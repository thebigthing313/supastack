import {
  extractFieldPath,
  extractValue,
  parseOrderByExpression,
} from '@tanstack/db'
import type { LoadSubsetOptions } from '@tanstack/db'

export type SupabaseComparisonOperator = 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike'

export interface SupabaseComparisonPredicate {
  kind: 'comparison'
  field: string
  operator: SupabaseComparisonOperator
  value: unknown
  postgrestValue: string
}

export interface SupabaseInPredicate {
  kind: 'in'
  field: string
  values: unknown[]
  postgrestValues: string[]
}

export interface SupabaseIsNullPredicate {
  kind: 'isNull'
  field: string
}

export type SupabasePredicate =
  | SupabaseComparisonPredicate
  | SupabaseInPredicate
  | SupabaseIsNullPredicate
  | { kind: 'and'; predicates: SupabasePredicate[] }
  | { kind: 'or'; predicates: SupabasePredicate[] }
  | { kind: 'not'; predicate: SupabasePredicate }

export interface SupabaseOrder {
  field: string
  ascending: boolean
  nullsFirst: boolean
}

export interface SupabaseRange {
  from: number
  to: number
}

export interface SupabaseQueryPlan {
  predicates: SupabasePredicate[]
  orderBy: SupabaseOrder[]
  limit?: number
  range?: SupabaseRange
}

export interface ChunkableInPredicate {
  field: string
  values: unknown[]
}

const COMPARISON_OPERATORS = new Set<string>(['eq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike'])
const POSTGREST_SPECIAL_CHARS = /[\s,.:()'"\\]/

export function compileLoadSubsetOptions(options: LoadSubsetOptions = {}): SupabaseQueryPlan {
  const predicates: SupabasePredicate[] = []

  if (options.where) {
    predicates.push(compilePredicate(options.where))
  }

  if (options.cursor?.whereFrom) {
    predicates.push(compilePredicate(options.cursor.whereFrom))
  }

  return {
    predicates,
    orderBy: compileOrderBy(options),
    ...compileWindow(options),
  }
}

export function compilePredicate(expr: unknown): SupabasePredicate {
  if (!isFuncExpression(expr)) {
    throw unsupportedExpressionError(expr)
  }

  const { name, args } = expr

  if (COMPARISON_OPERATORS.has(name)) {
    const value = extractValue(args[1] as any)
    return {
      kind: 'comparison',
      field: fieldName(args[0]),
      operator: name as SupabaseComparisonOperator,
      value,
      postgrestValue: encodePostgrestValue(value),
    }
  }

  if (name === 'in') {
    const value = extractValue(args[1] as any)
    const values = Array.isArray(value) ? value : [value]
    return {
      kind: 'in',
      field: fieldName(args[0]),
      values,
      postgrestValues: values.map(encodePostgrestValue),
    }
  }

  if (name === 'isNull' || name === 'isUndefined') {
    return {
      kind: 'isNull',
      field: fieldName(args[0]),
    }
  }

  if (name === 'and' || name === 'or') {
    return {
      kind: name,
      predicates: args.map((arg: unknown) => compilePredicate(arg)),
    }
  }

  if (name === 'not') {
    return {
      kind: 'not',
      predicate: compilePredicate(args[0]),
    }
  }

  throw unsupportedExpressionError(expr)
}

export function findChunkableInPredicate(plan: SupabaseQueryPlan): ChunkableInPredicate | null {
  for (const predicate of plan.predicates) {
    const found = findInPredicate(predicate)
    if (found) return found
  }

  return null
}

export function withInPredicateValues(
  plan: SupabaseQueryPlan,
  field: string,
  values: unknown[],
): SupabaseQueryPlan {
  return {
    ...plan,
    predicates: plan.predicates.map((predicate) => replaceInPredicateValues(predicate, field, values)),
  }
}

function compileOrderBy(options: LoadSubsetOptions): SupabaseOrder[] {
  if (!options.orderBy) return []

  return parseOrderByExpression(options.orderBy).map((sort) => ({
    field: sort.field.join('.'),
    ascending: sort.direction === 'asc',
    nullsFirst: sort.nulls === 'first',
  }))
}

function compileWindow(options: LoadSubsetOptions): Pick<SupabaseQueryPlan, 'limit' | 'range'> {
  if (options.offset != null && options.limit != null) {
    return {
      range: {
        from: options.offset,
        to: options.offset + options.limit - 1,
      },
    }
  }

  if (options.limit != null) {
    return { limit: options.limit }
  }

  return {}
}

function findInPredicate(predicate: SupabasePredicate): ChunkableInPredicate | null {
  switch (predicate.kind) {
    case 'in':
      return {
        field: predicate.field,
        values: predicate.values,
      }
    case 'and':
    case 'or':
      for (const child of predicate.predicates) {
        const found = findInPredicate(child)
        if (found) return found
      }
      return null
    case 'comparison':
    case 'isNull':
    case 'not':
      return null
  }
}

function replaceInPredicateValues(
  predicate: SupabasePredicate,
  field: string,
  values: unknown[],
): SupabasePredicate {
  switch (predicate.kind) {
    case 'in':
      if (predicate.field !== field) return predicate
      return {
        ...predicate,
        values,
        postgrestValues: values.map(encodePostgrestValue),
      }
    case 'and':
    case 'or':
      return {
        ...predicate,
        predicates: predicate.predicates.map((child) => replaceInPredicateValues(child, field, values)),
      }
    case 'comparison':
    case 'isNull':
    case 'not':
      return predicate
  }
}

function fieldName(expr: unknown): string {
  const path = extractFieldPath(expr as any)
  if (!path) {
    throw new Error(`Expected field reference, got: ${describeExpression(expr)}`)
  }

  if (path.length === 1) return String(path[0])

  const column = String(path[0])
  const intermediate = path.slice(1, -1).map(String)
  const leaf = String(path[path.length - 1])
  return column + intermediate.map((segment) => `->${segment}`).join('') + `->>${leaf}`
}

function encodePostgrestValue(value: unknown): string {
  const str = String(value)
  if (str.length === 0 || POSTGREST_SPECIAL_CHARS.test(str)) {
    return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return str
}

function isFuncExpression(expr: unknown): expr is { type: 'func'; name: string; args: unknown[] } {
  return (
    typeof expr === 'object' &&
    expr !== null &&
    (expr as { type?: unknown }).type === 'func' &&
    typeof (expr as { name?: unknown }).name === 'string' &&
    Array.isArray((expr as { args?: unknown }).args)
  )
}

function unsupportedExpressionError(expr: unknown): Error {
  return new Error(
    `Unsupported load subset expression: ${describeExpression(expr)}. ` +
    `Supported functions: eq, gt, gte, lt, lte, like, ilike, in, isNull, isUndefined, and, or, not.`,
  )
}

function describeExpression(expr: unknown): string {
  try {
    return JSON.stringify(expr)
  } catch {
    return String(expr)
  }
}
