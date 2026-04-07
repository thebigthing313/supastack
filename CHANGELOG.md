# supabase-sync

## 0.3.0

### Minor Changes

- Add `startSync`, `select`, `autoIndex`, `defaultIndexType` config options and `wrapOptions` hook for persistence integration.
  - `startSync: false` — defer syncing for auth-gated collections
  - `select: 'id,name'` — fetch specific columns instead of `*`
  - `autoIndex: 'eager'` + `defaultIndexType: BasicIndex` — automatic index creation
  - `wrapOptions` — hook to wrap collection options before `createCollection` (e.g., for adding persistence via `persistedCollectionOptions`)

## 0.2.0

### Minor Changes

- Add `operations` config to `TableConfig` for CRUD control. Accepts `['insert', 'update', 'delete']`. Defaults to all three. `operations: []` creates a read-only table collection.

## 0.1.0

### Initial Release

- `createSupabaseCollections` — typed collections for tables, views, and RPC
- Table collections: full CRUD with optimistic mutations via TanStack DB
- View collections: read-only with schema transform support
- RPC: query options factories for TanStack Query
- Expression mapper: TanStack DB operators to PostgREST filters
- On-demand mode with predicate pushdown and auto-pagination
- Zod/Standard Schema support for row/insert/update transforms
- In-array chunking for large IN() queries
- JSON column support via PostgREST arrow notation
