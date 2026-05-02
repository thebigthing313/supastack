# supastack

Type-safe [TanStack DB](https://tanstack.com/db) collections and [TanStack Query](https://tanstack.com/query) options for [Supabase](https://supabase.com) tables, views, and RPC functions.

Feed your Supabase-generated `Database` type to `createSupabaseCollections` and get:

- **Tables** — CRUD-enabled TanStack DB collections with optimistic mutations
- **Views** — read-only collections
- **RPC** — query options factories for `useQuery` / `useSuspenseQuery`

All fully typed end-to-end from your `database.types.ts`.

## Install

```bash
npm install supastack
# or
pnpm add supastack
```

### Peer dependencies

```bash
pnpm add @supabase/supabase-js @tanstack/db @tanstack/query-core @tanstack/query-db-collection
```

For React, also add the TanStack bindings:

```bash
pnpm add @tanstack/react-db @tanstack/react-query
```

## Quick start

### 1. Generate your Supabase types

```bash
supabase gen types typescript --local > src/database.types.ts
```

### 2. Create collections

```ts
import { createClient } from '@supabase/supabase-js'
import { QueryClient } from '@tanstack/query-core'
import { createSupabaseCollections } from 'supastack'
import type { Database } from './database.types'

const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY)
const queryClient = new QueryClient()

export const db = createSupabaseCollections<Database>(supabase, queryClient, {
  tables: {
    todos: { keyColumn: 'id' },
    users: { keyColumn: 'id' },
  },
  views: {
    active_users: { keyColumn: 'id' },
  },
})
```

### 3. Use in React

```tsx
import { useLiveQuery } from '@tanstack/react-db'
import { useQuery } from '@tanstack/react-query'
import { db } from './db'

// Live query — re-renders when data changes
function TodoList() {
  const { data: todos } = useLiveQuery((q) =>
    q.from({ todos: db.tables.todos })
      .where(({ todos }) => eq(todos.completed, false))
      .orderBy(({ todos }) => todos.created_at, 'desc'),
  )

  return todos?.map((todo) => <div key={todo.id}>{todo.title}</div>)
}

// Mutations — optimistic by default
function AddTodo() {
  const handleAdd = () => {
    db.tables.todos.insert({
      id: crypto.randomUUID(),
      title: 'New todo',
      completed: false,
      user_id: currentUserId,
    })
  }
  return <button onClick={handleAdd}>Add</button>
}

// RPC — returns query options for useQuery
function SearchResults({ query }: { query: string }) {
  const { data } = useQuery({
    ...db.rpc.search_todos({ query }),
    enabled: query.length > 0,
  })
  return data?.map((r) => <div key={r.id}>{r.title}</div>)
}
```

## Configuration

### Table config

```ts
createSupabaseCollections<Database>(supabase, queryClient, {
  tables: {
    todos: {
      // Required: column used as the collection key
      keyColumn: 'id',

      // Sync mode: 'eager' (default) loads all rows upfront,
      // 'on-demand' fetches only rows matching the current query
      syncMode: 'eager',

      // Delay initial sync (e.g., until the user is authenticated)
      startSync: true,

      // Column selection passed to Supabase's .select()
      select: 'id, title, completed',

      // Which mutation operations to enable (default: all three)
      // Use [] for read-only table collections
      operations: ['insert', 'update', 'delete'],

      // Automatic index creation for where expressions
      autoIndex: 'eager',         // 'off' (default) or 'eager'
      defaultIndexType: BasicIndex,

      // TanStack Query options
      staleTime: 30_000,
      refetchInterval: 60_000,
      enabled: true,
      retry: 3,
      retryDelay: 1000,
      gcTime: 300_000,

      // Pagination tuning
      pageSize: 1000,          // rows per page for auto-pagination
      inArrayChunkSize: 200,   // max items per IN() before chunking

      // Schema validation/transformation (Zod, Valibot, ArkType, etc.)
      schemas: {
        row: todoRowSchema,       // transform fetched rows
        insert: todoInsertSchema, // validate before insert
        update: todoUpdateSchema, // validate before update (receives partial)
      },
    },
  },
})
```

### View config

Same as table config but without `insert`/`update` schemas or `operations`. Views are read-only.

```ts
{
  views: {
    active_users: {
      keyColumn: 'id',
      staleTime: 60_000,
      schemas: { row: activeUserSchema },
    },
  },
}
```

### RPC config

Per-function schemas and query options for RPC calls:

```ts
{
  rpcs: {
    search_todos: {
      schemas: {
        args: searchArgsSchema,     // validate args before the network call
        returns: searchResultSchema, // validate/transform the response
      },
      staleTime: 10_000,
      retry: 3,
      gcTime: 60_000,
    },
  },
}
```

RPCs without a config entry work exactly the same — zero-config by default, opt-in depth when you need it.

### `wrapOptions`

Hook to wrap collection options before `createCollection`. Use for persistence:

```ts
{
  wrapOptions: (options) => persistedCollectionOptions(options),
}
```

## Schema transforms

Supabase returns date/time columns as strings. Use a schema to transform them:

```ts
import { z } from 'zod'

const todoRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean(),
  created_at: z.string().transform((s) => new Date(s)),
})

const db = createSupabaseCollections<Database>(supabase, queryClient, {
  tables: {
    todos: {
      keyColumn: 'id',
      schemas: { row: todoRowSchema },
    },
  },
})
// db.tables.todos now has created_at: Date instead of string
```

Any library implementing the [Standard Schema](https://github.com/standard-schema/standard-schema) protocol works (Zod, Valibot, ArkType, etc.).

### Preserving types with `defineConfig`

TypeScript widens schema types when config is stored in a variable. Use `defineConfig` to preserve literal types:

```ts
import { createSupabaseCollections, defineConfig } from 'supastack'

const define = defineConfig<Database>()

export const config = define({
  tables: {
    todos: {
      keyColumn: 'id',
      schemas: { row: todoRowSchema },
    },
  },
})

// Schema output types are preserved
const db = createSupabaseCollections<Database>(supabase, queryClient, config)
```

## On-demand collections

For large tables, use `syncMode: 'on-demand'` to fetch only rows matching the current query. TanStack DB pushes predicates down and supastack translates them to PostgREST filters.

```ts
const db = createSupabaseCollections<Database>(supabase, queryClient, {
  tables: {
    logs: { keyColumn: 'id', syncMode: 'on-demand' },
  },
})
```

### Operator mapping

| TanStack DB | PostgREST |
|---|---|
| `eq` | `.eq()` |
| `gt`, `gte`, `lt`, `lte` | `.gt()`, `.gte()`, `.lt()`, `.lte()` |
| `inArray` | `.in()` |
| `like`, `ilike` | `.like()`, `.ilike()` |
| `isNull`, `isUndefined` | `.is(field, null)` |
| `and(a, b)` | chained filters |
| `or(a, b)` | `.or()` |
| `not(expr)` | `.not()` |
| `orderBy` | `.order()` |
| `limit` / `offset` | `.limit()` / `.range()` |

### JSON columns

Multi-segment field paths are automatically converted to PostgREST arrow notation:

```ts
// data.address.city  ->  data->address->>city
.where(({ row }) => eq(row.data.address.city, 'NYC'))
```

### Safeguards

- **Predicateless guard** — on-demand collections throw if queried without a `where`, `limit`, or cursor to prevent accidentally fetching the entire table.
- **Auto-pagination** — both eager and on-demand modes paginate via `.range()` to avoid Supabase's default 1,000-row limit.
- **IN() chunking** — large `inArray` filters are split into parallel HTTP requests (default chunk size: 200) to avoid URL length limits.

## RPC

`db.rpc` returns query options objects. Pass them to `useQuery`, `useSuspenseQuery`, or call `queryFn` directly:

```ts
// With useQuery
const { data } = useQuery(db.rpc.search_todos({ query: 'hello' }))

// With additional options
const { data } = useQuery({
  ...db.rpc.search_todos({ query }),
  enabled: query.length > 0,
})

// Per-call overrides (when rpcs config is set)
const opts = db.rpc.search_todos({ query }, { staleTime: 5_000 })

// No-arg functions
const { data: time } = useQuery(db.rpc.get_server_time())

// Direct call
const result = await db.rpc.search_todos({ query: 'hello' }).queryFn()
```

## Advanced exports

For building custom integrations on top of supastack:

```ts
import {
  // Main API
  createSupabaseCollections,
  defineConfig,

  // Relation reader — preferred read boundary for custom integrations
  createRelationReader,

  // Query pipeline — compatibility helpers for custom queryFns
  createQueryFn,
  executeQuery,

  // Mutation handlers — build custom mutation logic
  createMutationHandlers,

  // RPC proxy — build a standalone RPC layer
  createRpcProxy,

  // Expression translation — apply TanStack DB filters to Supabase queries
  applyLoadSubsetOptions,

  // Legacy (use executeQuery instead)
  fetchTableData,
} from 'supastack'
```

```ts
// Types
import type {
  TableConfig,
  ViewConfig,
  TableSchemas,
  QueryOptions,
  SupabaseCollectionsConfig,
  RpcQueryOptions,
  RpcConfig,
  MutationHandlerConfig,
  MutationHandlers,
  RelationReader,
  RelationReaderConfig,
  SupabaseRelationClient,
} from 'supastack'
```

## Troubleshooting

If you see type errors about `Collection` not being assignable, you likely have duplicate versions of `@tanstack/db`. Run `pnpm dedupe` to fix it.

## License

[MIT](LICENSE.md)
