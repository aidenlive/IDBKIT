# Best practices

## The one transaction rule to remember

IndexedDB commits a transaction as soon as the event loop has no pending request
for it. In practice that means: **inside `db.transaction(...)` (or any
multi-step operation), only `await` IndexedDB-derived promises.**

```ts
// ❌ The await on fetch() lets the transaction commit; the second put fails.
await db.transaction(['orders'], 'readwrite', async (tx) => {
  const order = await tx.store('orders').get(id);
  const rate = await fetch('/rate').then((r) => r.json()); // ⛔ kills the tx
  await tx.store('orders').put({ ...order, rate });
});

// ✅ Do the network work first, then run a short transaction.
const rate = await fetch('/rate').then((r) => r.json());
await db.transaction(['orders'], 'readwrite', async (tx) => {
  const order = await tx.store('orders').get(id);
  await tx.store('orders').put({ ...order, rate });
});
```

Single-store helper methods (`store.get`, `store.put`, `store.update`, …) each
run in their own transaction, so this only bites you inside explicit
transactions and cursor callbacks.

## Model your indexes around your queries

Indexes are how IndexedDB avoids full scans. Add one for every field you filter,
sort, or look up by:

- Looking up users by email → `byEmail` (often `unique: true`).
- Sorting tasks by date → `byCreatedAt`.
- Filtering by two fields together → a **compound** index `['city', 'age']`.
- Searching within an array field → a **multiEntry** index (one entry per
  element), e.g. tags.

A query with no matching index falls back to walking every record with a
`filter`, which is fine for small stores and slow for large ones.

## Prefer keyset pagination for long lists

`paginate({ page })` is convenient and gives you totals, but jumping to page
500 means skipping 499 pages of records. For infinite scroll or large datasets,
`paginateKeyset` stays O(pageSize) at any depth.

## Choose keys deliberately

- **`autoIncrement`** — simplest when you never need the key before insert.
- **`uuid()`** — globally unique, good for records created offline and synced
  later. Random, so insertion order isn't preserved.
- **`ulid()`** — unique *and* lexicographically sortable by creation time; great
  when you want time-ordered keys without a separate index.

## Handle errors by type

```ts
import { ConstraintError, QuotaError } from 'idbkit';

try {
  await users.add(user);
} catch (err) {
  if (err instanceof ConstraintError) showDuplicateEmail();
  else if (err instanceof QuotaError) promptToFreeSpace();
  else throw err;
}
```

## Plan for quota and eviction

Browser storage is finite and, for non-persisted origins, can be evicted under
pressure. For data you can't lose, request persistence and treat IndexedDB as a
cache that might disappear:

```ts
if (navigator.storage?.persist) await navigator.storage.persist();
const { usage, quota } = await navigator.storage.estimate();
```

## Handle multi-tab upgrades

When one tab opens a new schema version, other tabs holding the old version
block the upgrade. idbkit's default `onVersionChange` closes the old connection
so the upgrade proceeds; pair it with an `onBlocked` handler that asks the user
to reload other tabs if needed.

## Keep values structured-clone friendly

IndexedDB stores values via the structured clone algorithm. Plain objects,
arrays, `Date`, `Map`, `Set`, `ArrayBuffer`, and typed arrays are fine.
Functions, DOM nodes, and class instances with methods are not — store plain
data and rehydrate on read.

## Close connections you're done with

Long-lived apps can keep one connection open for their lifetime. If you open
short-lived connections (e.g. in a worker that finishes), `db.close()` when done
so future upgrades aren't blocked.

## Back up before destructive operations

`db.reset()` and `restore()` delete data. In a real app, `export()` first (or
`downloadBackup()`), so a mistake is recoverable.
