# Performance tips

IndexedDB is fast when you work *with* its grain and slow when you fight it.
These are the levers that matter most.

## Batch writes into one transaction

Opening a transaction per record is the most common performance mistake. Each
transaction has fixed overhead; thousands of them dominate your runtime.

```ts
// ❌ 10,000 transactions
for (const row of rows) await store.add(row);

// ✅ One transaction, all writes
await store.bulkAdd(rows);
```

`bulkAdd`/`bulkPut`/`bulkDelete` issue every request inside a single transaction
and resolve when it commits. For very large imports (hundreds of thousands of
rows), chunk into batches of a few thousand to keep memory bounded:

```ts
const SIZE = 5_000;
for (let i = 0; i < rows.length; i += SIZE) {
  await store.bulkPut(rows.slice(i, i + SIZE));
}
```

## Let indexes do the filtering

A query backed by an index reads only matching records. A query that relies on
`.filter()` reads *every* record and discards most of them.

```ts
// ✅ index range — reads only the matches
db.store('events').query().index('byTimestamp').between(start, end).toArray();

// ❌ full scan — reads all events, filters in JS
db.store('events').query().filter((e) => e.timestamp >= start && e.timestamp <= end).toArray();
```

Combine an index range with a light `.filter()` for the residual predicate the
index can't express — the range still limits how much is read.

## Use `getAll` over manual cursors for plain reads

When you just need the records in a range (ascending, no per-record logic), the
query builder uses `getAll`, which is markedly faster than stepping a cursor in
JS. You get this automatically; you lose it the moment you add `.filter()`,
`.offset()`, or `.reverse()`, all of which require a cursor.

## Prefer keyset over offset pagination at depth

`offset`-based paging skips records by walking past them. Page 1 is instant;
page 1,000 walks 999 pages first. `paginateKeyset` seeks directly to the
boundary key and reads only the page:

```ts
let after: K | undefined;
const page = await store.paginateKeyset({ pageSize: 100, after });
after = page.cursor ?? undefined; // O(pageSize) no matter how deep
```

## Read keys when you don't need values

If you only need to know *which* records match (counts, existence, key lists),
`count()`, `getAllKeys()`, and `primaryKeys()` avoid deserializing values.

## Keep values lean

Every read and write deserializes/serializes the whole value via structured
clone. Large blobs inflate every operation that touches the record. Store big
binary payloads (images, files) as `Blob`/`ArrayBuffer` in their own store,
keyed from the metadata record, so listing metadata doesn't drag the blobs
along.

## Don't over-index

Each index is updated on every write to its store. A store with eight indexes
does eight extra writes per `put`. Index what you query; drop indexes you don't.

## Do heavy work in a Web Worker

IndexedDB is available in workers. Moving bulk imports, migrations, or large
scans off the main thread keeps the UI responsive. idbkit runs unchanged in a
worker.

## About the benchmarks in this repo

`npm run bench` runs microbenchmarks against `fake-indexeddb`, a Node polyfill.
They're useful for **relative** comparisons (e.g. bulk vs. per-record writes,
indexed vs. scanned queries) and for catching regressions, but the absolute
numbers won't match a real browser engine. Treat them as directional, and
measure in your target browsers for anything you intend to quote.
