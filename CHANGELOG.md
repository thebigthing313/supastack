# supastack

## 1.1.0

### Minor Changes

- Add `createRelationReader` as the preferred advanced read boundary for custom table and view integrations, with eager/on-demand reads, auto-pagination, IN predicate chunking, and on-demand safeguards behind one small interface (#6).
- Add and document advanced API boundary types including `RelationReader`, `RelationReaderConfig`, `SupabaseRelationClient`, `QueryFn`, `QueryPipelineConfig`, and `FetchTableDataOptions` (#11).

### Patch Changes

- Deepen collection creation around a relation factory so table and view assembly share one internal path for query options, row schemas, mutation wiring, and TanStack collection creation (#7).
- Compile TanStack DB load-subset options through a query-plan layer before applying them to Supabase builders, keeping `applyLoadSubsetOptions` as the low-level compatibility boundary (#8).
- Consolidate Standard Schema validation behavior for row schemas, table mutations, and RPC args/returns (#9).
- Extract shared lazy registry behavior for table and view collection proxies while preserving spread, enumeration, guard-key, and caching semantics (#10).
- Document the advanced public API boundary and retain legacy read helpers as compatibility wrappers for the current major version (#11).

## 1.0.3

### Patch Changes

- Fix on-demand `queryKey` to produce a clean `[name]` base prefix instead of `[name, { where: undefined, ... }]`, which broke TanStack Query's prefix matching and caused stale cache warnings (#5). Only serializable fields (`where`, `orderBy`, `limit`, `offset`) are included when defined.

## 1.0.2 (yanked)

### Patch Changes

- Attempted fix for #5 by passing `opts` through directly — caused `JSON.stringify` failures due to circular references in the full opts object.

## 1.0.1

### Patch Changes

- Tighten peer dependency ranges for `@tanstack/db`, `@tanstack/query-db-collection`, and `@tanstack/query-core`.
- Drop npm publish workflow; add troubleshooting note to README.

## 1.0.0

### Major Changes

- Rename package from `supabase-sync` to `supastack`.
- Stable release — no API changes from 0.3.x.
- Add CI workflow (Node 20, 22).

## 0.3.6

### Patch Changes

- On-demand collections now use a `queryKey` function that serializes `LoadSubsetOptions` (where, orderBy, limit, offset), giving each unique predicate set its own TanStack Query cache entry.

## 0.3.5

### Patch Changes

- Fix `{ ...db.tables }` and `Object.keys(db.tables)` — Proxy objects now support spread and enumeration via `ownKeys`/`getOwnPropertyDescriptor` traps while preserving lazy collection creation.

## 0.3.4

### Patch Changes

- Fix compiled output missing `.js` extensions on relative imports, which broke Node ESM resolution. Source imports now use `.ts` extensions with `rewriteRelativeImportExtensions` in tsconfig.

## 0.3.3

### Patch Changes

- Narrow collection key type to match the actual `keyColumn` type from the DB schema instead of `string | number`.

## 0.3.2

### Patch Changes

- Fix collection return type to use the Zod row schema output type (`StandardSchemaV1.InferOutput`) instead of the raw database row type when a `schemas.row` is provided.
- Add `defineConfig<DB>()` helper to preserve literal schema types through variable assignment (same pattern as Vite's `defineConfig`).

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
