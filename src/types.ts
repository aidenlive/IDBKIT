/**
 * @module types
 * Public type contracts for idbkit. Importing from here gives you the building
 * blocks to describe your database shape and get full inference on stores,
 * keys, indexes, and query results.
 */

/** Anything IndexedDB accepts as a key. */
export type ValidKey = IDBValidKey;

/** Cursor traversal direction (mirrors the native `IDBCursorDirection`). */
export type CursorDirection = 'next' | 'nextunique' | 'prev' | 'prevunique';

/** Transaction mode (mirrors the native `IDBTransactionMode`). */
export type TransactionMode = 'readonly' | 'readwrite';

/**
 * Describes a single store at the type level. Provide this through a
 * {@link Schema} so every operation on the store is correctly typed.
 *
 * @example
 * interface AppSchema extends Schema {
 *   users: {
 *     key: string;
 *     value: User;
 *     indexes: { byEmail: string; byNameAge: [string, number] };
 *   };
 * }
 */
export interface StoreSchema {
  /** The primary-key type for this store. */
  key: ValidKey;
  /** The record type stored in this store. */
  value: unknown;
  /** Optional map of index name to the type of that index's key. */
  indexes?: Record<string, ValidKey>;
}

/** A full database shape: a map of store name to {@link StoreSchema}. */
export interface Schema {
  [storeName: string]: StoreSchema;
}

/** Extract the value (record) type for a store. */
export type StoreValue<S extends Schema, Name extends keyof S> = S[Name]['value'];

/** Extract the primary-key type for a store. */
export type StoreKey<S extends Schema, Name extends keyof S> = S[Name]['key'];

/** Extract the index-name union for a store. */
export type StoreIndexName<S extends Schema, Name extends keyof S> =
  S[Name] extends { indexes: infer I } ? Extract<keyof I, string> : never;

/** Extract the key type of a named index. */
export type IndexKey<
  S extends Schema,
  Name extends keyof S,
  Index extends StoreIndexName<S, Name>,
> = S[Name] extends { indexes: infer I }
  ? Index extends keyof I
    ? I[Index] extends ValidKey
      ? I[Index]
      : ValidKey
    : ValidKey
  : ValidKey;

/**
 * Runtime description of an index, used during database upgrades to create it.
 */
export interface IndexConfig {
  /** Property path(s) the index is built on. An array creates a compound index. */
  keyPath: string | string[];
  /** Reject duplicate index keys when `true`. */
  unique?: boolean;
  /**
   * When `true` and `keyPath` points at an array property, create one index
   * entry per array element. Has no effect on compound (array `keyPath`) indexes.
   */
  multiEntry?: boolean;
}

/**
 * Runtime description of an object store, used during database upgrades.
 */
export interface StoreConfig {
  /**
   * Property path used as the in-line key. Use an array for a compound primary
   * key, or `null`/omit for out-of-line keys (supply keys explicitly on write).
   */
  keyPath?: string | string[] | null;
  /** Let IndexedDB generate monotonically increasing integer keys. */
  autoIncrement?: boolean;
  /** Indexes to create on this store, keyed by index name. */
  indexes?: Record<string, IndexConfig>;
}

/** A map of store name to its runtime {@link StoreConfig}. */
export type StoresConfig = Record<string, StoreConfig>;

/**
 * A data migration for a specific version. Runs inside the `versionchange`
 * transaction after the schema has been reconciled. Only synchronous work or
 * IndexedDB-derived promises may be awaited here — awaiting unrelated promises
 * will commit the transaction early.
 */
export type Migration = (context: MigrationContext) => void | Promise<void>;

/** Context handed to a {@link Migration}. */
export interface MigrationContext {
  /** The upgrading database connection. */
  database: IDBDatabase;
  /** The live `versionchange` transaction. */
  transaction: IDBTransaction;
  /** The version the database is upgrading from (0 on first creation). */
  fromVersion: number;
  /** The version the database is upgrading to. */
  toVersion: number;
}

/** Options controlling how schema reconciliation behaves during an upgrade. */
export interface MigrationOptions {
  /** Delete stores present in the database but absent from the config. */
  dropMissingStores?: boolean;
  /** Delete indexes present in a store but absent from its config. */
  dropMissingIndexes?: boolean;
  /**
   * Recreate an index when its definition (keyPath/unique/multiEntry) differs
   * from the live one. IndexedDB cannot mutate an index in place, so this drops
   * and rebuilds it. Defaults to `true`.
   */
  recreateChangedIndexes?: boolean;
}

/** Configuration passed to {@link openDatabase}. */
export interface DatabaseConfig {
  /** Database name. */
  name: string;
  /**
   * Schema version. Increment to trigger an upgrade. Must be a positive
   * integer. Defaults to `1`.
   */
  version?: number;
  /** Object stores and their indexes. */
  stores: StoresConfig;
  /** Per-version data migrations, keyed by the integer version they target. */
  migrations?: Record<number, Migration>;
  /** Schema-reconciliation behavior. */
  migrationOptions?: MigrationOptions;
  /**
   * Called when another connection is blocking this upgrade (an older version
   * is still open elsewhere). Use it to prompt the user to close other tabs.
   */
  onBlocked?: (event: IDBVersionChangeEvent) => void;
  /**
   * Called when this connection is blocking a newer version opened elsewhere.
   * The default behavior closes this connection so the upgrade can proceed.
   */
  onVersionChange?: (event: IDBVersionChangeEvent) => void;
  /** Number of times to retry a transient open failure. Defaults to `0`. */
  retries?: number;
}

/** A plain, structured-clone-friendly snapshot of a database. */
export interface DatabaseSnapshot {
  /** Database name at the time of export. */
  name: string;
  /** Database version at the time of export. */
  version: number;
  /** ISO timestamp of when the snapshot was produced. */
  exportedAt: string;
  /** Records per store: `{ [storeName]: Array<{ key?, value }> }`. */
  data: Record<string, SnapshotRecord[]>;
}

/** A single record within a {@link DatabaseSnapshot}. */
export interface SnapshotRecord {
  /** Present only for out-of-line keyed stores. */
  key?: ValidKey;
  /** The stored value. */
  value: unknown;
}
