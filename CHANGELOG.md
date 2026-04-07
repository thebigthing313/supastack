# supabase-sync

## 0.2.0

### Minor Changes

- Add `operations` config to `TableConfig` to control which CRUD handlers are registered. Accepts an array of `'insert' | 'update' | 'delete'`. Defaults to all three. Setting `operations: []` creates a read-only table collection.
