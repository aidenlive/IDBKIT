# API reference

Every exported value and type, organized by area. Types in angle brackets refer
to your `Schema` (`S`), a store name (`Name`), and that store's value/key types.

- [Opening a database](#opening-a-database)
- [Database](#database)
- [Store](#store)
- [Index](#index)
- [QueryBuilder](#querybuilder)
- [Cursors](#cursors)
- [Pagination](#pagination)
- [Key generators](#key-generators)
- [Backup & restore](#backup--restore)
- [Retry](#retry)
- [Errors](#errors)
- [Range helpers](#range-helpers)
- [Types](#types)

---

## Opening a database

### `openDatabase<S>(config): Promise<Database<S>>`

Opens (creating or upgrading as needed) an IndexedDB database.

```ts
const db = await openDatabase<AppSchema>({
  name: 'app',
  version: 1,
  stores: { users: { keyPath: 'id', indexes: { byEmail: { keyPath: 'email', unique: true } } } },
});
```

`config` (`DatabaseConfig`):

| Field | Type | Notes |
| --- | --- | --- |
| `name` | `string` | Required. |
| `version` | `number` | Positive integer. Defaults to `1`. Increment to upgrade. |
| `stores` | `StoresConfig` | Store and index definitions. |
| `migrations` | `Record<number, Migration>` | Per-version data migrations. |
| `migrationOptions` | `MigrationOptions` | Schema-reconciliation behavior. |
| `onBlocked` | `(e) => void` | Called when an older connection blocks the upgrade. |
| `onVersionChange` | `(e) => void` | Called when a newer version opens elsewhere. Default closes this connection. |
| `retries` | `number` | Retry transient open failures. Defaults to `0`. |

`StoreConfig`:

| Field | Type | Notes |
| --- | --- | --- |
| `keyPath` | `string \| string[] \| null` | In-line key path; array = compound key; `null`/omit = out-of-line. |
| `autoIncrement` | `boolean` | Generate integer keys. |
| `indexes` | `Record<string, IndexConfig>` | Indexes by name. |

`IndexConfig`: `{ keyPath: string | string[]; unique?: boolean; multiEntry?: boolean }`.

---

## Database

Returned by `openDatabase`. A typed handle to the open connection.

### Properties

- `name: string`
- `version: number`
- `storeNames: string[]`
- `raw: IDBDatabase` — the native connection (escape hatch).

### `store<Name>(name): Store<S, Name>`

Returns a typed store handle. Each operation runs in its own auto-committing
transaction.

### `transaction<T>(storeNames, mode, callback, options?): Promise<T>`

Runs multiple operations in one atomic transaction.

```ts
await db.transaction(['a', 'b'], 'readwrite', async (tx) => {
  await tx.store('a').put(x);
  await tx.store('b').delete(k);
});
```

- `storeNames` — a store name or array of names. Must cover every store the
  callback touches.
- `mode` — `'readonly'` or `'readwrite'`.
- `callback(scope)` — receives a `TransactionScope` with `scope.store(name)`.
  **Await only IndexedDB-derived promises inside.** Throwing aborts (rolls back)
  the transaction.
- `options.retries` — retry the whole transaction on transient failures.

Returns whatever the callback returns.

### `close(): void`

Closes the connection. Idempotent.

### `delete(): Promise<void>`

Closes and deletes the entire database.

### `reset(): Promise<this>`

Deletes all data and reopens a fresh database with the same schema. Returns the
same handle, now pointing at the new connection.

### `export(): Promise<DatabaseSnapshot>`

Snapshots every store into a structured-clone-friendly object.

### `exportJSON(pretty?): Promise<string>`

Snapshots and serializes to JSON.

### `import(snapshot, options?): Promise<void>`

Writes a snapshot into the database. `options.mode` is `'merge'` (default,
upsert) or `'replace'` (clear each store first). `options.stores` limits which
stores are imported.

### `restore(snapshot, stores?): Promise<void>`

Shorthand for `import(snapshot, { mode: 'replace', stores })`.

### `clear(stores?): Promise<void>`

Empties the given stores, or all stores when omitted.

### `downloadBackup(filename?): Promise<DatabaseSnapshot>`

Browser only. Exports a snapshot and triggers a JSON file download.

---

## Store

Returned by `db.store(name)` or `tx.store(name)`. `V` is the store's value type,
`K` its key type.

### Reads

| Method | Returns | Notes |
| --- | --- | --- |
| `get(key)` | `Promise<V \| undefined>` | By primary key. |
| `getMany(keys)` | `Promise<(V \| undefined)[]>` | One transaction; order preserved. |
| `getAll(query?, count?)` | `Promise<V[]>` | `query` is a key, `IDBKeyRange`, or `null`. |
| `getAllKeys(query?, count?)` | `Promise<K[]>` | Primary keys. |
| `getKey(query)` | `Promise<K \| undefined>` | First match. `query` is a key or range. |
| `count(query?)` | `Promise<number>` | |
| `has(key)` | `Promise<boolean>` | |

### Writes

| Method | Returns | Notes |
| --- | --- | --- |
| `add(value, key?)` | `Promise<K>` | Rejects with `ConstraintError` if the key exists. |
| `put(value, key?)` | `Promise<K>` | Insert or replace. |
| `update(key, updater)` | `Promise<V \| undefined>` | Read-modify-write atomically. Return `undefined` from `updater` to delete. |
| `delete(key \| range)` | `Promise<void>` | A single key or every record in a range. |
| `clear()` | `Promise<void>` | Remove all records. |

### Bulk

| Method | Returns | Notes |
| --- | --- | --- |
| `bulkAdd(values, keys?)` | `Promise<K[]>` | Atomic. `keys` required only for out-of-line stores. |
| `bulkPut(values, keys?)` | `Promise<K[]>` | Atomic. |
| `bulkDelete(keys)` | `Promise<void>` | Atomic. |

### Iteration & queries

- `iterate(callback, options?)` — cursor walk; see [Cursors](#cursors).
- `query()` — returns a [`QueryBuilder`](#querybuilder) over the primary key.
- `index(name)` — returns a typed [`Index`](#index).
- `paginate(options)` / `paginateKeyset(options)` — see [Pagination](#pagination).

---

## Index

Returned by `store.index(name)`. `IK` is the index's key type.

| Method | Returns |
| --- | --- |
| `get(value)` | `Promise<V \| undefined>` — first record whose index key equals `value`. |
| `getAll(query?, count?)` | `Promise<V[]>` |
| `getAllKeys(query?, count?)` | `Promise<K[]>` — primary keys. |
| `getKey(query)` | `Promise<K \| undefined>` — primary key of first match. |
| `count(query?)` | `Promise<number>` |
| `query()` | `QueryBuilder` scoped to this index. |

---

## QueryBuilder

A fluent, **immutable** builder. Every operator returns a new builder, so
partial queries are safe to reuse. Construct via `store.query()` or
`store.index(name).query()`.

### Source & range operators

| Method | Effect |
| --- | --- |
| `index(name)` | Switch to a named index (re-types comparison values). |
| `equals(value)` | Exact match. |
| `above(value)` / `aboveOrEqual(value)` | Lower bound (exclusive / inclusive). |
| `below(value)` / `belowOrEqual(value)` | Upper bound (exclusive / inclusive). |
| `between(lower, upper, { lowerOpen?, upperOpen? })` | Bounded range. |
| `startsWith(prefix)` | String-prefix range. |
| `startsWithKeys(prefix)` | Compound-key prefix (leading segments fixed). |

### Shaping

| Method | Effect |
| --- | --- |
| `reverse()` | Descending order. |
| `distinct()` | Skip duplicate keys (`nextunique`/`prevunique`). |
| `limit(n)` | Cap results. |
| `offset(n)` | Skip the first `n` of the (filtered) result. |
| `filter(predicate)` | In-memory filter: `(value, key, primaryKey) => boolean`. |
| `map(fn)` | Transform each emitted record (changes the result type). |

### Terminals

| Method | Returns |
| --- | --- |
| `toArray()` | `Promise<T[]>` |
| `first()` | `Promise<T \| undefined>` |
| `last()` | `Promise<T \| undefined>` |
| `count()` | `Promise<number>` — honors `filter`, ignores `limit`/`offset`. |
| `keys()` | `Promise<ValidKey[]>` — cursor keys (index keys when an index is active). |
| `primaryKeys()` | `Promise<K[]>` |
| `forEach(cb)` | `Promise<void>` — `cb(value, primaryKey)`. |
| `delete()` | `Promise<number>` — deletes matching records, returns the count. |
| `paginate({ page, pageSize })` | `Promise<OffsetPageResult<T>>` |
| `paginateKeyset({ pageSize, after? })` | `Promise<KeysetPageResult<T, KQ>>` |

**Execution:** a bare range with no filter, no offset, and ascending direction
uses `getAll` (fast). Anything else walks a cursor. With a `filter`, `offset`
applies to the *filtered* sequence.

---

## Cursors

### `store.iterate(callback, options?): Promise<void>`

Walk records with a cursor. The callback is **synchronous** and may return a
`CursorDirective`.

```ts
await store.iterate(
  (step) => {
    // step: { value, key, primaryKey, index }
    if (step.value.expired) return { delete: true };
    if (step.index >= 99) return { stop: true };
    return undefined;
  },
  { mode: 'readwrite', index: 'byCreatedAt', direction: 'prev' },
);
```

`IterateOptions`: `{ mode?, query?, direction?, offset?, index? }`. Use
`mode: 'readwrite'` when the callback updates or deletes.

`CursorDirective`: `{ stop?, delete?, update?, advance? }`. (`delete` takes
priority over `update`; `advance` skips ahead by N, minimum 1.)

### `walkCursor(source, options, onRecord, context?): Promise<void>`

The lower-level primitive `iterate` is built on. `source` is a raw
`IDBObjectStore` or `IDBIndex`; useful inside `db.transaction` when you already
hold a store.

> Do per-record async work *after* collecting, not during the walk — awaiting an
> unrelated promise mid-cursor would let the transaction commit.

---

## Pagination

### `store.paginate(options): Promise<OffsetPageResult<V>>`

`OffsetPageOptions`: `{ page, pageSize, index?, range?, direction? }`.

`OffsetPageResult`: `{ items, page, pageSize, total, totalPages, hasPrevious, hasNext }`.

Runs the count and the page in one read transaction, so they're consistent.

### `store.paginateKeyset(options): Promise<KeysetPageResult<V, K>>`

`KeysetPageOptions`: `{ pageSize, index?, after?, direction?, range? }`.

`KeysetPageResult`: `{ items, cursor, hasMore }`. Pass the returned `cursor` as
the next call's `after`.

Keyset pagination stays O(pageSize) at any depth. It's exact for unique keys
(primary key or unique index); across duplicate index keys, boundaries may
repeat or skip, so paginate by a unique key when exactness matters.

Standalone forms `offsetPage(ctx, options)` and `keysetPage(ctx, options)` are
also exported.

---

## Key generators

| Function | Returns | Notes |
| --- | --- | --- |
| `uuid()` | `string` | RFC 4122 v4. Uses native `crypto.randomUUID` when available. |
| `ulid(seedTime?)` | `string` | 26-char, lexicographically sortable, monotonic within a millisecond. |
| `timestampKey(suffixLength?)` | `string` | Zero-padded epoch millis + random suffix. |
| `counter(start?, prefix?)` | `KeyGenerator` | In-memory monotonic counter (not persisted). |
| `createKeyGenerator(fn)` | `KeyGenerator` | Wrap a custom producing function. |

---

## Backup & restore

All operate on a database (via the `Database` methods above) or a raw
`IDBDatabase`:

| Function | Notes |
| --- | --- |
| `exportSnapshot(idb)` / `backup(idb)` | Read every store into a `DatabaseSnapshot`. |
| `importSnapshot(idb, snapshot, options?)` | Write a snapshot back. `mode`: `'merge'` \| `'replace'`. |
| `restore(idb, snapshot, stores?)` | Clear-then-import. |
| `clearStores(idb, stores?)` | Empty stores in one transaction. |
| `snapshotToJSON(snapshot, pretty?)` | Serialize. |
| `snapshotFromJSON(json)` | Parse with a shape check. |
| `downloadBackup(idb, filename?)` | Browser: export + download. |

A snapshot stores explicit keys only for out-of-line stores; in-line and
auto-increment keys round-trip inside the value.

---

## Retry

### `withRetry(operation, options?): Promise<T>`

Runs `operation(attempt)`, retrying transient failures with exponential backoff
and full jitter.

`RetryOptions`: `{ retries?, minDelay?, maxDelay?, factor?, shouldRetry?, onRetry?, signal? }`.
By default, only plausibly-transient failures retry (see `isRetryable`).

```ts
const data = await withRetry(() => store.getAll(), { retries: 5 });
```

---

## Errors

Every rejection is an `IDBKitError`. Subclasses let you branch:

| Class | When |
| --- | --- |
| `DatabaseError` | Open/close/delete/connection failures. |
| `TransactionError` | Transaction failed, aborted, or read-only violation. |
| `ConstraintError` | Unique/primary-key uniqueness violation. |
| `NotFoundError` | Missing record, store, or index. |
| `MigrationError` | Upgrade or migration failed. |
| `QuotaError` | Storage quota exceeded. |
| `BlockedError` | Upgrade/delete blocked by another connection. |
| `TimeoutError` | Operation exceeded its timeout. |
| `ValidationError` | Invalid arguments to an idbkit API. |

Helpers: `toIDBKitError(error, context)` maps a `DOMException`; `isRetryable(error)`
reports whether a failure is transient.

```ts
try {
  await users.add(user);
} catch (err) {
  if (err instanceof ConstraintError) {
    // email already taken
  }
}
```

---

## Range helpers

Handy when building ranges by hand (e.g. for `iterate` or raw cursors):

| Function | Returns |
| --- | --- |
| `buildRange({ lower?, upper?, lowerOpen?, upperOpen? })` | `IDBKeyRange \| null` |
| `only(value)` | `IDBKeyRange` |
| `stringPrefix(prefix)` | `IDBKeyRange` spanning a string prefix. |
| `compoundPrefix(prefix[])` | `IDBKeyRange` over a compound key with fixed leading segments. |

---

## Types

Exported type-only: `ValidKey`, `CursorDirection`, `TransactionMode`,
`StoreSchema`, `Schema`, `StoreValue`, `StoreKey`, `StoreIndexName`, `IndexKey`,
`IndexConfig`, `StoreConfig`, `StoresConfig`, `Migration`, `MigrationContext`,
`MigrationOptions`, `DatabaseConfig`, `DatabaseSnapshot`, `SnapshotRecord`,
`RetryOptions`, `CursorStep`, `CursorDirective`, `WalkOptions`, `QueryFilter`,
`OffsetPageOptions`, `OffsetPageResult`, `KeysetPageOptions`, `KeysetPageResult`,
`Query`, `IterateOptions`, `TransactionScope`, `TransactionRunOptions`,
`ImportMode`, `ImportOptions`, `KeyGenerator`, `RangeBounds`.

Plus the constant `VERSION: string`.
