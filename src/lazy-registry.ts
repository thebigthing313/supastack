const LAZY_REGISTRY_GUARD_KEYS = new Set([
  'then',
  'catch',
  'finally',
  'toJSON',
  'valueOf',
  '$$typeof',
  'constructor',
  'prototype',
  '__proto__',
])

type LazyRegistryMode = 'configured' | 'dynamic'

export interface CreateLazyRegistryOptions<TValue, TConfig = unknown> {
  entries?: Readonly<Record<string, TConfig | undefined>>
  create: (name: string, config: TConfig | undefined) => TValue
  mode?: LazyRegistryMode
}

export function createLazyRegistry<TValue, TConfig = unknown>({
  entries,
  create,
  mode = 'configured',
}: CreateLazyRegistryOptions<TValue, TConfig>): Record<string, TValue | undefined> {
  const cache = new Map<string, TValue>()

  function read(name: string | symbol): TValue | undefined {
    if (!isSafeRegistryKey(name)) return undefined
    if (cache.has(name)) return cache.get(name)
    if (mode === 'configured' && !hasConfiguredEntry(entries, name)) return undefined

    const value = create(name, entries?.[name])
    cache.set(name, value)
    return value
  }

  return new Proxy({} as Record<string, TValue | undefined>, {
    get(_target, name) {
      return read(name)
    },
    has(_target, name) {
      if (!isSafeRegistryKey(name)) return false
      return mode === 'dynamic' || hasConfiguredEntry(entries, name)
    },
    ownKeys() {
      return Object.keys(entries ?? {}).filter((name) => entries?.[name] !== undefined)
    },
    getOwnPropertyDescriptor(_target, name): PropertyDescriptor | undefined {
      if (typeof name === 'string' && hasConfiguredEntry(entries, name)) {
        return { configurable: true, enumerable: true }
      }
    },
  })
}

function isSafeRegistryKey(name: string | symbol): name is string {
  return typeof name === 'string' && !LAZY_REGISTRY_GUARD_KEYS.has(name)
}

function hasConfiguredEntry<TConfig>(
  entries: Readonly<Record<string, TConfig | undefined>> | undefined,
  name: string,
): boolean {
  return entries !== undefined
    && Object.prototype.hasOwnProperty.call(entries, name)
    && entries[name] !== undefined
}
