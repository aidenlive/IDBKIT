/**
 * Example: User management
 * -------------------------
 * CRUD over a `users` store with a unique email index, name search, and paged
 * listing. Run with `tsx examples/user-management/index.ts` (after `npm i`), or
 * adapt the calls into your app.
 */
import {
  openDatabase,
  uuid,
  ConstraintError,
  type Database,
  type Schema,
} from 'idbkit';

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: number;
}

interface UserDB extends Schema {
  users: {
    key: string;
    value: User;
    indexes: {
      byEmail: string; // unique
      byName: string; // for prefix search & sorting
      byCreatedAt: number;
    };
  };
}

export async function openUserDB(name = 'example-users'): Promise<Database<UserDB>> {
  return openDatabase<UserDB>({
    name,
    version: 1,
    stores: {
      users: {
        keyPath: 'id',
        indexes: {
          byEmail: { keyPath: 'email', unique: true },
          byName: { keyPath: 'name' },
          byCreatedAt: { keyPath: 'createdAt' },
        },
      },
    },
  });
}

/** Create a user, surfacing a friendly error when the email is taken. */
export async function createUser(
  db: Database<UserDB>,
  input: { name: string; email: string },
): Promise<User> {
  const user: User = {
    id: uuid(),
    name: input.name,
    email: input.email.toLowerCase(),
    createdAt: Date.now(),
  };
  try {
    await db.store('users').add(user);
    return user;
  } catch (err) {
    if (err instanceof ConstraintError) {
      throw new Error(`Email already registered: ${input.email}`);
    }
    throw err;
  }
}

/** Look up a user by their (unique) email. */
export function findByEmail(db: Database<UserDB>, email: string): Promise<User | undefined> {
  return db.store('users').index('byEmail').get(email.toLowerCase());
}

/** Partial-update a user atomically. */
export function updateUser(
  db: Database<UserDB>,
  id: string,
  patch: Partial<Omit<User, 'id'>>,
): Promise<User | undefined> {
  return db.store('users').update(id, (current) =>
    current ? { ...current, ...patch } : undefined,
  );
}

export function deleteUser(db: Database<UserDB>, id: string): Promise<void> {
  return db.store('users').delete(id);
}

/** Case-insensitive name prefix search (uses the byName index range). */
export function searchByNamePrefix(db: Database<UserDB>, prefix: string): Promise<User[]> {
  return db.store('users').query().index('byName').startsWith(prefix).toArray();
}

/** A page of users, newest first, with totals for building a pager. */
export function listUsers(db: Database<UserDB>, page: number, pageSize = 10) {
  return db.store('users').query().index('byCreatedAt').reverse().paginate({ page, pageSize });
}

// Demo when run directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const run = async () => {
    const db = await openUserDB(`example-users-${uuid()}`);
    await createUser(db, { name: 'Ada Lovelace', email: 'ada@example.com' });
    await createUser(db, { name: 'Alan Turing', email: 'alan@example.com' });
    await createUser(db, { name: 'Grace Hopper', email: 'grace@example.com' });

    console.log('Find by email:', await findByEmail(db, 'alan@example.com'));
    console.log('Search "A":', (await searchByNamePrefix(db, 'A')).map((u) => u.name));

    try {
      await createUser(db, { name: 'Imposter', email: 'ada@example.com' });
    } catch (e) {
      console.log('Duplicate rejected:', (e as Error).message);
    }

    const page = await listUsers(db, 1, 2);
    console.log(`Page 1 of ${page.totalPages} (total ${page.total}):`, page.items.map((u) => u.name));

    await db.delete();
  };
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
