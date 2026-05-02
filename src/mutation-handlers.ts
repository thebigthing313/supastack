import { validateInsertPayload, validateUpdatePayload } from './schema-boundary.ts'
import type { TableSchemas } from './schema-boundary.ts'

type CrudOperation = 'insert' | 'update' | 'delete'

interface SupabaseClientLike {
  from(table: string): any
}

export interface MutationHandlerConfig {
  tableName: string
  keyColumn: string
  schemas?: TableSchemas
  supabase: SupabaseClientLike
  /** Mutation operations to attach. Defaults to insert, update, and delete. */
  operations?: CrudOperation[]
}

export interface MutationHandlers {
  onInsert?: (ctx: { transaction: any; collection: any }) => Promise<void>
  onUpdate?: (ctx: { transaction: any; collection: any }) => Promise<void>
  onDelete?: (ctx: { transaction: any; collection: any }) => Promise<void>
}

const ALL_OPERATIONS: CrudOperation[] = ['insert', 'update', 'delete']

async function withRefetch(col: any, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } finally {
    await col.utils.refetch()
  }
}

/**
 * Builds TanStack DB mutation callbacks for custom table collections.
 *
 * This extension point owns Supabase insert/update/delete side effects and
 * optional schema validation. It intentionally does not create collections,
 * query options, or read behavior.
 */
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
          items.push(await validateInsertPayload(schemas?.insert, mutation.modified))
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
          const updateData = await validateUpdatePayload(schemas?.update, changes)
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
