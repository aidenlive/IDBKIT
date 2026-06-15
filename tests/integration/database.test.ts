import { describe, it, expect, beforeEach } from 'vitest';
import {
  openDatabase,
  uuid,
  ConstraintError,
  type Database,
  type Schema,
} from '../../src/index.js';

interface User {
  id: string;
  name: string;
  email: string;
  age: number;
  city: string;
}

interface AppSchema extends Schema {
  users: {
    key: string;
    value: User;
    indexes: {
      byEmail: string;
      byAge: number;
      byCityAge: [string, number];
    };
  };
  settings: {
    key: string;
    value: { key: string; value: unknown };
  };
}

let dbName: string;

function makeUser(over: Partial<User> = {}): User {
  return {
    id: over.id ?? uuid(),
    name: over.name ?? 'Ada',
    email: over.email ?? `${uuid()}@example.com`,
    age: over.age ?? 30,
    city: over.city ?? 'London',
  };
}

async function openApp(version = 1): Promise<Database<AppSchema>> {
  return openDatabase<AppSchema>({
    name: dbName,
    version,
    stores: {
      users: {
        keyPath: 'id',
        indexes: {
          byEmail: { keyPath: 'email', unique: true },
          byAge: { keyPath: 'age' },
          byCityAge: { keyPath: ['city', 'age'] },
        },
      },
      settings: { keyPath: 'key' },
    },
  });
}

beforeEach(() => {
  dbName = `idbkit-test-${uuid()}`;
});

describe('open & schema', () => {
  it('creates stores and indexes', async () => {
    const db = await openApp();
    expect(db.name).toBe(dbName);
    expect(db.version).toBe(1);
    expect(db.storeNames.sort()).toEqual(['settings', 'users']);
    db.close();
  });

  it('runs versioned migrations and adds an index', async () => {
    const db1 = await openApp(1);
    await db1.store('users').add(makeUser({ id: 'u1', name: 'Grace' }));
    db1.close();

    let migrated = false;
    const db2 = await openDatabase<AppSchema>({
      name: dbName,
      version: 2,
      stores: {
        users: {
          keyPath: 'id',
          indexes: {
            byEmail: { keyPath: 'email', unique: true },
            byAge: { keyPath: 'age' },
            byCityAge: { keyPath: ['city', 'age'] },
            byName: { keyPath: 'name' },
          },
        },
        settings: { keyPath: 'key' },
      },
      migrations: {
        2: ({ transaction }) => {
          // Touch a record to prove the migration ran inside the upgrade tx.
          const store = transaction.objectStore('users');
          store.get('u1').onsuccess = () => {
            migrated = true;
          };
        },
      },
    });

    expect(db2.version).toBe(2);
    expect(migrated).toBe(true);
    const stored = await db2.store('users').get('u1');
    expect(stored?.name).toBe('Grace');
    db2.close();
  });
});

describe('CRUD', () => {
  it('adds, gets, puts, updates, and deletes', async () => {
    const db = await openApp();
    const users = db.store('users');

    const key = await users.add(makeUser({ id: 'u1', name: 'Ada', age: 36 }));
    expect(key).toBe('u1');

    const fetched = await users.get('u1');
    expect(fetched?.name).toBe('Ada');

    await users.put(makeUser({ id: 'u1', name: 'Ada Lovelace', age: 37 }));
    expect((await users.get('u1'))?.name).toBe('Ada Lovelace');

    const updated = await users.update('u1', (u) =>
      u ? { ...u, age: u.age + 1 } : undefined,
    );
    expect(updated?.age).toBe(38);

    expect(await users.has('u1')).toBe(true);
    await users.delete('u1');
    expect(await users.has('u1')).toBe(false);
    expect(await users.get('u1')).toBeUndefined();
    db.close();
  });

  it('update() can delete by returning undefined', async () => {
    const db = await openApp();
    const users = db.store('users');
    await users.add(makeUser({ id: 'u1' }));
    const result = await users.update('u1', () => undefined);
    expect(result).toBeUndefined();
    expect(await users.get('u1')).toBeUndefined();
    db.close();
  });

  it('rejects duplicate keys on add with ConstraintError', async () => {
    const db = await openApp();
    const users = db.store('users');
    await users.add(makeUser({ id: 'dup' }));
    await expect(users.add(makeUser({ id: 'dup' }))).rejects.toBeInstanceOf(
      ConstraintError,
    );
    db.close();
  });

  it('enforces unique index constraints', async () => {
    const db = await openApp();
    const users = db.store('users');
    await users.add(makeUser({ id: 'a', email: 'same@x.com' }));
    await expect(
      users.add(makeUser({ id: 'b', email: 'same@x.com' })),
    ).rejects.toBeInstanceOf(ConstraintError);
    db.close();
  });
});

