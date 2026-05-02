import type { StandardSchemaV1 } from '@standard-schema/spec'

export type SchemaBoundary = 'row' | 'insert' | 'update' | 'rpcArgs' | 'rpcReturns'

export interface TableSchemas {
  /** Schema to validate/transform row data fetched from Supabase. */
  row?: StandardSchemaV1
  /** Schema to validate/transform data before inserting. Receives the full row. */
  insert?: StandardSchemaV1
  /**
   * Schema to validate/transform data before updating.
   * Receives only the changed fields (partial), not the full row.
   * All fields in this schema should be optional.
   */
  update?: StandardSchemaV1
}

export interface ViewSchemas {
  /** Schema to validate/transform row data fetched from Supabase. */
  row?: StandardSchemaV1
}

export interface RpcSchemas {
  args?: StandardSchemaV1
  returns?: StandardSchemaV1
}

export class SchemaValidationError extends Error {
  readonly boundary: SchemaBoundary
  readonly issues: unknown

  constructor(boundary: SchemaBoundary, issues: unknown) {
    super(`Validation failed: ${JSON.stringify(issues)}`)
    this.name = 'SchemaValidationError'
    this.boundary = boundary
    this.issues = issues
  }
}

export function attachRowSchema(
  options: Record<string, any>,
  schema: StandardSchemaV1 | undefined,
): void {
  if (schema) {
    options.schema = schema
  }
}

export function validateInsertPayload(
  schema: StandardSchemaV1 | undefined,
  payload: unknown,
): Promise<unknown> {
  return validateOptionalSchema(schema, payload, 'insert')
}

export function validateUpdatePayload(
  schema: StandardSchemaV1 | undefined,
  changes: unknown,
): Promise<unknown> {
  return validateOptionalSchema(schema, changes, 'update')
}

export function validateRpcArgs(
  schema: StandardSchemaV1 | undefined,
  args: unknown,
): Promise<unknown> {
  return validateOptionalSchema(schema, args, 'rpcArgs')
}

export function validateRpcReturns(
  schema: StandardSchemaV1 | undefined,
  data: unknown,
): Promise<unknown> {
  return validateOptionalSchema(schema, data, 'rpcReturns')
}

async function validateOptionalSchema(
  schema: StandardSchemaV1 | undefined,
  data: unknown,
  boundary: SchemaBoundary,
): Promise<unknown> {
  if (!schema) return data

  const result = await schema['~standard'].validate(data)
  if (result.issues) throw new SchemaValidationError(boundary, result.issues)
  return result.value
}
