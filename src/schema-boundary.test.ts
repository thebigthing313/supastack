import type { StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, it, vi } from 'vitest'
import {
  attachRowSchema,
  SchemaValidationError,
  validateInsertPayload,
  validateRpcArgs,
  validateRpcReturns,
  validateUpdatePayload,
  type SchemaBoundary,
} from './schema-boundary.ts'

function createSchema(
  validate: (data: unknown) => StandardSchemaV1.Result<unknown> | Promise<StandardSchemaV1.Result<unknown>>,
): StandardSchemaV1 {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: vi.fn(validate),
    },
  } as StandardSchemaV1
}

describe('schema boundary', () => {
  it('returns transformed values from successful validation', async () => {
    const schema = createSchema((data: any) => ({
      value: { ...data, name: data.name.trim() },
    }))

    await expect(validateInsertPayload(schema, { name: '  Ada  ' })).resolves.toEqual({
      name: 'Ada',
    })
  })

  it('returns original values when no schema is configured', async () => {
    const payload = { name: 'Ada' }

    await expect(validateUpdatePayload(undefined, payload)).resolves.toBe(payload)
  })

  it('produces consistent validation errors across schema boundaries', async () => {
    const issues = [{ message: 'Expected a non-empty value', path: ['name'] }]
    const schema = createSchema(() => ({ issues }))
    const cases: Array<[SchemaBoundary, () => Promise<unknown>]> = [
      ['insert', () => validateInsertPayload(schema, {})],
      ['update', () => validateUpdatePayload(schema, {})],
      ['rpcArgs', () => validateRpcArgs(schema, {})],
      ['rpcReturns', () => validateRpcReturns(schema, {})],
    ]

    for (const [boundary, run] of cases) {
      const error = await run().catch((caught) => caught)

      expect(error).toBeInstanceOf(SchemaValidationError)
      expect(error).toMatchObject({
        name: 'SchemaValidationError',
        boundary,
        issues,
        message: `Validation failed: ${JSON.stringify(issues)}`,
      })
    }
  })

  it('attaches row schemas in the option shape expected by TanStack DB', () => {
    const rowSchema = createSchema((data) => ({ value: data }))
    const options: Record<string, unknown> = {}

    attachRowSchema(options, rowSchema)

    expect(options).toEqual({ schema: rowSchema })
  })
})