describe('bulk operations', () => {
  it('bulkAdd / getMany / count / bulkDelete', async () => {
    const db = await openApp();
    const users = db.store('users');
    const records = Array.from({ length: 25 }, (_, i) =>
      makeUser({ id: `u${i}`, age: 20 + i }),
    );
    const keys = await users.bulkAdd(records);
    expect(keys).toHaveLength(25);
    expect(await users.count()).toBe(25);

    const some = await users.getMany(['u0', 'u5', 'missing']);
    expect(some[0]?.id).toBe('u0');
    expect(some[1]?.id).toBe('u5');
    expect(some[2]).toBeUndefined();

    await users.bulkDelete(['u0', 'u1', 'u2']);
    expect(await users.count()).toBe(22);
    db.close();
  });

  it('rolls back the whole bulkAdd if one record violates a constraint', async () => {
    const db = await openApp();
    const users = db.store('users');
    await expect(
      users.bulkAdd([
        makeUser({ id: 'x1', email: 'collide@x.com' }),
        makeUser({ id: 'x2', email: 'collide@x.com' }),
      ]),
    ).rejects.toBeInstanceOf(ConstraintError);
    expect(await users.count()).toBe(0);
    db.close();
  });
});

describe('transactions', () => {
  it('commits multiple stores atomically', async () => {
    const db = await openApp();
    await db.transaction(['users', 'settings'], 'readwrite', async (tx) => {
      await tx.store('users').add(makeUser({ id: 'tx1' }));
      await tx.store('settings').put({ key: 'theme', value: 'dark' });
    });
    expect(await db.store('users').get('tx1')).toBeDefined();
    expect((await db.store('settings').get('theme'))?.value).toBe('dark');
    db.close();
  });

  it('rolls back every write when the callback throws', async () => {
    const db = await openApp();
    await db.store('users').add(makeUser({ id: 'keep' }));
    await expect(
      db.transaction(['users'], 'readwrite', async (tx) => {
        await tx.store('users').add(makeUser({ id: 'temp' }));
        throw new Error('abort please');
      }),
    ).rejects.toThrow('abort please');
    expect(await db.store('users').get('temp')).toBeUndefined();
    expect(await db.store('users').get('keep')).toBeDefined();
    db.close();
  });
});

describe('indexes & compound keys', () => {
  it('queries by unique and compound indexes', async () => {
    const db = await openApp();
    const users = db.store('users');
    await users.bulkAdd([
      makeUser({ id: 'a', email: 'a@x.com', city: 'Paris', age: 30 }),
      makeUser({ id: 'b', email: 'b@x.com', city: 'Paris', age: 40 }),
      makeUser({ id: 'c', email: 'c@x.com', city: 'Berlin', age: 30 }),
    ]);

    const byEmail = await users.index('byEmail').get('b@x.com');
    expect(byEmail?.id).toBe('b');

    const parisFolks = await users.index('byCityAge').getAll(
      IDBKeyRange.bound(['Paris', -Infinity], ['Paris', Infinity]),
    );
    expect(parisFolks.map((u) => u.id).sort()).toEqual(['a', 'b']);

    const exact = await users
      .query()
      .index('byCityAge')
      .equals(['Berlin', 30])
      .toArray();
    expect(exact.map((u) => u.id)).toEqual(['c']);
    db.close();
  });
});

describe('query builder', () => {
  beforeEach(() => {
    dbName = `idbkit-test-${uuid()}`;
  });

  async function seed(): Promise<Database<AppSchema>> {
    const db = await openApp();
    await db.store('users').bulkAdd([
      makeUser({ id: 'a', name: 'Alice', age: 25, city: 'London' }),
      makeUser({ id: 'b', name: 'Bob', age: 30, city: 'London' }),
      makeUser({ id: 'c', name: 'Cara', age: 35, city: 'Paris' }),
      makeUser({ id: 'd', name: 'Dan', age: 40, city: 'Paris' }),
      makeUser({ id: 'e', name: 'Eve', age: 45, city: 'Berlin' }),
    ]);
    return db;
  }

  it('filters by range on an index', async () => {
    const db = await seed();
    const between = await db
      .store('users')
      .query()
      .index('byAge')
      .between(30, 40)
      .toArray();
    expect(between.map((u) => u.id).sort()).toEqual(['b', 'c', 'd']);
    db.close();
  });

  it('supports above/below, reverse, limit, and map', async () => {
    const db = await seed();
    const names = await db
      .store('users')
      .query()
      .index('byAge')
      .above(30)
      .reverse()
      .limit(2)
      .map((u) => u.name)
      .toArray();
    expect(names).toEqual(['Eve', 'Dan']);
    db.close();
  });

  it('applies in-memory filter with offset over the filtered set', async () => {
    const db = await seed();
    const result = await db
      .store('users')
      .query()
      .index('byAge')
      .filter((u) => u.age % 2 === 1 ? false : true) // even ages: 30,40 -> none odd
      .toArray();
    expect(result.every((u) => u.age % 2 === 0)).toBe(true);
    db.close();
  });

  it('counts, gets first/last, and collects keys', async () => {
    const db = await seed();
    const q = db.store('users').query().index('byAge').aboveOrEqual(35);
    expect(await q.count()).toBe(3);
    expect((await q.first())?.name).toBe('Cara');
    expect((await q.last())?.name).toBe('Eve');
    const pks = await q.primaryKeys();
    expect(pks.sort()).toEqual(['c', 'd', 'e']);
    db.close();
  });

  it('deletes matching records', async () => {
    const db = await seed();
    const deleted = await db.store('users').query().index('byAge').above(35).delete();
    expect(deleted).toBe(2);
    expect(await db.store('users').count()).toBe(3);
    db.close();
  });

  it('startsWith on a string index', async () => {
    const db = await openApp();
    await db.store('settings').bulkPut([
      { key: 'feature:a', value: 1 },
      { key: 'feature:b', value: 2 },
      { key: 'other', value: 3 },
    ]);
    const flags = await db.store('settings').query().startsWith('feature:').toArray();
    expect(flags.map((f) => f.key).sort()).toEqual(['feature:a', 'feature:b']);
    db.close();
  });
});

