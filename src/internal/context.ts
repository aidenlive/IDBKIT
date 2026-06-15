/**
 * @module internal/context
 * The execution context a store operates within. A database-bound context opens
 * a fresh auto-committing transaction per call; a transaction-bound context
 * reuses the caller's live transaction so multiple operations are atomic.
 */
import type { TransactionMode } from '../types.js';

/** Runs an operation against an object store in some transaction. */
export interface StoreContext {
  /** Name of the object store this context targets. */
  readonly storeName: string;
  /**
   * Execute `fn` against an object store. The `mode` is honored by
   * database-bound contexts; transaction-bound contexts reuse their existing
   * transaction and require it to already permit the requested mode.
   */
  run<T>(
    mode: TransactionMode,
    fn: (store: IDBObjectStore) => Promise<T> | T,
  ): Promise<T>;
}
