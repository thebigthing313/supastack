import { describe, expect, it } from 'vitest'
import {
  IR,
  and,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  isUndefined,
  like,
  lt,
  lte,
  not,
  or,
} from '@tanstack/db'
import { applyLoadSubsetOptions, applyQueryPlan } from './apply-load-subset-options.ts'
import {
  compileLoadSubsetOptions,
  compilePredicate,
  findChunkableInPredicate,
  withInPredicateValues,
} from './load-subset-query-plan.ts'
import type { SupabaseQueryPlan } from './load-subset-query-plan.ts'

const ref = (name: string) => new IR.PropRef([name])
const jsonRef = (...segments: string[]) => new IR.PropRef(segments)

function createMockQueryBuilder() {
  const calls: Array<{ method: string; args: any[] }> = []

  const builder: any = new Proxy(
    {},
    {
      get(_target, method: string) {
        return (...args: any[]) => {
          calls.push({ method, args })
          return builder
        }
      },
    },
  )

  return { builder, calls }
}

describe('compileLoadSubsetOptions', () => {
  it('compiles supported comparison operators into predicate nodes', () => {
    const cases: Array<{ expression: unknown; operator: string; value: unknown; postgrestValue: string }> = [
      { expression: eq(ref('age'), 18), operator: 'eq', value: 18, postgrestValue: '18' },
      { expression: gt(ref('age'), 18), operator: 'gt', value: 18, postgrestValue: '18' },
      { expression: gte(ref('age'), 18), operator: 'gte', value: 18, postgrestValue: '18' },
      { expression: lt(ref('age'), 18), operator: 'lt', value: 18, postgrestValue: '18' },
      { expression: lte(ref('age'), 18), operator: 'lte', value: 18, postgrestValue: '18' },
      { expression: like(ref('age'), '%18%' as any), operator: 'like', value: '%18%', postgrestValue: '%18%' },
      { expression: ilike(ref('age'), '%18%' as any), operator: 'ilike', value: '%18%', postgrestValue: '%18%' },
    ]

    for (const { expression, operator, value, postgrestValue } of cases) {
      expect(compilePredicate(expression)).toEqual({
        kind: 'comparison',
        field: 'age',
        operator,
        value,
        postgrestValue,
      })
    }
  })

  it('compiles in, isNull, and isUndefined predicates', () => {
    expect(compilePredicate(inArray(ref('status'), ['ONLINE', 'AWAY'] as any))).toEqual({
      kind: 'in',
      field: 'status',
      values: ['ONLINE', 'AWAY'],
      postgrestValues: ['ONLINE', 'AWAY'],
    })

    expect(compilePredicate(isNull(ref('deleted_at')))).toEqual({
      kind: 'isNull',
      field: 'deleted_at',
    })

    expect(compilePredicate(isUndefined(ref('archived_at')))).toEqual({
      kind: 'isNull',
      field: 'archived_at',
    })
  })

  it('compiles nested and, or, and not predicates without applying them', () => {
    const predicate = compilePredicate(
      and(
        or(eq(ref('status'), 'ONLINE'), eq(ref('status'), 'AWAY')),
        not(inArray(ref('role'), ['banned', 'deleted'] as any)),
      ),
    )

    expect(predicate).toEqual({
      kind: 'and',
      predicates: [
        {
          kind: 'or',
          predicates: [
            {
              kind: 'comparison',
              field: 'status',
              operator: 'eq',
              value: 'ONLINE',
              postgrestValue: 'ONLINE',
            },
            {
              kind: 'comparison',
              field: 'status',
              operator: 'eq',
              value: 'AWAY',
              postgrestValue: 'AWAY',
            },
          ],
        },
        {
          kind: 'not',
          predicate: {
            kind: 'in',
            field: 'role',
            values: ['banned', 'deleted'],
            postgrestValues: ['banned', 'deleted'],
          },
        },
      ],
    })
  })

  it('compiles JSON column paths to PostgREST path syntax', () => {
    expect(compilePredicate(eq(jsonRef('data', 'name'), 'alice'))).toMatchObject({
      kind: 'comparison',
      field: 'data->>name',
    })

    expect(compilePredicate(eq(jsonRef('data', 'address', 'city'), 'NYC'))).toMatchObject({
      kind: 'comparison',
      field: 'data->address->>city',
    })
  })

  it('quotes PostgREST string values with special characters', () => {
    const predicate = compilePredicate(inArray(ref('name'), [
      'a,b',
      'x.y',
      'has(parens)',
      'has space',
      'quote"mark',
      'slash\\mark',
      '',
    ] as any))

    expect(predicate).toMatchObject({
      kind: 'in',
      postgrestValues: [
        '"a,b"',
        '"x.y"',
        '"has(parens)"',
        '"has space"',
        '"quote\\"mark"',
        '"slash\\\\mark"',
        '""',
      ],
    })
  })

  it('represents where, cursor whereFrom, ordering, limit, and range in the compiled plan', () => {
    const limitedPlan = compileLoadSubsetOptions({
      where: eq(ref('status'), 'ONLINE'),
      cursor: {
        whereFrom: gt(ref('id'), 10),
        whereCurrent: eq(ref('id'), 10),
      },
      orderBy: [
        {
          expression: ref('created_at'),
          compareOptions: { direction: 'desc' as const, nulls: 'first' as const },
        },
      ],
      limit: 25,
    })

    expect(limitedPlan).toEqual({
      predicates: [
        {
          kind: 'comparison',
          field: 'status',
          operator: 'eq',
          value: 'ONLINE',
          postgrestValue: 'ONLINE',
        },
        {
          kind: 'comparison',
          field: 'id',
          operator: 'gt',
          value: 10,
          postgrestValue: '10',
        },
      ],
      orderBy: [{ field: 'created_at', ascending: false, nullsFirst: true }],
      limit: 25,
    })

    expect(compileLoadSubsetOptions({ offset: 20, limit: 10 })).toMatchObject({
      range: { from: 20, to: 29 },
    })
  })

  it('fails unsupported expressions with a useful error', () => {
    expect(() => compilePredicate(new IR.Func('unknownOp', [ref('id'), new IR.Value(1)]))).toThrow(
      /Unsupported load subset expression.*Supported functions/,
    )
  })
})

