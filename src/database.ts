/**
 * @module database
 * The top-level entry point. {@link openDatabase} opens (and migrates) a
 * connection and hands back a {@link Database} you drive with typed stores and
 * transactions.
 */
import {
  backup as exportSnapshotRaw,
  clearStores,
  downloadBackup as downloadBackupRaw,
  importSnapshot,
  restore as restoreRaw,
  snapshotToJSON,
  type ImportOptions,
} from './backup.js';
import { open, deleteDatabaseByName } from './internal/open.js';
import { transactionToPromise } from './internal/promisify.js';
import { Store } from './store.js';
import { withRetry } from './retry.js';
import { toIDBKitError, ValidationError } from './errors.js';
import type { StoreContext } from './internal/context.js';
import type {
  DatabaseConfig,
  DatabaseSnapshot,
  Schema,
  TransactionMode,
} from './types.js';

/** The store accessor handed to a {@link Database.transaction} callback. */
export interface TransactionScope<S extends Schema> {
  /** Access a store bound to this transaction (must be in the transaction's scope). */
  store<Name extends keyof S>(name: Name): Store<S, Name>;
}

/** Extra options for {@link Database.transaction}. */
export interface TransactionRunOptions {
  /** Retry the whole transaction this many times on transient failures. */
  retries?: number;
}

function buildDbContext(getIdb: () => IDBDatabase, storeName: string): StoreContext {
  return {
    storeName,
    run<T>(
      mode: TransactionMode,
      fn: (store: IDBObjectStore) => Promise<T> | T,
    ): Promise<T> {
      const idb = getIdb();
      let tx: IDBTransaction;
      try {
        tx = idb.transaction([storeName], mode);
      } catch (error) {
        return Promise.reject(
          toIDBKitError(error, `Opening ${mode} transaction on "${storeName}"`),
        );
      }
      const done = transactionToPromise(tx, `Transaction on "${storeName}"`);
      const store = tx.objectStore(storeName);
      return (async () => {
        try {
          const result = await fn(store);
          await done;
          return result;
        } catch (error) {
          try {
            tx.abort();
          } catch {
            /* already settling */
          }
          void done.catch(() => undefined);
          throw error;
        }
      })();
    },
  };
}

function buildTxContext(tx: IDBTransaction, storeName: string): StoreContext {
  return {
    storeName,
    async run<T>(
      _mode: TransactionMode,
      fn: (store: IDBObjectStore) => Promise<T> | T,
    ): Promise<T> {
      // Reuse the caller's live transaction. Completion is awaited by the
      // transaction() wrapper, not here.
      const store = tx.objectStore(storeName);
      return fn(store);
    },
  };
}

/**
 * A typed handle to an open IndexedDB database.
 *
 * @typeParam S - Your {@link Schema}, mapping store names to key/value/index types.
 */
export class Database<S extends Schema> {
  private idb: IDBDatabase;
  private readonly config: DatabaseConfig;
  private closed = false;

  /** @internal Use {@link openDatabase} to construct. */
  constructor(idb: IDBDatabase, config: DatabaseConfig) {
    this.idb = idb;
    this.config = config;
  }

  /** The database name. */
  get name(): string {
    return this.idb.name;
  }

  /** The current schema version. */
  get version(): number {
    return this.idb.version;
  }

  /** The underlying native connection, for advanced/escape-hatch use. */
  get raw(): IDBDatabase {
    return this.idb;
  }

  /** Names of all object stores currently in the database. */
  get storeNames(): string[] {
    return Array.from(this.idb.objectStoreNames);
  }

  /** Get a typed store handle. Each operation runs in its own transaction. */
  store<Name extends keyof S>(name: Name): Store<S, Name> {
    return new Store<S, Name>(buildDbContext(() => this.idb, name as string));
  }

