import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { TableSchemas } from './index.ts'

type CrudOperation = 'insert' | 'update' | 'delete'

interface SupabaseClientLike {
  from(table: string): any
}

export interface MutationHandlerConfig {
  tableName: string
  keyColumn: string
  schemas?: TableSchemas
  supabase: SupabaseClientLike
  operations?: CrudOperation[]
}

export interface MutationHandlers {
  onInsert?: (ctx: { transaction: any; collection: any }) => Promise<void>
  onUpdate?: (ctx: { transaction: any; collection: any }) => Promise<void>
  onDelete?: (ctx: { transaction: any; collection: any }) => Promise<void>
}

const ALL_OPERATIONS: CrudOperation[] = ['insert', 'update', 'delete']

async function validateWithSchema(schema: StandardSchemaV1, data: unknown): Promise<unknown> {
  const result = await schema['~standard'].validate(data)
  if (result.issues) throw new Error(`Validation failed: ${JSON.stringify(result.issues)}`)
  return result.value
}

async function withRefetch(col: any, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } finally {
    await col.utils.refetch()
  }
}

export function createMutationHandlers(config: MutationHandlerConfig): MutationHandlers {
  const { tableName, keyColumn, schemas, supabase, operations = ALL_OPERATIONS } = config
  const enabled = new Set(operations)
  const table = () => supabase.from(tableName)
  const handlers: MutationHandlers = {}

  if (enabled.has('insert')) {
    handlers.onInsert = async ({ transaction, collection: col }: any) => {
      await withRefetch(col, async () => {
        const items = []
        for (const mutation of transaction.mutations) {
          let item = mutation.modified
          if (schemas?.insert) {
            item = await validateWithSchema(schemas.insert, item)
          }
          items.push(item)
        }
        const payload = items.length === 1 ? items[0] : items
        const { error } = await table().insert(payload)
        if (error) throw error
      })
    }
  }

  if (enabled.has('update')) {
    handlers.onUpdate = async ({ transaction, collection: col }: any) => {
      await withRefetch(col, async () => {
        for (const mutation of transaction.mutations) {
          const { key, changes } = mutation
          let updateData = changes
          if (schemas?.update) {
            updateData = await validateWithSchema(schemas.update, changes)
          }
          const { error } = await table().update(updateData).eq(keyColumn, key)
          if (error) throw error
        }
      })
    }
  }

  if (enabled.has('delete')) {
    handlers.onDelete = async ({ transaction, collection: col }: any) => {
      await withRefetch(col, async () => {
        const keys = transaction.mutations.map((m: any) => m.key)
        const { error } = await table().delete().in(keyColumn, keys)
        if (error) throw error
      })
    }
  }

  return handlers
}
