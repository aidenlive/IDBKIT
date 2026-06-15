<div align="center">

# idbkit

**A typed, promise-based IndexedDB toolkit.**
Schema migrations, queries, cursors, pagination, bulk writes, and backup/restore — with zero runtime dependencies.

[Installation](#installation) · [Quick start](#quick-start) · [Docs](./docs) · [Examples](./examples) · [Playground](./site)

</div>

---

IndexedDB is powerful but low-level: event-based callbacks, transactions that
commit the instant you `await` the wrong thing, and no types. idbkit wraps it in
a small, modern API that stays close to the metal — promises, full TypeScript
inference, and helpers for the things you actually build (queries, pagination,
migrations, backups) without hiding the database underneath.

## Why idbkit

- **Typed end to end.** Describe your stores once; get inference on keys,
  values, indexes, and query results everywhere.
- **Promises, done right.** Every operation returns a promise, with transaction
  lifetimes handled so reads and writes don't silently drop.
- **Batteries included.** Migrations, a fluent query builder, cursor helpers,
  offset *and* keyset pagination, bulk writes, key generators, and
  backup/restore.
- **Zero runtime dependencies.** IndexedDB is native; idbkit is just a thin,
  well-typed layer. The ESM bundle is ~13 KB gzipped and fully tree-shakeable.
- **Works everywhere.** Ships ESM, CommonJS, and a drop-in `<script>` (IIFE)
  build.

## Installation

```bash
npm install idbkit
```

```ts
import { openDatabase } from 'idbkit';
```

Or drop it straight into a page — no build step:

```html
<script src="https://unpkg.com/idbkit"></script>
<script>
  const { openDatabase } = idbkit;
</script>
```

See [docs/installation.md](./docs/installation.md) for CDN, Deno, and bundler notes.

## Quick start

```ts
import { openDatabase, uuid, type Schema } from 'idbkit';

interface Note {
  id: string;
  title: string;
  body: string;
  tags: string[];
  updatedAt: number;
}

// Describe the database shape for full type inference.
interface AppSchema extends Schema {
  notes: {
    key: string;
    value: Note;
    indexes: { byUpdatedAt: number; byTag: string };
  };
}

const db = await openDatabase<AppSchema>({
  name: 'notebook',
  version: 1,
  stores: {
    notes: {
      keyPath: 'id',
      indexes: {
        byUpdatedAt: { keyPath: 'updatedAt' },
        byTag: { keyPath: 'tags', multiEntry: true }, // one entry per tag
      },
    },
  },
});

const notes = db.store('notes');

await notes.add({
  id: uuid(),
  title: 'Hello',
  body: 'First note',
  tags: ['intro', 'demo'],
  updatedAt: Date.now(),
});

// Most recent five notes, newest first.
const recent = await notes.query().index('byUpdatedAt').reverse().limit(5).toArray();

// Every note tagged "demo".
const demo = await notes.index('byTag').getAll('demo');
```

## Highlights

### Queries read like a sentence

```ts
const page = await db
  .store('notes')
  .query()
  .index('byUpdatedAt')
  .between(weekAgo, now)
  .filter((n) => n.tags.includes('work'))
  .reverse()
  .limit(20)
  .toArray();
```

The builder picks the cheapest execution path automatically: a plain bounded
query uses `getAll`; anything with a filter, offset, or reverse direction walks a
cursor.

### Atomic transactions across stores

```ts
await db.transaction(['accounts', 'ledger'], 'readwrite', async (tx) => {
  const accounts = tx.store('accounts');
  const from = await accounts.get('a');
  const to = await accounts.get('b');
  await accounts.put({ ...from, balance: from.balance - 100 });
  await accounts.put({ ...to, balance: to.balance + 100 });
  await tx.store('ledger').add({ id: uuid(), amount: 100, at: Date.now() });
});
// Throws inside the callback? Everything rolls back.
```

### Migrations that just describe the target

```ts
const db = await openDatabase<AppSchema>({
  name: 'notebook',
  version: 2,
  stores: {
    notes: {
      keyPath: 'id',
      indexes: {
        byUpdatedAt: { keyPath: 'updatedAt' },
        byTag: { keyPath: 'tags', multiEntry: true },
        byTitle: { keyPath: 'title' }, // new index — created automatically
      },
    },
  },
  migrations: {
    2: ({ transaction }) => {
      // Optional data backfill, runs inside the upgrade transaction.
      const store = transaction.objectStore('notes');
      store.openCursor().onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (!cursor) return;
        cursor.update({ ...cursor.value, title: cursor.value.title.trim() });
        cursor.continue();
      };
    },
  },
});
```

idbkit reconciles structure (new stores and indexes) from the config; your
migration functions handle data. See [docs/migration-guide.md](./docs/migration-guide.md).

### Pagination for large collections

```ts
// Offset pages, with totals:
const { items, total, totalPages, hasNext } =
  await db.store('notes').paginate({ page: 3, pageSize: 25 });

// Keyset pages, O(pageSize) at any depth:
let after: string | undefined;
const page = await db.store('notes').paginateKeyset({ pageSize: 50, after });
after = page.cursor ?? undefined;
```

### Backup and restore

```ts
const snapshot = await db.export();          // structured-clone-friendly object
const json = await db.exportJSON(true);      // or JSON
await db.import(snapshot);                    // merge back in
await db.reset();                            // wipe data, keep schema
await db.downloadBackup('notebook.json');     // browser: trigger a download
```

## API at a glance

| Area | Entry points |
| --- | --- |
| Open / manage | `openDatabase`, `Database` (`store`, `transaction`, `export`, `import`, `clear`, `reset`, `close`, `delete`) |
| Records | `Store` (`get`, `getMany`, `getAll`, `getKey`, `count`, `has`, `add`, `put`, `update`, `delete`, `clear`) |
| Bulk | `bulkAdd`, `bulkPut`, `bulkDelete` |
| Query | `store.query()` → `QueryBuilder`; `store.index(name)` |
| Cursors | `store.iterate`, `walkCursor` |
| Pagination | `store.paginate`, `store.paginateKeyset`, `offsetPage`, `keysetPage` |
| Keys | `uuid`, `ulid`, `timestampKey`, `counter`, `createKeyGenerator` |
| Backup | `exportSnapshot`, `importSnapshot`, `restore`, `clearStores`, `downloadBackup` |
| Reliability | `withRetry`, error classes, `toIDBKitError`, `isRetryable` |

Full reference: [docs/api-reference.md](./docs/api-reference.md).

## Documentation

- [Installation](./docs/installation.md)
- [Quick start](./docs/quick-start.md)
- [API reference](./docs/api-reference.md)
- [Migration guide](./docs/migration-guide.md)
- [Best practices](./docs/best-practices.md)
- [Performance tips](./docs/performance.md)
- [Browser compatibility](./docs/browser-compatibility.md)
- [FAQ](./docs/faq.md)

## Examples

Runnable, self-contained examples live in [`examples/`](./examples):

- **user-management** — CRUD, unique-email index, search, pagination.
- **settings-storage** — a tiny typed key/value store.
- **offline-cache** — a stale-while-revalidate cache with TTL.
- **large-collections** — 50k rows, keyset pagination, bulk writes.
- **transaction-workflows** — multi-store atomic transfers with rollback.

## The playground

`site/` is a single-page app with a live, in-browser playground that runs the
*actual* library against your browser's IndexedDB. Open it directly, or serve it:

```bash
npm run site   # builds the bundle and serves site/ at http://localhost:4173
```

## Development

```bash
npm install
npm run build        # ESM + CJS + IIFE + d.ts
npm test             # vitest (uses fake-indexeddb)
npm run test:coverage
npm run typecheck
npm run lint
npm run bench        # directional microbenchmarks (Node shim)
```

## Browser support

Chrome/Edge, Firefox, and Safari (current and recent versions) all ship the
IndexedDB features idbkit uses, including compound and multi-entry indexes and
`getAll`. Details and caveats in
[docs/browser-compatibility.md](./docs/browser-compatibility.md).

## License

[MIT](./LICENSE) © idbkit contributors
