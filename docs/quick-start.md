# Quick start

This walks through opening a database, defining its shape, and doing real work:
writing, reading, querying, and paginating.

## 1. Describe your database

The `Schema` type maps each store name to its key type, value type, and any
index key types. This is what powers inference across the whole API.

```ts
import { type Schema } from 'idbkit';

interface Task {
  id: string;
  title: string;
  done: boolean;
  priority: number;
  createdAt: number;
}

interface AppSchema extends Schema {
  tasks: {
    key: string; // primary key type
    value: Task; // record type
    indexes: {
      byPriority: number;
      byCreatedAt: number;
    };
  };
}
```

## 2. Open the database

The `stores` config is the runtime description IndexedDB needs to create stores
and indexes. Keep it in sync with your `Schema` type.

```ts
import { openDatabase } from 'idbkit';

const db = await openDatabase<AppSchema>({
  name: 'todo-app',
  version: 1,
  stores: {
    tasks: {
      keyPath: 'id',
      indexes: {
        byPriority: { keyPath: 'priority' },
        byCreatedAt: { keyPath: 'createdAt' },
      },
    },
  },
});
```

## 3. Write records

```ts
import { uuid } from 'idbkit';

const tasks = db.store('tasks');

await tasks.add({
  id: uuid(),
  title: 'Write docs',
  done: false,
  priority: 1,
  createdAt: Date.now(),
});

// add() throws if the key exists; put() inserts or replaces.
await tasks.put({
  id: 'fixed-id',
  title: 'Ship release',
  done: false,
  priority: 2,
  createdAt: Date.now(),
});
```

### Bulk writes

```ts
await tasks.bulkAdd([
  { id: uuid(), title: 'A', done: false, priority: 3, createdAt: Date.now() },
  { id: uuid(), title: 'B', done: false, priority: 1, createdAt: Date.now() },
]);
```

A bulk call is atomic: if any record fails (say, a duplicate key) the whole
batch rolls back.

## 4. Read records

```ts
const one = await tasks.get('fixed-id');         // Task | undefined
const many = await tasks.getMany(['id1', 'id2']); // (Task | undefined)[]
const all = await tasks.getAll();                 // Task[]
const total = await tasks.count();                // number
const exists = await tasks.has('fixed-id');       // boolean
```

## 5. Query

```ts
// Highest-priority open tasks, newest first, capped at 10:
const urgent = await tasks
  .query()
  .index('byPriority')
  .aboveOrEqual(2)
  .filter((t) => !t.done)
  .reverse()
  .limit(10)
  .toArray();

// Just the titles:
const titles = await tasks.query().map((t) => t.title).toArray();

// First / last / count on a query:
const newest = await tasks.query().index('byCreatedAt').last();
```

## 6. Update atomically

`update` reads, applies your function, and writes back inside one transaction.

```ts
await tasks.update('fixed-id', (task) =>
  task ? { ...task, done: true } : undefined,
);

// Return undefined to delete:
await tasks.update('fixed-id', () => undefined);
```

## 7. Paginate

```ts
// Offset pagination with totals:
const { items, total, totalPages, hasNext } = await tasks.paginate({
  page: 1,
  pageSize: 20,
});

// Keyset pagination for large lists (cheap at any depth):
let after: string | undefined;
const page = await tasks.paginateKeyset({ pageSize: 20, after });
after = page.cursor ?? undefined;
```

## 8. Multi-store transactions

```ts
await db.transaction(['tasks'], 'readwrite', async (tx) => {
  const store = tx.store('tasks');
  const t = await store.get('fixed-id');
  if (t) await store.put({ ...t, priority: t.priority + 1 });
});
```

Inside a transaction callback, only await IndexedDB-derived promises. Awaiting an
unrelated promise (a `fetch`, a timer) lets the transaction commit before your
next operation — a quirk of IndexedDB itself, not idbkit. See
[best practices](./best-practices.md#the-one-transaction-rule-to-remember).

## Next steps

- [API reference](./api-reference.md) — every method and option.
- [Migration guide](./migration-guide.md) — evolving your schema over time.
- [Performance tips](./performance.md) — staying fast with large data.
