import type { LoadSubsetOptions } from '@tanstack/db'
import { compileLoadSubsetOptions } from './load-subset-query-plan.ts'
import type { SupabasePredicate, SupabaseQueryPlan } from './load-subset-query-plan.ts'

type SupabaseQueryBuilder = any

export function applyQueryPlan(
  query: SupabaseQueryBuilder,
  plan: SupabaseQueryPlan,
): SupabaseQueryBuilder {
  let q = query

  for (const predicate of plan.predicates) {
    q = applyPredicate(q, predicate)
  }

  for (const sort of plan.orderBy) {
    q = q.order(sort.field, {
      ascending: sort.ascending,
      nullsFirst: sort.nullsFirst,
    })
  }

  if (plan.range) {
    q = q.range(plan.range.from, plan.range.to)
  } else if (plan.limit != null) {
    q = q.limit(plan.limit)
  }

  return q
}

function applyPredicate(query: SupabaseQueryBuilder, node: SupabasePredicate): SupabaseQueryBuilder {
  switch (node.kind) {
    case 'comparison':
      return query[node.operator](node.field, node.value)
    case 'in':
      return query.in(node.field, node.values)
    case 'isNull':
      return query.is(node.field, null)
    case 'and': {
      let q = query
      for (const predicate of node.predicates) {
        q = applyPredicate(q, predicate)
      }
      return q
    }
    case 'or':
      return query.or(node.predicates.map(toPostgrestString).join(','))
    case 'not': {
      const predicate = node.predicate
      if (predicate.kind === 'isNull') {
        return query.not(predicate.field, 'is', null)
      }
      if (predicate.kind === 'in') {
        return query.not(predicate.field, 'in', `(${predicate.postgrestValues.join(',')})`)
      }
      if (predicate.kind === 'comparison') {
        return query.not(predicate.field, predicate.operator, predicate.value)
      }
      return query.or(`not.${toPostgrestString(predicate)}`)
    }
  }
}

function toPostgrestString(node: SupabasePredicate): string {
  switch (node.kind) {
    case 'comparison':
      return `${node.field}.${node.operator}.${node.postgrestValue}`
    case 'in':
      return `${node.field}.in.(${node.postgrestValues.join(',')})`
    case 'isNull':
      return `${node.field}.is.null`
    case 'and':
      return `and(${node.predicates.map(toPostgrestString).join(',')})`
    case 'or':
      return `or(${node.predicates.map(toPostgrestString).join(',')})`
    case 'not':
      return `not.${toPostgrestString(node.predicate)}`
  }
}

export function applyLoadSubsetOptions(
  query: SupabaseQueryBuilder,
  options: LoadSubsetOptions,
): SupabaseQueryBuilder {
  return applyQueryPlan(query, compileLoadSubsetOptions(options))
}
