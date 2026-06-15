/**
 * idbkit — a typed, promise-based IndexedDB toolkit.
 *
 * @packageDocumentation
 */

/** The installed idbkit version. */
export const VERSION = '1.0.0';

// ---- Core ----------------------------------------------------------------
export { openDatabase, Database } from './database.js';
export { Store, Index } from './store.js';
export { QueryBuilder } from './query.js';
export { walkCursor } from './cursor.js';
export { offsetPage, keysetPage } from './pagination.js';

// ---- Keys ----------------------------------------------------------------
export { uuid, ulid, timestampKey, counter, createKeyGenerator } from './keys.js';

// ---- Retry ---------------------------------------------------------------
export { withRetry } from './retry.js';

// ---- Backup / restore ----------------------------------------------------
export {
  exportSnapshot,
  backup,
  importSnapshot,
  restore,
  clearStores,
  snapshotToJSON,
  snapshotFromJSON,
  downloadBackup,
} from './backup.js';

// ---- Range helpers (handy with `iterate` and manual cursors) -------------
export { buildRange, only, stringPrefix, compoundPrefix } from './internal/ranges.js';

// ---- Errors --------------------------------------------------------------
export {
  IDBKitError,
  DatabaseError,
  TransactionError,
  ConstraintError,
  NotFoundError,
  MigrationError,
  QuotaError,
  BlockedError,
  TimeoutError,
  ValidationError,
  toIDBKitError,
  isRetryable,
} from './errors.js';

// ---- Types ---------------------------------------------------------------
export type {
  ValidKey,
  CursorDirection,
  TransactionMode,
  StoreSchema,
  Schema,
  StoreValue,
  StoreKey,
  StoreIndexName,
  IndexKey,
  IndexConfig,
  StoreConfig,
  StoresConfig,
  Migration,
  MigrationContext,
  MigrationOptions,
  DatabaseConfig,
  DatabaseSnapshot,
  SnapshotRecord,
} from './types.js';

export type { RetryOptions } from './retry.js';
export type { CursorStep, CursorDirective, WalkOptions } from './cursor.js';
export type { QueryFilter } from './query.js';
export type {
  OffsetPageOptions,
  OffsetPageResult,
  KeysetPageOptions,
  KeysetPageResult,
} from './pagination.js';
export type { Query, IterateOptions } from './store.js';
export type { TransactionScope, TransactionRunOptions } from './database.js';
export type { ImportMode, ImportOptions } from './backup.js';
export type { KeyGenerator } from './keys.js';
export type { RangeBounds } from './internal/ranges.js';
