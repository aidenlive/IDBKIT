# Migration guide

idbkit splits schema evolution into two concerns:

1. **Structure** — which stores and indexes exist. You declare the *target* in
   `stores`, and idbkit reconciles the database to match during an upgrade.
2. **Data** — transforming existing records. You write per-version `migrations`
   that run inside the upgrade transaction.

## How upgrades run

IndexedDB triggers an upgrade when you open with a higher `version` than what's
on disk. During that single `versionchange` transaction, idbkit:

1. Creates any stores in `stores` that don't exist yet.
2. For each store, creates missing indexes and (by default) recreates indexes
   whose definition changed.
3. Optionally drops stores/indexes no longer in the config.
4. Runs your `migrations` for every version in `(oldVersion, newVersion]`, in
   ascending order.

Everything happens atomically: if any step throws, the upgrade aborts and the
database stays at the old version.

## Adding a store or index

Just declare it and bump the version. No migration function needed.

```ts
// v1
stores: { users: { keyPath: 'id' } }

// v2 — add an index
const db = await openDatabase<AppSchema>({
  name: 'app',
  version: 2,
  stores: {
    users: {
      keyPath: 'id',
      indexes: { byEmail: { keyPath: 'email', unique: true } },
    },
  },
});
```

## Backfilling data

Use a migration when new fields or indexes need existing rows updated.

```ts
const db = await openDatabase<AppSchema>({
  name: 'app',
  version: 3,
  stores: {
    users: {
      keyPath: 'id',
      indexes: {
        byEmail: { keyPath: 'email', unique: true },
        byEmailLower: { keyPath: 'emailLower' }, // new — needs a value on every row
      },
    },
  },
  migrations: {
    3: ({ transaction }) => {
      const store = transaction.objectStore('users');
      store.openCursor().onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (!cursor) return;
        const user = cursor.value;
        cursor.update({ ...user, emailLower: user.email.toLowerCase() });
        cursor.continue();
      };
    },
  },
});
```

> **Migrations must stay synchronous** (or await only IndexedDB work). The
> `versionchange` transaction commits as soon as there are no pending requests,
> so awaiting a `fetch` or timer would end the upgrade early. Drive cursors with
> the native event callbacks as shown, and the transaction stays alive.

`MigrationContext` gives you `{ database, transaction, fromVersion, toVersion }`.

## Renaming or reshaping a store

IndexedDB can't change a store's `keyPath` or `autoIncrement` after creation —
idbkit throws a `MigrationError` if your config disagrees with the live store. To
truly reshape, create a new store, copy data across in a migration, and drop the
old one (with `migrationOptions.dropMissingStores`).

```ts
const db = await openDatabase<AppSchema>({
  name: 'app',
  version: 4,
  migrationOptions: { dropMissingStores: true },
  stores: {
    usersV2: { keyPath: 'uuid' }, // new shape
  },
  migrations: {
    4: ({ transaction, database }) => {
      if (!database.objectStoreNames.contains('users')) return;
      const oldStore = transaction.objectStore('users');
      const newStore = transaction.objectStore('usersV2');
      oldStore.openCursor().onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (!cursor) return;
        const { id, ...rest } = cursor.value;
        newStore.add({ uuid: id, ...rest });
        cursor.continue();
      };
    },
  },
});
```

## Migration options

`migrationOptions`:

| Option | Default | Effect |
| --- | --- | --- |
| `dropMissingStores` | `false` | Delete stores not present in `stores`. |
| `dropMissingIndexes` | `false` | Delete indexes not present in a store's config. |
| `recreateChangedIndexes` | `true` | Drop and rebuild an index when its `keyPath`/`unique`/`multiEntry` changed. |

Leaving the drop options off is the safe default: idbkit only *adds* unless you
opt in to removal.

## Tips

- **Never reuse a version number for different schemas.** Users who already ran
  v2 won't re-run its migration. Always move forward.
- **Test upgrades**, not just fresh installs — open at the old version, write
  data, then open at the new version and assert the result. (See the project's
  integration tests for the pattern.)
- **Keep migrations idempotent where you can** (guard with
  `objectStoreNames.contains` / `indexNames.contains`).
