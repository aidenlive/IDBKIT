/**
 * @module pagination
 * Two pagination strategies. Offset pages are simple and give you totals, but
 * cost grows with the page number. Keyset (cursor) pages stay O(pageSize) no
 * matter how deep you scroll — prefer them for large collections.
 */
import { walkCursor } from './cursor.js';
import { requestToPromise } from './internal/promisify.js';
import { ValidationError } from './errors.js';
import type { StoreContext } from './internal/context.js';
import type { CursorDirection, ValidKey } from './types.js';

/** Options for {@link offsetPage}. */
export interface OffsetPageOptions {
  /** 1-based page number. */
  page: number;
  /** Records per page. */
  pageSize: number;
  /** Paginate over an index instead of the primary key. */
  index?: string;
  /** Restrict to a range. */
  range?: IDBKeyRange | null;
  /** Traversal direction. Defaults to `'next'`. */
  direction?: CursorDirection;
}

/** A page produced by {@link offsetPage}. */
export interface OffsetPageResult<V> {
  /** Records on this page. */
  items: V[];
  /** Echoed 1-based page number. */
  page: number;
  /** Echoed page size. */
  pageSize: number;
  /** Total matching records across all pages. */
  total: number;
  /** Total number of pages. */
  totalPages: number;
  /** Whether a previous page exists. */
  hasPrevious: boolean;
  /** Whether a next page exists. */
  hasNext: boolean;
}

/** Options for {@link keysetPage}. */
export interface KeysetPageOptions<K extends ValidKey = ValidKey> {
  /** Records per page. */
  pageSize: number;
  /** Paginate over an index instead of the primary key. */
  index?: string;
  /**
   * Exclusive starting key. Pass the `cursor` from the previous page to get the
   * next one. Omit for the first page.
   */
  after?: K;
  /** Traversal direction. `'next'` ascends, `'prev'` descends. Defaults to `'next'`. */
  direction?: CursorDirection;
  /** Base range to stay within. The `after` bound overrides the matching side. */
  range?: IDBKeyRange | null;
}

/** A page produced by {@link keysetPage}. */
export interface KeysetPageResult<V, K extends ValidKey = ValidKey> {
  /** Records on this page. */
  items: V[];
  /** Key to pass as `after` for the next page, or `null` when exhausted. */
  cursor: K | null;
  /** Whether more records remain. */
  hasMore: boolean;
}

function getSource(
  store: IDBObjectStore,
  index?: string,
): IDBObjectStore | IDBIndex {
  return index ? store.index(index) : store;
}

/**
 * Fetch one offset-based page, including total counts. Runs in a single
 * read-only transaction so the count and the page are mutually consistent.
 */
export function offsetPage<V>(
  ctx: StoreContext,
  options: OffsetPageOptions,
): Promise<OffsetPageResult<V>> {
  const { page, pageSize, index, range = null, direction = 'next' } = options;
  if (!Number.isInteger(page) || page < 1) {
    throw new ValidationError('page must be a positive integer');
  }
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new ValidationError('pageSize must be a positive integer');
  }

  return ctx.run('readonly', async (store) => {
    const source = getSource(store, index);
    const total = await requestToPromise(
      source.count(range ?? undefined),
      'Counting records for pagination',
    );
    const offset = (page - 1) * pageSize;
    const items: V[] = [];

    if (offset < total) {
      await walkCursor<V>(
        source,
        { query: range, direction, offset },
        (step) => {
          items.push(step.value);
          if (items.length >= pageSize) return { stop: true };
          return undefined;
        },
        'Offset pagination',
      );
    }

    const totalPages = Math.ceil(total / pageSize);
    return {
      items,
      page,
      pageSize,
      total,
      totalPages,
      hasPrevious: page > 1,
      hasNext: page < totalPages,
    };
  });
}

function deriveRange(
  base: IDBKeyRange | null,
  after: ValidKey | undefined,
  direction: CursorDirection,
): IDBKeyRange | null {
  if (after === undefined) return base;
  const ascending = direction === 'next' || direction === 'nextunique';

  if (!base) {
    return ascending
      ? IDBKeyRange.lowerBound(after, true)
      : IDBKeyRange.upperBound(after, true);
  }

  // Tighten the leading edge with `after`, keeping the trailing bound of base.
  if (ascending) {
    return IDBKeyRange.bound(
      after,
      base.upper,
      true,
      base.upperOpen ?? false,
    );
  }
  return IDBKeyRange.bound(base.lower, after, base.lowerOpen ?? false, true);
}

/**
 * Fetch one keyset (cursor) page. Stable and O(pageSize) for unique keys — for
 * a non-unique index, boundaries between duplicate keys may repeat or skip, so
 * paginate by a unique key (primary key or unique index) when exactness matters.
 */
export function keysetPage<V, K extends ValidKey = ValidKey>(
  ctx: StoreContext,
  options: KeysetPageOptions<K>,
): Promise<KeysetPageResult<V, K>> {
  const { pageSize, index, after, direction = 'next', range = null } = options;
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new ValidationError('pageSize must be a positive integer');
  }

  return ctx.run('readonly', async (store) => {
    const source = getSource(store, index);
    const effectiveRange = deriveRange(range, after, direction);
    const items: V[] = [];
    let cursor: K | null = null;
    let hasMore = false;

    await walkCursor<V, K>(
      source,
      { query: effectiveRange, direction },
      (step) => {
        if (items.length === pageSize) {
          // One past the page proves there's more; don't include it.
          hasMore = true;
          return { stop: true };
        }
        items.push(step.value);
        cursor = step.key;
        return undefined;
      },
      'Keyset pagination',
    );

    return { items, cursor: hasMore ? cursor : null, hasMore };
  });
}
