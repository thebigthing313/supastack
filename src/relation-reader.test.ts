import { describe, expect, it, vi } from 'vitest'
import { and, eq, gt, inArray, IR } from '@tanstack/db'
import { createRelationReader } from './relation-reader'

const ref = (name: string) => new IR.PropRef([name])

interface RecordedCall {
  method: string
  args: any[]
}

interface RecordedRequest {
  relationName: string
  selectColumns: string
  calls: RecordedCall[]
}

type FakeResponse = { data: any[] | null; error: unknown }
type FakeResolver = (request: RecordedRequest, index: number) => FakeResponse | Promise<FakeResponse>

function createFakeSupabase(resolve: FakeResolver) {
  const requests: RecordedRequest[] = []

  const supabase = {
    from: vi.fn((relationName: string) => ({
      select: vi.fn((selectColumns: string) =>
        createRecordingBuilder(relationName, selectColumns, requests, resolve),
      ),
    })),
  }

  return { supabase, requests }
}

function createRecordingBuilder(
  relationName: string,
  selectColumns: string,
  requests: RecordedRequest[],
  resolve: FakeResolver,
) {
  const request: RecordedRequest = { relationName, selectColumns, calls: [] }
  let executed = false
  let execution: Promise<FakeResponse> | null = null
  let builder: any

  const record = (method: string) => (...args: any[]) => {
    request.calls.push({ method, args })
    return builder
  }

  const execute = () => {
    if (!executed) {
      executed = true
      const snapshot = snapshotRequest(request)
      requests.push(snapshot)
      execution = Promise.resolve(resolve(snapshot, requests.length - 1))
    }
    return execution!
  }

  builder = {
    eq: record('eq'),
    gt: record('gt'),
    gte: record('gte'),
    lt: record('lt'),
    lte: record('lte'),
    like: record('like'),
    ilike: record('ilike'),
    in: record('in'),
    is: record('is'),
    not: record('not'),
    or: record('or'),
    order: record('order'),
    limit: record('limit'),
    range: record('range'),
    then(onFulfilled: any, onRejected: any) {
      return execute().then(onFulfilled, onRejected)
    },
  }

  return builder
}

function snapshotRequest(request: RecordedRequest): RecordedRequest {
  return {
    relationName: request.relationName,
    selectColumns: request.selectColumns,
    calls: request.calls.map((call) => ({ method: call.method, args: call.args })),
  }
}

function callsFor(request: RecordedRequest, method: string) {
  return request.calls.filter((call) => call.method === method)
}

