# supabase-sync

Type-safe [TanStack DB](https://tanstack.com/db) collections and [TanStack Query](https://tanstack.com/query) options for [Supabase](https://supabase.com) tables, views, and RPC functions.

Feed your Supabase-generated `Database` type to `createSupabaseCollections` and get:

- **Tables** — CRUD-enabled TanStack DB collections with optimistic mutations
- **Views** — read-only collections
- **RPC** — query options factories for `useQuery` / `useSuspenseQuery`

All fully typed from your `database.types.ts`.

## Install

```bash
npm install supabase-sync
# or
pnpm add supabase-sync
```

### Peer dependencies

You bring these — supabase-sync uses your copies so there's a single shared instance:

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
import { createSupabaseCollections } from 'supabase-sync'
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
{
  tables: {
    todos: {
      // Required: column used as the collection key and for .eq() filters
      keyColumn: 'id',

      // Optional: 'eager' (default) loads all rows, 'on-demand' uses predicate pushdown
      syncMode: 'eager',

      // Optional: TanStack Query options
      staleTime: 30_000,
      refetchInterval: 60_000,
      enabled: true,
      retry: 3,
      retryDelay: 1000,
      gcTime: 300_000,

      // Optional: pagination tuning
      pageSize: 1000,          // rows per page for auto-pagination (default: 1000)
      inArrayChunkSize: 200,   // max items per IN() clause before chunking (default: 200)

      // Optional: Zod / Standard Schema for data transformation
      schemas: {
        row: todoRowSchema,       // transform fetched rows (e.g., string → Date)
        insert: todoInsertSchema, // validate/transform before insert
        update: todoUpdateSchema, // validate/transform before update (receives partial)
      },
    },
  },
}
```

### View config

Same as table config but without `insert`/`update` schemas. Views are read-only — no mutation handlers are registered.

```ts
{
  views: {
    active_users: {
      keyColumn: 'id',
      staleTime: 60_000,
      schemas: {
        row: activeUserSchema, // transform fetched rows
      },
    },
  },
}
```

## Schema transforms

Supabase returns date/time columns as strings. Use a Zod schema to transform them:

```ts
import { z } from 'zod'

const todoRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  completed: z.boolean(),
  user_id: z.string(),
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
```

Any schema library implementing the [Standard Schema](https://github.com/standard-schema/standard-schema) protocol works (Zod, Valibot, ArkType, etc.).

## On-demand collections

For large tables, use `syncMode: 'on-demand'` to fetch only the rows that match the current query's filters. TanStack DB pushes predicates down to the collection, and supabase-sync translates them to PostgREST filters.

```ts
const db = createSupabaseCollections<Database>(supabase, queryClient, {
  tables: {
    logs: {
      keyColumn: 'id',
      syncMode: 'on-demand',
    },
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
// data.address.city → data->address->>city
.where(({ row }) => eq(row.data.address.city, 'NYC'))
```

### Safeguards

- **Predicateless guard**: on-demand collections throw if queried without a `where`, `limit`, or cursor — prevents accidentally fetching the entire table.
- **Auto-pagination**: both eager and on-demand modes paginate via `.range()` to avoid Supabase's default 1000-row limit.
- **IN() chunking**: large `inArray` filters are split into parallel HTTP requests (default chunk size: 200) to avoid URL length limits.

## RPC

`db.rpc` returns query options objects — not hooks. Pass them to `useQuery`, `useSuspenseQuery`, or call `queryFn` directly:

```ts
// With useQuery
const { data } = useQuery(db.rpc.search_todos({ query: 'hello' }))

// With additional options
const { data } = useQuery({
  ...db.rpc.search_todos({ query }),
  enabled: query.length > 0,
  staleTime: 10_000,
})

// No-arg functions
const { data: time } = useQuery(db.rpc.get_server_time())

// Direct call
const result = await db.rpc.search_todos({ query: 'hello' }).queryFn()
```

## Exports

```ts
import {
  createSupabaseCollections, // main factory
  applyLoadSubsetOptions,    // expression mapper (for advanced use)
  fetchTableData,            // data fetcher (for advanced use)
} from 'supabase-sync'

// Types
import type {
  TableConfig,
  ViewConfig,
  TableSchemas,
  QueryOptions,
  SupabaseCollectionsConfig,
  RpcQueryOptions,
} from 'supabase-sync'
```

## License

MIT
