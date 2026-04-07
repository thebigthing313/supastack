import {
  parseOrderByExpression,
  extractFieldPath,
  extractValue,
  IR,
} from '@tanstack/db'
import type { LoadSubsetOptions } from '@tanstack/db'

type SupabaseQueryBuilder = any

const COMPARISON_OPERATORS = new Set(['eq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike'])

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
const POSTGREST_SPECIAL_CHARS = /[.,()'"\\]/

function quotePostgrestValue(value: unknown): string {
  const str = String(value)
  if (POSTGREST_SPECIAL_CHARS.test(str)) {
    return `"${str}"`
  }
  return str
}

function expressionToPostgrest(expr: any): string {
  if (expr.type === 'func') {
    const name: string = expr.name
    const args = expr.args

    if (COMPARISON_OPERATORS.has(name)) {
      const field = fieldName(args[0])
      const value = extractValue(args[1])
      return `${field}.${name}.${quotePostgrestValue(value)}`
    }

    if (name === 'in') {
      const field = fieldName(args[0])
      const value = extractValue(args[1])
      const items = Array.isArray(value) ? value.map(quotePostgrestValue).join(',') : quotePostgrestValue(value)
      return `${field}.in.(${items})`
    }

    if (name === 'isNull' || name === 'isUndefined') {
      const field = fieldName(args[0])
      return `${field}.is.null`
    }

    if (name === 'and') {
      const inner = args.map((a: any) => expressionToPostgrest(a)).join(',')
      return `and(${inner})`
    }

    if (name === 'or') {
      const inner = args.map((a: any) => expressionToPostgrest(a)).join(',')
      return `or(${inner})`
    }

    if (name === 'not') {
      const innerStr = expressionToPostgrest(args[0])
      return `not.${innerStr}`
    }
  }

  throw new Error(`Unsupported expression: ${JSON.stringify(expr)}`)
}

function applyWhere(query: SupabaseQueryBuilder, expr: any): SupabaseQueryBuilder {
  if (expr.type === 'func') {
    const name: string = expr.name
    const args = expr.args

    if (COMPARISON_OPERATORS.has(name)) {
      const field = fieldName(args[0])
      const value = extractValue(args[1])
      return query[name](field, value)
    }

    if (name === 'in') {
      const field = fieldName(args[0])
      const value = extractValue(args[1])
      return query.in(field, value)
    }

    if (name === 'isNull' || name === 'isUndefined') {
      const field = fieldName(args[0])
      return query.is(field, null)
    }

    if (name === 'and') {
      let q = query
      for (const arg of args) {
        q = applyWhere(q, arg)
      }
      return q
    }

    if (name === 'or') {
      const postgrestFilter = args
        .map((a: any) => expressionToPostgrest(a))
        .join(',')
      return query.or(postgrestFilter)
    }

    if (name === 'not') {
      const inner = args[0]
      if (inner.type === 'func') {
        const innerName: string = inner.name
        const field = fieldName(inner.args[0])

        if (innerName === 'isNull' || innerName === 'isUndefined') {
          return query.not(field, 'is', null)
        }

        if (innerName === 'in') {
          const value = extractValue(inner.args[1])
          const items = Array.isArray(value) ? value.map(quotePostgrestValue).join(',') : quotePostgrestValue(value)
          return query.not(field, 'in', `(${items})`)
        }

        const value = extractValue(inner.args[1])
        return query.not(field, innerName, value)
      }
    }
  }

  throw new Error(`Unsupported where expression: ${JSON.stringify(expr)}`)
}

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

export function applyLoadSubsetOptions(
  query: SupabaseQueryBuilder,
  options: LoadSubsetOptions,
): SupabaseQueryBuilder {
  let q = query

  if (options.where) {
    q = applyWhere(q, options.where)
  }

  if (options.cursor?.whereFrom) {
    q = applyWhere(q, options.cursor.whereFrom)
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
