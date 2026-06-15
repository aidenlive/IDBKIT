# FAQ

### How is this different from `idb`, Dexie, or localForage?

- **`idb`** is a minimal promise wrapper around the raw API. idbkit is closer to
  the metal than Dexie but adds more than `idb`: a typed schema, a query builder,
  pagination, key generators, and backup/restore — while keeping zero runtime
  dependencies.
- **Dexie** is a larger, feature-rich ORM-like library with its own query
  language and addon ecosystem. idbkit is smaller and stays mapped 1:1 to
  IndexedDB concepts, which makes it easy to reason about and drop into an
  existing IndexedDB app.
- **localForage** is a key/value store that abstracts over IndexedDB,
  WebSQL, and localStorage. idbkit embraces IndexedDB specifically — stores,
  indexes, transactions, cursors — rather than reducing it to get/set.

Pick idbkit when you want real IndexedDB with types and ergonomics, not a
different database model on top of it.

### Do I have to write the schema twice (config and types)?

You write the runtime `stores` config (which IndexedDB needs to build stores and
indexes) and a `Schema` type (which drives inference). They describe the same
thing from two angles. Keeping them side by side is intentional — the type can
encode value shapes the runtime config can't.

### What happens if I `await` a `fetch` inside a transaction?

The transaction commits before your next operation, and that operation throws a
`TransactionError`. This is an IndexedDB rule, not an idbkit limitation: a
transaction stays alive only while it has pending requests. Do non-IndexedDB
async work outside the transaction. See
[best practices](./best-practices.md#the-one-transaction-rule-to-remember).

### Can I use it without TypeScript?

Yes. The JavaScript API is identical; you simply don't get compile-time types.
The published package includes type declarations for editors that surface them
in plain JS too.

### Is it tree-shakeable?

Yes. The package is marked `"sideEffects": false` and ships as ESM, so bundlers
drop anything you don't import. Importing only `uuid` won't pull in the query
builder, for instance.

### How big is it?

The ESM bundle is roughly 13 KB gzipped, and tree-shaking trims it further based
on what you use. There are no dependencies to add to that.

### Does it work offline / in a PWA?

That's a core use case. IndexedDB persists locally and works without a network.
idbkit runs in Service Workers and Web Workers, so it fits offline-first and
background-sync architectures. The `offline-cache` example shows a TTL cache
pattern.

### How do I store files or images?

Store `Blob` or `ArrayBuffer` values — IndexedDB supports them via structured
clone. Keep large binaries in their own store keyed from the metadata record, so
listing metadata doesn't deserialize the blobs. See
[performance](./performance.md#keep-values-lean).

### How do I handle storage limits?

Catch `QuotaError` and free space or prompt the user. Use
`navigator.storage.estimate()` to check usage and `navigator.storage.persist()`
to request durable storage. See
[best practices](./best-practices.md#plan-for-quota-and-eviction).

### Can multiple tabs use the same database?

Yes — connections are shared per origin. The catch is upgrades: opening a new
version while other tabs hold the old one blocks until they close. idbkit's
default behavior closes outdated connections; add an `onBlocked` handler to guide
users when needed.

### Is keyset pagination always exact?

It's exact when paginating by a unique key (the primary key or a `unique`
index). Across a non-unique index, records sharing a key can straddle a page
boundary and repeat or skip. Paginate by a unique key when exactness matters; the
`large-collections` example does this.

### How do I migrate from a database I created with raw IndexedDB?

Point idbkit's `stores` config at your existing store and index names and shapes,
and set `version` to your current on-disk version. idbkit reconciles to the
config without recreating what already matches. From there, bump the version to
evolve. See the [migration guide](./migration-guide.md).

### Can I get at the native IndexedDB objects?

Yes — `db.raw` is the underlying `IDBDatabase`, and `walkCursor` accepts raw
`IDBObjectStore`/`IDBIndex` objects. The escape hatch is always there for things
the high-level API doesn't cover.

### Why did my migration's async work not run?

If you used `await` on non-IndexedDB work inside a migration, the upgrade
transaction committed first. Drive cursors and requests with their native event
callbacks (`onsuccess`, `continue()`), which keep the upgrade transaction alive.