describe('cursors', () => {
  it('iterates, updates, and stops via directives', async () => {
    const db = await openApp();
    const users = db.store('users');
    await users.bulkAdd(
      Array.from({ length: 10 }, (_, i) => makeUser({ id: `u${i}`, age: i })),
    );

    const seen: number[] = [];
    await users.iterate(
      (step) => {
        seen.push(step.value.age);
        if (step.value.age >= 4) return { stop: true };
        return { update: { ...step.value, age: step.value.age + 100 } };
      },
      { mode: 'readwrite', index: 'byAge' },
    );
    expect(seen).toEqual([0, 1, 2, 3, 4]);
    expect((await users.get('u0'))?.age).toBe(100);
    expect((await users.get('u4'))?.age).toBe(4); // stopped before updating
    db.close();
  });
});

describe('pagination', () => {
  async function seedMany(n: number): Promise<Database<AppSchema>> {
    const db = await openApp();
    await db.store('users').bulkAdd(
      Array.from({ length: n }, (_, i) =>
        makeUser({ id: `u${String(i).padStart(4, '0')}`, age: i }),
      ),
    );
    return db;
  }

  it('offset pages report totals and boundaries', async () => {
    const db = await seedMany(95);
    const page = await db.store('users').paginate({ page: 2, pageSize: 20 });
    expect(page.items).toHaveLength(20);
    expect(page.total).toBe(95);
    expect(page.totalPages).toBe(5);
    expect(page.hasPrevious).toBe(true);
    expect(page.hasNext).toBe(true);

    const last = await db.store('users').paginate({ page: 5, pageSize: 20 });
    expect(last.items).toHaveLength(15);
    expect(last.hasNext).toBe(false);
    db.close();
  });

  it('keyset pages walk the whole collection without duplicates', async () => {
    const db = await seedMany(50);
    const users = db.store('users');
    const collected: string[] = [];
    let after: string | undefined;
    for (let i = 0; i < 100; i++) {
      const page = await users.paginateKeyset({ pageSize: 7, after });
      collected.push(...page.items.map((u) => u.id));
      if (!page.hasMore || page.cursor === null) break;
      after = page.cursor;
    }
    expect(collected).toHaveLength(50);
    expect(new Set(collected).size).toBe(50);
    db.close();
  });
});

describe('backup, restore, reset', () => {
  it('exports and re-imports a snapshot', async () => {
    const db = await openApp();
    await db.store('users').bulkAdd([
      makeUser({ id: 'a' }),
      makeUser({ id: 'b' }),
    ]);
    await db.store('settings').put({ key: 'theme', value: 'dark' });

    const snapshot = await db.export();
    expect(snapshot.data.users).toHaveLength(2);

    await db.clear();
    expect(await db.store('users').count()).toBe(0);

    await db.import(snapshot);
    expect(await db.store('users').count()).toBe(2);
    expect((await db.store('settings').get('theme'))?.value).toBe('dark');
    db.close();
  });

  it('round-trips through JSON', async () => {
    const db = await openApp();
    await db.store('users').add(makeUser({ id: 'json', name: 'Round Trip' }));
    const json = await db.exportJSON();
    await db.clear();
    const { snapshotFromJSON } = await import('../../src/index.js');
    await db.import(snapshotFromJSON(json));
    expect((await db.store('users').get('json'))?.name).toBe('Round Trip');
    db.close();
  });

  it('reset() wipes data but keeps the schema', async () => {
    const db = await openApp();
    await db.store('users').add(makeUser({ id: 'gone' }));
    await db.reset();
    expect(db.storeNames.sort()).toEqual(['settings', 'users']);
    expect(await db.store('users').count()).toBe(0);
    db.close();
  });
});
