/**
 * @module cursor
 * Cursor traversal. The walker uses a synchronous callback that returns a
 * directive, rather than an async callback, on purpose: awaiting unrelated
 * promises mid-cursor would let the surrounding transaction auto-commit. Do
 * per-record async work *after* collecting, not during the walk.
 */
import { toIDBKitError } from './errors.js';
import type { CursorDirection, ValidKey } from './types.js';

/** One record visited during a cursor walk. */
export interface CursorStep<V, K extends ValidKey, PK extends ValidKey> {
  /** The record's value. */
  value: V;
  /** The cursor key — the index key when iterating an index, else the primary key. */
  key: K;
  /** The record's primary key. */
  primaryKey: PK;
  /** Zero-based position within the (post-offset) result sequence. */
  index: number;
}

/** Returned from a cursor callback to control the walk. */
export interface CursorDirective {
  /** Stop after the current record. */
  stop?: boolean;
  /** Delete the current record. */
  delete?: boolean;
  /** Replace the current record's value. */
  update?: unknown;
  /** Skip ahead this many records before the next callback (minimum 1). */
  advance?: number;
}

/** Options for {@link walkCursor}. */
export interface WalkOptions {
  /** Restrict the walk to this range. */
  query?: IDBKeyRange | null;
  /** Traversal direction. Defaults to `'next'`. */
  direction?: CursorDirection;
  /** Skip this many leading records (uses native `advance` for efficiency). */
  offset?: number;
}

/**
 * Walk a cursor over a store or index, invoking `onRecord` for each step.
 *
 * @param source - The object store or index to traverse.
 * @param options - Range, direction, and offset.
 * @param onRecord - Synchronous callback returning an optional {@link CursorDirective}.
 * @param context - Label used in error messages.
 */
export function walkCursor<
  V = unknown,
  K extends ValidKey = ValidKey,
  PK extends ValidKey = ValidKey,
>(
  source: IDBObjectStore | IDBIndex,
  options: WalkOptions,
  onRecord: (step: CursorStep<V, K, PK>) => CursorDirective | void,
  context = 'Cursor iteration',
): Promise<void> {
  const { query = null, direction = 'next', offset = 0 } = options;

  return new Promise<void>((resolve, reject) => {
    let request: IDBRequest<IDBCursorWithValue | null>;
    try {
      request = source.openCursor(query ?? undefined, direction);
    } catch (error) {
      reject(toIDBKitError(error, context));
      return;
    }

    let toSkip = offset;
    let position = 0;

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }

      if (toSkip > 0) {
        const skip = toSkip;
        toSkip = 0;
        try {
          cursor.advance(skip);
        } catch (error) {
          reject(toIDBKitError(error, context));
        }
        return;
      }

      let directive: CursorDirective | void;
      try {
        directive = onRecord({
          value: cursor.value as V,
          key: cursor.key as K,
          primaryKey: cursor.primaryKey as PK,
          index: position,
        });
      } catch (error) {
        reject(toIDBKitError(error, context));
        return;
      }
      position += 1;

      if (directive?.delete) {
        const req = cursor.delete();
        req.onerror = () =>
          reject(toIDBKitError(req.error, `${context}: delete failed`));
      } else if (directive?.update !== undefined) {
        const req = cursor.update(directive.update);
        req.onerror = () =>
          reject(toIDBKitError(req.error, `${context}: update failed`));
      }

      if (directive?.stop) {
        resolve();
        return;
      }

      try {
        const step = directive?.advance;
        if (step && step > 1) cursor.advance(step);
        else cursor.continue();
      } catch (error) {
        reject(toIDBKitError(error, context));
      }
    };

    request.onerror = () => reject(toIDBKitError(request.error, context));
  });
}