  /**
   * Run multiple operations in a single atomic transaction. The callback gets a
   * {@link TransactionScope}; await only IndexedDB-derived promises inside it,
   * or the transaction may commit early. Throwing aborts (rolls back) the
   * transaction.
   *
   * @example
   * await db.transaction(['accounts'], 'readwrite', async (tx) => {
   *   const accounts = tx.store('accounts');
   *   const from = await accounts.get('a');
   *   const to = await accounts.get('b');
   *   await accounts.put({ ...from, balance: from.balance - 10 });
   *   await accounts.put({ ...to, balance: to.balance + 10 });
   * });
   */
  transaction<T>(
    storeNames: Array<keyof S> | keyof S,
    mode: TransactionMode,
    callback: (scope: TransactionScope<S>) => Promise<T> | T,
    options: TransactionRunOptions = {},
  ): Promise<T> {
    const names = (Array.isArray(storeNames) ? storeNames : [storeNames]).map(
      (n) => n as string,
    );

    const exec = (): Promise<T> => {
      let tx: IDBTransaction;
      try {
        tx = this.idb.transaction(names, mode);
      } catch (error) {
        return Promise.reject(
          toIDBKitError(error, `Opening ${mode} transaction`),
        );
      }
      const done = transactionToPromise(tx, 'Transaction');
      const scope: TransactionScope<S> = {
        store: <Name extends keyof S>(name: Name) =>
          new Store<S, Name>(buildTxContext(tx, name as string)),
      };
      return (async () => {
        try {
          const result = await callback(scope);
          await done;
          return result;
        } catch (error) {
          try {
            tx.abort();
          } catch {
            /* already settling */
          }
          void done.catch(() => undefined);
          throw error;
        }
      })();
    };

    return options.retries ? withRetry(exec, { retries: options.retries }) : exec();
  }

  /** Close the connection. Idempotent. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.idb.close();
  }

  /** Close and delete the entire database from disk. */
  async delete(): Promise<void> {
    this.close();
    await deleteDatabaseByName(this.name);
  }

  /**
   * Delete all data and reopen a fresh database with the same schema. Returns
   * this same handle, now pointing at the new connection.
   */
  async reset(): Promise<this> {
    const name = this.name;
    this.idb.close();
    await deleteDatabaseByName(name);
    const { database } = await open(this.config);
    this.idb = database;
    this.closed = false;
    return this;
  }

  /** Snapshot the entire database into a serializable object. */
  export(): Promise<DatabaseSnapshot> {
    return exportSnapshotRaw(this.idb);
  }

  /** Snapshot the database and serialize it to a JSON string. */
  async exportJSON(pretty = false): Promise<string> {
    return snapshotToJSON(await this.export(), pretty);
  }

  /** Write a snapshot into the database (`'merge'` by default). */
  import(snapshot: DatabaseSnapshot, options?: ImportOptions): Promise<void> {
    return importSnapshot(this.idb, snapshot, options);
  }

  /** Replace the database's contents with a snapshot. */
  restore(snapshot: DatabaseSnapshot, stores?: string[]): Promise<void> {
    return restoreRaw(this.idb, snapshot, stores);
  }

  /** Empty the given stores, or all stores when omitted. */
  clear(stores?: Array<keyof S>): Promise<void> {
    return clearStores(this.idb, stores?.map((s) => s as string));
  }

  /** Browser helper: export and download a JSON backup. */
  downloadBackup(filename?: string): Promise<DatabaseSnapshot> {
    return downloadBackupRaw(this.idb, filename);
  }
}

function validateConfig(config: DatabaseConfig): void {
  if (!config.name || typeof config.name !== 'string') {
    throw new ValidationError('Database config requires a non-empty "name"');
  }
  if (
    config.version !== undefined &&
    (!Number.isInteger(config.version) || config.version < 1)
  ) {
    throw new ValidationError('Database "version" must be a positive integer');
  }
  if (!config.stores || typeof config.stores !== 'object') {
    throw new ValidationError('Database config requires a "stores" map');
  }
}

/**
 * Open (creating or upgrading as needed) an IndexedDB database.
 *
 * @typeParam S - Your {@link Schema} describing each store's key/value/indexes.
 * @param config - Name, version, stores, and optional migrations.
 * @returns A connected {@link Database}.
 *
 * @example
 * interface AppSchema extends Schema {
 *   todos: { key: string; value: Todo; indexes: { byDone: 'true' | 'false' } };
 * }
 * const db = await openDatabase<AppSchema>({
 *   name: 'tasks',
 *   version: 1,
 *   stores: { todos: { keyPath: 'id', indexes: { byDone: { keyPath: 'done' } } } },
 * });
 */
export function openDatabase<S extends Schema>(
  config: DatabaseConfig,
): Promise<Database<S>> {
  validateConfig(config);
  const exec = async (): Promise<Database<S>> => {
    const { database } = await open(config);
    return new Database<S>(database, config);
  };
  return config.retries ? withRetry(exec, { retries: config.retries }) : exec();
}