describe('createRelationReader', () => {
  it('eager reads paginate until a short page is returned', async () => {
    const pages = [
      [{ id: 1 }, { id: 2 }],
      [{ id: 3 }],
    ]
    const { supabase, requests } = createFakeSupabase((_request, index) => ({
      data: pages[index] ?? [],
      error: null,
    }))

    const reader = createRelationReader({
      supabase,
      relationName: 'users',
      syncMode: 'eager',
      select: 'id,status',
      pageSize: 2,
    })

    const rows = await reader.read()

    expect(rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }])
    expect(supabase.from).toHaveBeenCalledWith('users')
    expect(requests.map((request) => request.selectColumns)).toEqual(['id,status', 'id,status'])
    expect(requests.map((request) => callsFor(request, 'range')[0].args)).toEqual([[0, 1], [2, 3]])
  })

  it('on-demand reads reject predicateless requests unless where, limit, or cursor is present', async () => {
    const { supabase } = createFakeSupabase(() => ({ data: [], error: null }))
    const reader = createRelationReader({
      supabase,
      relationName: 'users',
      syncMode: 'on-demand',
    })

    await expect(reader.read()).rejects.toThrow(/requires a where clause, limit, or cursor/)
    await expect(reader.read({})).rejects.toThrow(/requires a where clause, limit, or cursor/)

    await expect(reader.read({ where: eq(ref('status'), 'ONLINE') })).resolves.toEqual([])
    await expect(reader.read({ limit: 1 })).resolves.toEqual([])
    await expect(
      reader.read({
        cursor: {
          whereFrom: gt(ref('id'), 10),
          whereCurrent: eq(ref('id'), 10),
        },
      }),
    ).resolves.toEqual([])
  })

  it('explicit limit and offset plus limit do not trigger auto-pagination', async () => {
    const { supabase, requests } = createFakeSupabase(() => ({ data: [{ id: 1 }, { id: 2 }], error: null }))
    const reader = createRelationReader({
      supabase,
      relationName: 'users',
      syncMode: 'on-demand',
      pageSize: 2,
    })

    await reader.read({ limit: 2 })
    await reader.read({ offset: 20, limit: 2 })

    expect(requests).toHaveLength(2)
    expect(callsFor(requests[0], 'limit')[0].args).toEqual([2])
    expect(callsFor(requests[0], 'range')).toHaveLength(0)
    expect(callsFor(requests[1], 'range')[0].args).toEqual([20, 21])
  })

  it('large inArray filters are chunked and merged', async () => {
    const { supabase, requests } = createFakeSupabase((_request, index) => ({
      data: [{ chunk: index }],
      error: null,
    }))
    const reader = createRelationReader({
      supabase,
      relationName: 'users',
      syncMode: 'on-demand',
      inArrayChunkSize: 2,
    })

    const ids = [1, 2, 3, 4, 5]
    const rows = await reader.read({ where: inArray(ref('id'), ids as any) })

    expect(rows).toEqual([{ chunk: 0 }, { chunk: 1 }, { chunk: 2 }])
    expect(requests).toHaveLength(3)
    expect(requests.map((request) => callsFor(request, 'in')[0].args)).toEqual([
      ['id', [1, 2]],
      ['id', [3, 4]],
      ['id', [5]],
    ])
  })

  it('chunked requests preserve surrounding filters', async () => {
    const { supabase, requests } = createFakeSupabase(() => ({ data: [], error: null }))
    const reader = createRelationReader({
      supabase,
      relationName: 'users',
      syncMode: 'on-demand',
      inArrayChunkSize: 2,
    })

    const where = and(eq(ref('status'), 'ONLINE'), inArray(ref('id'), [1, 2, 3] as any))
    await reader.read({ where })

    expect(requests).toHaveLength(2)
    for (const request of requests) {
      expect(callsFor(request, 'eq')).toContainEqual({ method: 'eq', args: ['status', 'ONLINE'] })
      expect(callsFor(request, 'in')).toHaveLength(1)
    }
  })

  it('cursor and order options are applied through the read boundary', async () => {
    const { supabase, requests } = createFakeSupabase(() => ({ data: [], error: null }))
    const reader = createRelationReader({
      supabase,
      relationName: 'users',
      syncMode: 'on-demand',
    })

    await reader.read({
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
      limit: 5,
    })

    expect(requests).toHaveLength(1)
    expect(callsFor(requests[0], 'eq')).toContainEqual({ method: 'eq', args: ['status', 'ONLINE'] })
    expect(callsFor(requests[0], 'gt')).toContainEqual({ method: 'gt', args: ['id', 10] })
    expect(callsFor(requests[0], 'order')).toContainEqual({
      method: 'order',
      args: ['created_at', { ascending: false, nullsFirst: true }],
    })
    expect(callsFor(requests[0], 'limit')[0].args).toEqual([5])
  })

  it('Supabase errors propagate unchanged', async () => {
    const error = new Error('database unavailable')
    const { supabase } = createFakeSupabase(() => ({ data: null, error }))
    const reader = createRelationReader({
      supabase,
      relationName: 'users',
      syncMode: 'on-demand',
    })

    await expect(reader.read({ limit: 1 })).rejects.toBe(error)
  })
})