describe('compiled in predicate chunking', () => {
  it('finds and replaces in predicates on the compiled representation', () => {
    const plan = compileLoadSubsetOptions({
      where: and(eq(ref('status'), 'ONLINE'), inArray(ref('id'), [1, 2, 3] as any)),
      limit: 10,
    })

    expect(findChunkableInPredicate(plan)).toEqual({ field: 'id', values: [1, 2, 3] })

    const chunkedPlan = withInPredicateValues(plan, 'id', [2, 3])
    expect(chunkedPlan).toEqual({
      ...plan,
      predicates: [
        {
          kind: 'and',
          predicates: [
            {
              kind: 'comparison',
              field: 'status',
              operator: 'eq',
              value: 'ONLINE',
              postgrestValue: 'ONLINE',
            },
            {
              kind: 'in',
              field: 'id',
              values: [2, 3],
              postgrestValues: ['2', '3'],
            },
          ],
        },
      ],
    })
  })
})

describe('applyQueryPlan', () => {
  it('applies a compiled plan through a small Supabase builder adapter', () => {
    const { builder, calls } = createMockQueryBuilder()

    applyQueryPlan(builder, compileLoadSubsetOptions({
      where: and(
        or(eq(ref('status'), 'ONLINE'), eq(ref('status'), 'AWAY')),
        not(isNull(ref('deleted_at'))),
      ),
      orderBy: [
        {
          expression: ref('created_at'),
          compareOptions: { direction: 'asc' as const, nulls: 'last' as const },
        },
      ],
      offset: 20,
      limit: 10,
    }))

    expect(calls).toEqual([
      { method: 'or', args: ['status.eq.ONLINE,status.eq.AWAY'] },
      { method: 'not', args: ['deleted_at', 'is', null] },
      { method: 'order', args: ['created_at', { ascending: true, nullsFirst: false }] },
      { method: 'range', args: [20, 29] },
    ])
  })
})

describe('applyLoadSubsetOptions', () => {
  it('keeps the existing compile-and-apply entry point', () => {
    const { builder, calls } = createMockQueryBuilder()
    const plan: SupabaseQueryPlan = compileLoadSubsetOptions({
      where: or(eq(ref('name'), "O'Brien"), eq(ref('name'), 'a,b')),
      limit: 1,
    })

    const result = applyLoadSubsetOptions(builder, {
      where: or(eq(ref('name'), "O'Brien"), eq(ref('name'), 'a,b')),
      limit: 1,
    })

    expect(result).toBe(builder)
    expect(plan.predicates).toHaveLength(1)
    expect(calls).toEqual([
      { method: 'or', args: [`name.eq."O'Brien",name.eq."a,b"`] },
      { method: 'limit', args: [1] },
    ])
  })
})
