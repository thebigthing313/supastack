import { describe, it, expect } from 'vitest'
import { eq, gt, gte, lt, lte, and, or, not, inArray, like, ilike, isNull, isUndefined, IR } from '@tanstack/db'
import { applyLoadSubsetOptions } from './apply-load-subset-options'

// Shorthand for creating a PropRef (field reference)
const ref = (name: string) => new IR.PropRef([name])
// Multi-segment PropRef for JSON paths: jsonRef('data', 'name') → PropRef(['data', 'name'])
const jsonRef = (...segments: string[]) => new IR.PropRef(segments)

// Creates a mock Supabase query builder that records chained calls
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

describe('applyLoadSubsetOptions', () => {
  describe('where filters', () => {
    it('applies eq filter', () => {
      const { builder, calls } = createMockQueryBuilder()

      const where = eq(ref('status'), 'ONLINE')
      applyLoadSubsetOptions(builder, { where })

      expect(calls).toContainEqual({ method: 'eq', args: ['status', 'ONLINE'] })
    })

    it('applies gt, gte, lt, lte filters', () => {
      const cases = [
        { fn: gt, method: 'gt' },
        { fn: gte, method: 'gte' },
        { fn: lt, method: 'lt' },
        { fn: lte, method: 'lte' },
      ] as const

      for (const { fn, method } of cases) {
        const { builder, calls } = createMockQueryBuilder()
        const where = fn(ref('age'), 18)
        applyLoadSubsetOptions(builder, { where })
        expect(calls).toContainEqual({ method, args: ['age', 18] })
      }
    })

    it('applies in filter', () => {
      const { builder, calls } = createMockQueryBuilder()

      const where = inArray(ref('status'), ['ONLINE', 'OFFLINE'] as any)
      applyLoadSubsetOptions(builder, { where })

      expect(calls).toContainEqual({ method: 'in', args: ['status', ['ONLINE', 'OFFLINE']] })
    })

    it('applies like and ilike filters', () => {
      for (const [fn, method] of [[like, 'like'], [ilike, 'ilike']] as const) {
        const { builder, calls } = createMockQueryBuilder()
        const where = fn(ref('username'), '%alice%' as any)
        applyLoadSubsetOptions(builder, { where })
        expect(calls).toContainEqual({ method, args: ['username', '%alice%'] })
      }
    })

    it('applies isUndefined as isNull (no postgres equivalent)', () => {
      const { builder, calls } = createMockQueryBuilder()

      const where = isUndefined(ref('deleted_at'))
      applyLoadSubsetOptions(builder, { where })

      expect(calls).toContainEqual({ method: 'is', args: ['deleted_at', null] })
    })

    it('applies isNull filter', () => {
      const { builder, calls } = createMockQueryBuilder()

      const where = isNull(ref('deleted_at'))
      applyLoadSubsetOptions(builder, { where })

      expect(calls).toContainEqual({ method: 'is', args: ['deleted_at', null] })
    })

    it('applies and combinator (multiple chained filters)', () => {
      const { builder, calls } = createMockQueryBuilder()

      const where = and(eq(ref('status'), 'ONLINE'), gt(ref('age'), 18))
      applyLoadSubsetOptions(builder, { where })

      expect(calls).toContainEqual({ method: 'eq', args: ['status', 'ONLINE'] })
      expect(calls).toContainEqual({ method: 'gt', args: ['age', 18] })
    })

    it('applies or combinator using supabase .or() syntax', () => {
      const { builder, calls } = createMockQueryBuilder()

      const where = or(eq(ref('status'), 'ONLINE'), eq(ref('status'), 'OFFLINE'))
      applyLoadSubsetOptions(builder, { where })

      expect(calls).toContainEqual({
        method: 'or',
        args: ['status.eq.ONLINE,status.eq.OFFLINE'],
      })
    })

    it('applies not filter', () => {
      const { builder, calls } = createMockQueryBuilder()

      const where = not(eq(ref('status'), 'OFFLINE'))
      applyLoadSubsetOptions(builder, { where })

      expect(calls).toContainEqual({ method: 'not', args: ['status', 'eq', 'OFFLINE'] })
    })

    it('applies not(isNull(...))', () => {
      const { builder, calls } = createMockQueryBuilder()

      const where = not(isNull(ref('deleted_at')))
      applyLoadSubsetOptions(builder, { where })

      expect(calls).toContainEqual({ method: 'not', args: ['deleted_at', 'is', null] })
    })

    it('applies not(inArray(...))', () => {
      const { builder, calls } = createMockQueryBuilder()

      const where = not(inArray(ref('status'), ['BANNED', 'DELETED'] as any))
      applyLoadSubsetOptions(builder, { where })

      expect(calls).toContainEqual({ method: 'not', args: ['status', 'in', '(BANNED,DELETED)'] })
    })

    it('quotes special chars in not(inArray(...)) values', () => {
      const { builder, calls } = createMockQueryBuilder()

      const where = not(inArray(ref('name'), ['a,b', 'c.d'] as any))
      applyLoadSubsetOptions(builder, { where })

      expect(calls).toContainEqual({ method: 'not', args: ['name', 'in', '("a,b","c.d")'] })
    })

    it('escapes values with special characters in or() filter strings', () => {
      const { builder, calls } = createMockQueryBuilder()

      const where = or(
        eq(ref('name'), "O'Brien"),
        eq(ref('name'), 'a,b'),
        eq(ref('name'), 'x.y'),
        eq(ref('name'), 'has(parens)'),
      )
      applyLoadSubsetOptions(builder, { where })

      // PostgREST requires double-quoting values with special chars
      expect(calls).toContainEqual({
        method: 'or',
        args: [`name.eq."O'Brien",name.eq."a,b",name.eq."x.y",name.eq."has(parens)"`],
      })
    })

    it('handles nested expressions: or inside and', () => {
      const { builder, calls } = createMockQueryBuilder()

      const where = and(
        or(eq(ref('status'), 'ONLINE'), eq(ref('status'), 'AWAY')),
        gt(ref('age'), 18),
      )
      applyLoadSubsetOptions(builder, { where })

      expect(calls).toContainEqual({
        method: 'or',
        args: ['status.eq.ONLINE,status.eq.AWAY'],
      })
      expect(calls).toContainEqual({ method: 'gt', args: ['age', 18] })
    })

    it('handles nested expressions: and inside or', () => {
      const { builder, calls } = createMockQueryBuilder()

      const where = or(
        and(eq(ref('status'), 'ONLINE'), gt(ref('age'), 18)),
        eq(ref('role'), 'admin'),
      )
      applyLoadSubsetOptions(builder, { where })

      // PostgREST or() syntax: each branch is a filter string
      expect(calls).toContainEqual({
        method: 'or',
        args: ['and(status.eq.ONLINE,age.gt.18),role.eq.admin'],
      })
    })
  })

  describe('json column paths', () => {
    it('converts multi-segment paths to PostgREST arrow notation for query builder', () => {
      const { builder, calls } = createMockQueryBuilder()

      // data.name → data->>'name' (text extraction for leaf)
      const where = eq(jsonRef('data', 'name'), 'alice')
      applyLoadSubsetOptions(builder, { where })

      expect(calls).toContainEqual({ method: 'eq', args: ['data->>name', 'alice'] })
    })

    it('converts deeply nested paths to chained arrow notation', () => {
      const { builder, calls } = createMockQueryBuilder()

      // data.address.city → data->address->>'city'
      const where = eq(jsonRef('data', 'address', 'city'), 'NYC')
      applyLoadSubsetOptions(builder, { where })

      expect(calls).toContainEqual({ method: 'eq', args: ['data->address->>city', 'NYC'] })
    })

    it('converts multi-segment paths in PostgREST filter strings (or context)', () => {
      const { builder, calls } = createMockQueryBuilder()

      const where = or(
        eq(jsonRef('data', 'role'), 'admin'),
        eq(ref('status'), 'ONLINE'),
      )
      applyLoadSubsetOptions(builder, { where })

      expect(calls).toContainEqual({
        method: 'or',
        args: ['data->>role.eq.admin,status.eq.ONLINE'],
      })
    })

    it('leaves single-segment paths unchanged', () => {
      const { builder, calls } = createMockQueryBuilder()

      const where = eq(ref('status'), 'ONLINE')
      applyLoadSubsetOptions(builder, { where })

      expect(calls).toContainEqual({ method: 'eq', args: ['status', 'ONLINE'] })
    })
  })

  describe('cursor pagination', () => {
    it('ANDs cursor.whereFrom with the main where clause', () => {
      const { builder, calls } = createMockQueryBuilder()

      const where = eq(ref('status'), 'ONLINE')
      const cursor = {
        whereFrom: gt(ref('id'), 100),
        whereCurrent: eq(ref('id'), 100),
      }

      applyLoadSubsetOptions(builder, { where, cursor })

      // Both the main where and cursor.whereFrom should be applied as chained filters
      expect(calls).toContainEqual({ method: 'eq', args: ['status', 'ONLINE'] })
      expect(calls).toContainEqual({ method: 'gt', args: ['id', 100] })
    })

    it('applies cursor.whereFrom even without a main where clause', () => {
      const { builder, calls } = createMockQueryBuilder()

      const cursor = {
        whereFrom: gt(ref('id'), 50),
        whereCurrent: eq(ref('id'), 50),
      }

      applyLoadSubsetOptions(builder, { cursor })

      expect(calls).toContainEqual({ method: 'gt', args: ['id', 50] })
    })
  })

  describe('no-op', () => {
    it('returns the query unchanged when options are empty', () => {
      const { builder, calls } = createMockQueryBuilder()

      const result = applyLoadSubsetOptions(builder, {})

      expect(calls).toHaveLength(0)
      expect(result).toBe(builder)
    })
  })

  describe('orderBy', () => {
    it('applies order by ascending', () => {
      const { builder, calls } = createMockQueryBuilder()

      const orderBy = [
        {
          expression: ref('created_at'),
          compareOptions: { direction: 'asc' as const, nulls: 'last' as const },
        },
      ]

      applyLoadSubsetOptions(builder, { orderBy })

      expect(calls).toContainEqual({
        method: 'order',
        args: ['created_at', { ascending: true, nullsFirst: false }],
      })
    })

    it('applies order by descending with nulls first', () => {
      const { builder, calls } = createMockQueryBuilder()

      const orderBy = [
        {
          expression: ref('score'),
          compareOptions: { direction: 'desc' as const, nulls: 'first' as const },
        },
      ]

      applyLoadSubsetOptions(builder, { orderBy })

      expect(calls).toContainEqual({
        method: 'order',
        args: ['score', { ascending: false, nullsFirst: true }],
      })
    })

    it('applies multiple orderBy columns in sequence', () => {
      const { builder, calls } = createMockQueryBuilder()

      const orderBy = [
        {
          expression: ref('status'),
          compareOptions: { direction: 'asc' as const, nulls: 'last' as const },
        },
        {
          expression: ref('created_at'),
          compareOptions: { direction: 'desc' as const, nulls: 'last' as const },
        },
      ]

      applyLoadSubsetOptions(builder, { orderBy })

      const orderCalls = calls.filter((c) => c.method === 'order')
      expect(orderCalls).toHaveLength(2)
      expect(orderCalls[0]).toEqual({
        method: 'order',
        args: ['status', { ascending: true, nullsFirst: false }],
      })
      expect(orderCalls[1]).toEqual({
        method: 'order',
        args: ['created_at', { ascending: false, nullsFirst: false }],
      })
    })
  })

  describe('limit and offset', () => {
    it('applies limit', () => {
      const { builder, calls } = createMockQueryBuilder()

      applyLoadSubsetOptions(builder, { limit: 10 })

      expect(calls).toContainEqual({ method: 'limit', args: [10] })
    })

    it('applies offset via range', () => {
      const { builder, calls } = createMockQueryBuilder()

      applyLoadSubsetOptions(builder, { offset: 20, limit: 10 })

      expect(calls).toContainEqual({ method: 'range', args: [20, 29] })
    })
  })
})
