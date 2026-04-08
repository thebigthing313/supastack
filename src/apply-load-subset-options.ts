import {
  parseOrderByExpression,
  extractFieldPath,
  extractValue,
  IR,
} from '@tanstack/db'
import type { LoadSubsetOptions } from '@tanstack/db'

type SupabaseQueryBuilder = any

// ---------------------------------------------------------------------------
// Intermediate Representation
// ---------------------------------------------------------------------------

export interface PostgrestFilter {
  field: string
  op: string
  value: unknown
  /** Pre-quoted string value for PostgREST string syntax */
  quotedValue: string
}

export type TranslatedExpr =
  | { kind: 'filter'; filter: PostgrestFilter }
  | { kind: 'in'; field: string; values: unknown[]; quotedValues: string[] }
  | { kind: 'isNull'; field: string }
  | { kind: 'and'; children: TranslatedExpr[] }
  | { kind: 'or'; children: TranslatedExpr[] }
  | { kind: 'not'; inner: TranslatedExpr }

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const COMPARISON_OPERATORS = new Set(['eq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike'])

const POSTGREST_SPECIAL_CHARS = /[.,()'"\\]/

function quotePostgrestValue(value: unknown): string {
  const str = String(value)
  if (POSTGREST_SPECIAL_CHARS.test(str)) {
    return `"${str}"`
  }
  return str
}

function fieldName(expr: any): string {
  const path = extractFieldPath(expr)
  if (!path) throw new Error(`Expected field reference, got: ${JSON.stringify(expr)}`)
  if (path.length === 1) return String(path[0])
  // Multi-segment: JSON column access using PostgREST arrow notation.
  // Intermediate segments use -> (returns JSON), final segment uses ->> (returns text).
  const column = path[0]
  const intermediate = path.slice(1, -1)
  const leaf = path[path.length - 1]
  return column + intermediate.map((s) => `->${s}`).join('') + `->>${leaf}`
}

// ---------------------------------------------------------------------------
// Single-pass parser: IR expr → TranslatedExpr
// ---------------------------------------------------------------------------

export function translateExpr(expr: any): TranslatedExpr {
  if (expr.type === 'func') {
    const name: string = expr.name
    const args = expr.args

    if (COMPARISON_OPERATORS.has(name)) {
      const field = fieldName(args[0])
      const value = extractValue(args[1])
      return { kind: 'filter', filter: { field, op: name, value, quotedValue: quotePostgrestValue(value) } }
    }

    if (name === 'in') {
      const field = fieldName(args[0])
      const value = extractValue(args[1])
      const items = Array.isArray(value) ? value : [value]
      return { kind: 'in', field, values: items, quotedValues: items.map(quotePostgrestValue) }
    }

    if (name === 'isNull' || name === 'isUndefined') {
      const field = fieldName(args[0])
      return { kind: 'isNull', field }
    }

    if (name === 'and') {
      return { kind: 'and', children: args.map((a: any) => translateExpr(a)) }
    }

    if (name === 'or') {
      return { kind: 'or', children: args.map((a: any) => translateExpr(a)) }
    }

    if (name === 'not') {
      return { kind: 'not', inner: translateExpr(args[0]) }
    }
  }

  throw new Error(`Unsupported expression: ${JSON.stringify(expr)}`)
}

// ---------------------------------------------------------------------------
// Emitter 1: TranslatedExpr → PostgREST filter string
// ---------------------------------------------------------------------------

export function toPostgrestString(node: TranslatedExpr): string {
  switch (node.kind) {
    case 'filter':
      return `${node.filter.field}.${node.filter.op}.${node.filter.quotedValue}`
    case 'in':
      return `${node.field}.in.(${node.quotedValues.join(',')})`
    case 'isNull':
      return `${node.field}.is.null`
    case 'and':
      return `and(${node.children.map(toPostgrestString).join(',')})`
    case 'or':
      return `or(${node.children.map(toPostgrestString).join(',')})`
    case 'not':
      return `not.${toPostgrestString(node.inner)}`
  }
}

// ---------------------------------------------------------------------------
// Emitter 2: TranslatedExpr → Supabase query builder chain
// ---------------------------------------------------------------------------

export function applyToQuery(query: SupabaseQueryBuilder, node: TranslatedExpr): SupabaseQueryBuilder {
  switch (node.kind) {
    case 'filter':
      return query[node.filter.op](node.filter.field, node.filter.value)
    case 'in':
      return query.in(node.field, node.values)
    case 'isNull':
      return query.is(node.field, null)
    case 'and': {
      let q = query
      for (const child of node.children) {
        q = applyToQuery(q, child)
      }
      return q
    }
    case 'or':
      return query.or(node.children.map(toPostgrestString).join(','))
    case 'not': {
      const inner = node.inner
      if (inner.kind === 'isNull') {
        return query.not(inner.field, 'is', null)
      }
      if (inner.kind === 'in') {
        return query.not(inner.field, 'in', `(${inner.quotedValues.join(',')})`)
      }
      if (inner.kind === 'filter') {
        return query.not(inner.filter.field, inner.filter.op, inner.filter.value)
      }
      // Fallback for not(and(...)), not(or(...)) etc — use string form
      return query.or(`not.${toPostgrestString(inner)}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers for IN-array chunking (used by fetch-table-data)
// ---------------------------------------------------------------------------

/**
 * Finds the first in() expression in the where tree and returns the field + items.
 * Returns null if there's no in() expression.
 */
export function findInArrayExpression(expr: any): { field: string; items: any[] } | null {
  if (expr?.type !== 'func') return null

  if (expr.name === 'in') {
    const field = fieldName(expr.args[0])
    const value = extractValue(expr.args[1])
    if (Array.isArray(value)) {
      return { field, items: value }
    }
  }

  // Walk into and/or children
  if (expr.name === 'and' || expr.name === 'or') {
    for (const arg of expr.args) {
      const found = findInArrayExpression(arg)
      if (found) return found
    }
  }

  return null
}

/**
 * Replaces the in() expression found by findInArrayExpression with a new one
 * containing the given items. Returns a new expression tree (does not mutate).
 */
export function replaceInArrayExpression(expr: any, field: string, newItems: any[]): any {
  if (expr?.type !== 'func') return expr

  if (expr.name === 'in') {
    const exprField = fieldName(expr.args[0])
    if (exprField === field) {
      return new IR.Func('in', [expr.args[0], new IR.Value(newItems)])
    }
    return expr
  }

  if (expr.name === 'and' || expr.name === 'or') {
    const newArgs = expr.args.map((arg: any) => replaceInArrayExpression(arg, field, newItems))
    return new IR.Func(expr.name, newArgs)
  }

  return expr
}

// ---------------------------------------------------------------------------
// Public API: applyLoadSubsetOptions (unchanged interface)
// ---------------------------------------------------------------------------

export function applyLoadSubsetOptions(
  query: SupabaseQueryBuilder,
  options: LoadSubsetOptions,
): SupabaseQueryBuilder {
  let q = query

  if (options.where) {
    q = applyToQuery(q, translateExpr(options.where))
  }

  if (options.cursor?.whereFrom) {
    q = applyToQuery(q, translateExpr(options.cursor.whereFrom))
  }

  if (options.orderBy) {
    const parsed = parseOrderByExpression(options.orderBy)
    for (const sort of parsed) {
      q = q.order(sort.field.join('.'), {
        ascending: sort.direction === 'asc',
        nullsFirst: sort.nulls === 'first',
      })
    }
  }

  if (options.offset != null && options.limit != null) {
    q = q.range(options.offset, options.offset + options.limit - 1)
  } else if (options.limit != null) {
    q = q.limit(options.limit)
  }

  return q
}
