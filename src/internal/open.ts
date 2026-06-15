/**
 * @module internal/open
 * The low-level `open` routine. It owns the `upgradeneeded` lifecycle:
 * reconciling the live schema against the requested config, then running any
 * versioned data migrations inside the same `versionchange` transaction.
 */
import {
  BlockedError,
  DatabaseError,
  MigrationError,
  toIDBKitError,
} from '../errors.js';
import type {
  DatabaseConfig,
  IndexConfig,
  MigrationOptions,
  StoreConfig,
} from '../types.js';

interface OpenResult {
  database: IDBDatabase;
}

function getIndexedDB(): IDBFactory {
  if (typeof indexedDB === 'undefined' || indexedDB === null) {
    throw new DatabaseError(
      'IndexedDB is not available in this environment. ' +
        'It requires a browser context (or a polyfill such as fake-indexeddb).',
    );
  }
  return indexedDB;
}

function keyPathsEqual(
  a: string | string[] | null | undefined,
  b: string | string[] | null,
): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((part, i) => part === b[i]);
  }
  return a === b;
}

function reconcileIndexes(
  store: IDBObjectStore,
  indexes: Record<string, IndexConfig>,
  options: MigrationOptions,
): void {
  const desiredNames = new Set(Object.keys(indexes));
  const recreate = options.recreateChangedIndexes ?? true;

  for (const [name, config] of Object.entries(indexes)) {
    const exists = store.indexNames.contains(name);
    if (!exists) {
      store.createIndex(name, config.keyPath, {
        unique: config.unique ?? false,
        multiEntry: config.multiEntry ?? false,
      });
      continue;
    }

    if (!recreate) continue;
    const live = store.index(name);
    const changed =
      !keyPathsEqual(config.keyPath, live.keyPath as string | string[]) ||
      (config.unique ?? false) !== live.unique ||
      (config.multiEntry ?? false) !== live.multiEntry;
    if (changed) {
      store.deleteIndex(name);
      store.createIndex(name, config.keyPath, {
        unique: config.unique ?? false,
        multiEntry: config.multiEntry ?? false,
      });
    }
  }

  if (options.dropMissingIndexes) {
    for (const name of Array.from(store.indexNames)) {
      if (!desiredNames.has(name)) store.deleteIndex(name);
    }
  }
}

function reconcileSchema(
  database: IDBDatabase,
  tx: IDBTransaction,
  stores: Record<string, StoreConfig>,
  options: MigrationOptions,
): void {
  for (const [name, config] of Object.entries(stores)) {
    let store: IDBObjectStore;
    if (!database.objectStoreNames.contains(name)) {
      store = database.createObjectStore(name, {
        keyPath: config.keyPath ?? undefined,
        autoIncrement: config.autoIncrement ?? false,
      });
    } else {
      store = tx.objectStore(name);
      // IndexedDB forbids changing keyPath/autoIncrement of an existing store.
      // Surface a clear error instead of silently ignoring the mismatch.
      if (
        config.keyPath !== undefined &&
        !keyPathsEqual(config.keyPath, store.keyPath as string | string[] | null)
      ) {
        throw new MigrationError(
          `Cannot change keyPath of existing store "${name}". ` +
            'Recreate the store in a migration if you must alter its key.',
        );
      }
    }
    reconcileIndexes(store, config.indexes ?? {}, options);
  }

  if (options.dropMissingStores) {
    for (const name of Array.from(database.objectStoreNames)) {
      if (!(name in stores)) database.deleteObjectStore(name);
    }
  }
}

/**
 * Open (and upgrade, if needed) an IndexedDB database according to `config`.
 *
 * @returns The opened connection.
 * @throws {DatabaseError} If IndexedDB is unavailable or the open fails.
 * @throws {BlockedError} If the upgrade is blocked and no `onBlocked` handler
 *   resolves the situation.
 * @throws {MigrationError} If schema reconciliation or a migration throws.
 */
export function open(config: DatabaseConfig): Promise<OpenResult> {
  const factory = getIndexedDB();
  const version = config.version ?? 1;
  const options = config.migrationOptions ?? {};

  return new Promise<OpenResult>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(config.name, version);
    } catch (error) {
      reject(toIDBKitError(error, `Failed to open database "${config.name}"`));
      return;
    }

    // Surfaces from within `upgradeneeded` so we can fail the open cleanly.
    let upgradeError: unknown = null;

    request.onupgradeneeded = (event) => {
      const database = request.result;
      const tx = request.transaction;
      if (!tx) {
        upgradeError = new MigrationError('Upgrade transaction missing');
        return;
      }
      try {
        reconcileSchema(database, tx, config.stores, options);
        runMigrations(database, tx, event.oldVersion, version, config);
      } catch (error) {
        upgradeError = error;
        try {
          tx.abort();
        } catch {
          /* already aborting */
        }
      }
    };

    request.onsuccess = () => {
      if (upgradeError) {
        request.result.close();
        reject(
          upgradeError instanceof MigrationError
            ? upgradeError
            : toIDBKitError(upgradeError, 'Schema upgrade failed'),
        );
        return;
      }
      const database = request.result;
      // Default: step aside when another tab requests a newer version so the
      // user isn't stuck on a blocked upgrade.
      database.onversionchange = (event) => {
        if (config.onVersionChange) {
          config.onVersionChange(event as IDBVersionChangeEvent);
        } else {
          database.close();
        }
      };
      resolve({ database });
    };

    request.onerror = () => {
      if (upgradeError) {
        reject(
          upgradeError instanceof MigrationError
            ? upgradeError
            : toIDBKitError(upgradeError, 'Schema upgrade failed'),
        );
        return;
      }
      reject(
        toIDBKitError(request.error, `Failed to open database "${config.name}"`),
      );
    };

    request.onblocked = (event) => {
      if (config.onBlocked) {
        config.onBlocked(event as IDBVersionChangeEvent);
      } else {
        reject(
          new BlockedError(
            `Opening "${config.name}" is blocked by another open connection. ` +
              'Close other tabs using this database, or provide an onBlocked handler.',
          ),
        );
      }
    };
  });
}

function runMigrations(
  database: IDBDatabase,
  tx: IDBTransaction,
  fromVersion: number,
  toVersion: number,
  config: DatabaseConfig,
): void {
  if (!config.migrations) return;
  const versions = Object.keys(config.migrations)
    .map(Number)
    .filter((v) => Number.isInteger(v) && v > fromVersion && v <= toVersion)
    .sort((a, b) => a - b);

  for (const v of versions) {
    const migration = config.migrations[v];
    if (!migration) continue;
    // Migrations must be synchronous (or await only IDB work). A returned
    // promise here would resolve after the transaction commits, so we run it
    // synchronously and rely on the version-change transaction's auto-commit.
    void migration({
      database,
      transaction: tx,
      fromVersion,
      toVersion,
    });
  }
}

/**
 * Delete a database by name.
 *
 * @throws {DatabaseError} If the delete fails.
 * @throws {BlockedError} If the delete is blocked by an open connection.
 */
export function deleteDatabaseByName(name: string): Promise<void> {
  const factory = getIndexedDB();
  return new Promise<void>((resolve, reject) => {
    const request = factory.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(toIDBKitError(request.error, `Failed to delete database "${name}"`));
    request.onblocked = () =>
      reject(
        new BlockedError(
          `Deleting "${name}" is blocked by an open connection. Close it first.`,
        ),
      );
  });
}
