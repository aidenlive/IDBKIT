/**
 * @module query
 * A fluent, immutable query builder. Each operator returns a new builder, so
 * partial queries are safe to share and extend. Terminals choose the cheapest
 * execution path: a bare range with a limit uses `getAll`; anything with a
 * filter, offset, or reverse direction walks a cursor.
 */
import { walkCursor } from './cursor.js';
import { requestToPromise } from './internal/promisify.js';
import {
  buildRange,
  compoundPrefix,
  only as onlyRange,
  stringPrefix,
  type RangeBounds,
} from './internal/ranges.js';
import {
  keysetPage,
  offsetPage,
  type KeysetPageOptions,
  type KeysetPageResult,
  type OffsetPageOptions,
  type OffsetPageResult,
} from './pagination.js';
import type { StoreContext } from './internal/context.js';
import type {
  CursorDirection,
  IndexKey,
  Schema,
  StoreIndexName,
  StoreKey,
  StoreValue,
  ValidKey,
} from './types.js';

/** Predicate applied in memory after a record is read from the cursor. */
export type QueryFilter<V, K extends ValidKey = ValidKey, PK extends ValidKey = ValidKey> = (
  value: V,
  key: K,
  primaryKey: PK,
) => boolean;

interface QueryState<V> {
  index?: string;
  bounds: RangeBounds;
  exact?: ValidKey;
  prefix?: string;
  compound?: ValidKey[];
  direction: CursorDirection;
  limit?: number;
  offset: number;
  filters: QueryFilter<V>[];
  mapper?: (value: unknown) => unknown;
}

function cloneState<V>(state: QueryState<V>): QueryState<V> {
  return {
    ...state,
    bounds: { ...state.bounds },
    filters: [...state.filters],
  };
}

/**
 * Build and execute read queries against a store or one of its indexes.
 * Construct one via {@link Store.query}; never instantiate directly.
 *
 * @typeParam T - The emitted item type (changes after {@link QueryBuilder.map}).
 * @typeParam KQ - The key type accepted by range operators for the active source.
 */
export class QueryBuilder<
  S extends Schema,
  Name extends keyof S,
  T = StoreValue<S, Name>,
  KQ extends ValidKey = StoreKey<S, Name>,
> {
  /** @internal */
  constructor(
    private readonly ctx: StoreContext,
    private readonly state: QueryState<T>,
  ) {}

  private next<T2 = T, K2 extends ValidKey = KQ>(
    patch: Partial<QueryState<T2>>,
  ): QueryBuilder<S, Name, T2, K2> {
    const base = cloneState(this.state) as unknown as QueryState<T2>;
    return new QueryBuilder<S, Name, T2, K2>(this.ctx, { ...base, ...patch });
  }

  /** Query over a named index instead of the primary key. */
  index<IX extends StoreIndexName<S, Name>>(
    name: IX,
  ): QueryBuilder<S, Name, T, IndexKey<S, Name, IX>> {
    return this.next<T, IndexKey<S, Name, IX>>({ index: name });
  }

  /** Match records whose key equals `value`. */
  equals(value: KQ): QueryBuilder<S, Name, T, KQ> {
    return this.next({ exact: value, prefix: undefined, compound: undefined });
  }

  /** Match keys strictly greater than `value`. */
  above(value: KQ): QueryBuilder<S, Name, T, KQ> {
    return this.next({ bounds: { ...this.state.bounds, lower: value, lowerOpen: true } });
  }

  /** Match keys greater than or equal to `value`. */
  aboveOrEqual(value: KQ): QueryBuilder<S, Name, T, KQ> {
    return this.next({ bounds: { ...this.state.bounds, lower: value, lowerOpen: false } });
  }

  /** Match keys strictly less than `value`. */
  below(value: KQ): QueryBuilder<S, Name, T, KQ> {
    return this.next({ bounds: { ...this.state.bounds, upper: value, upperOpen: true } });
  }

  /** Match keys less than or equal to `value`. */
  belowOrEqual(value: KQ): QueryBuilder<S, Name, T, KQ> {
    return this.next({ bounds: { ...this.state.bounds, upper: value, upperOpen: false } });
  }

  /** Match keys within `[lower, upper]`. Bounds are inclusive unless opened. */
  between(
    lower: KQ,
    upper: KQ,
    options: { lowerOpen?: boolean; upperOpen?: boolean } = {},
  ): QueryBuilder<S, Name, T, KQ> {
    return this.next({
      bounds: {
        lower,
        upper,
        lowerOpen: options.lowerOpen ?? false,
        upperOpen: options.upperOpen ?? false,
      },
    });
  }

  /** Match string keys beginning with `prefix`. */
  startsWith(prefix: string): QueryBuilder<S, Name, T, KQ> {
    return this.next({ prefix, exact: undefined, compound: undefined });
  }

  /** Match compound keys whose leading segments equal `prefix`. */
  startsWithKeys(prefix: ValidKey[]): QueryBuilder<S, Name, T, KQ> {
    return this.next({ compound: prefix, exact: undefined, prefix: undefined });
  }

  /** Traverse in descending order. */
  reverse(): QueryBuilder<S, Name, T, KQ> {
    const reversed: CursorDirection =
      this.state.direction === 'next' ? 'prev' : 'next';
    return this.next({ direction: reversed });
  }

  /** Only emit distinct keys (skips duplicate index keys). */
  distinct(): QueryBuilder<S, Name, T, KQ> {
    const direction: CursorDirection =
      this.state.direction === 'prev' ? 'prevunique' : 'nextunique';
    return this.next({ direction });
  }

  /** Cap the number of emitted records. */
  limit(count: number): QueryBuilder<S, Name, T, KQ> {
    return this.next({ limit: count });
  }

  /** Skip the first `count` records of the (filtered) result. */
  offset(count: number): QueryBuilder<S, Name, T, KQ> {
    return this.next({ offset: count });
  }

  /** Keep only records matching `predicate` (evaluated in memory). */
  filter(predicate: QueryFilter<T>): QueryBuilder<S, Name, T, KQ> {
    return this.next({ filters: [...this.state.filters, predicate] });
  }

  /** Transform each emitted record. */
  map<U>(transform: (value: T) => U): QueryBuilder<S, Name, U, KQ> {
    return this.next<U>({ mapper: transform as (value: unknown) => unknown });
  }

  private resolveRange(): IDBKeyRange | null {
    if (this.state.exact !== undefined) return onlyRange(this.state.exact);
    if (this.state.prefix !== undefined) return stringPrefix(this.state.prefix);
    if (this.state.compound !== undefined) return compoundPrefix(this.state.compound);
    return buildRange(this.state.bounds);
  }

  private source(store: IDBObjectStore): IDBObjectStore | IDBIndex {
    return this.state.index ? store.index(this.state.index) : store;
  }

  private canFastPath(): boolean {
    return (
      this.state.filters.length === 0 &&
      this.state.offset === 0 &&
      (this.state.direction === 'next' || this.state.direction === 'nextunique')
    );
  }

  /** Execute and return all matching records (after any `map`). */
  toArray(): Promise<T[]> {
    const range = this.resolveRange();
    return this.ctx.run('readonly', async (store) => {
      const source = this.source(store);
      if (this.canFastPath()) {
        const raw = await requestToPromise<unknown[]>(
          source.getAll(range ?? undefined, this.state.limit),
          'Query getAll',
        );
        return (this.state.mapper ? raw.map(this.state.mapper) : raw) as T[];
      }
      return this.collect<T>(source, range, (step) =>
        this.state.mapper ? (this.state.mapper(step.value) as T) : (step.value as T),
      );
    });
  }

  /** Execute and return the first matching record, or `undefined`. */
  async first(): Promise<T | undefined> {
    const limited = this.limit(1);
    const [item] = await limited.toArray();
    return item;
  }

  /** Execute and return the last matching record, or `undefined`. */
  async last(): Promise<T | undefined> {
    const [item] = await this.reverse().limit(1).toArray();
    return item;
  }

  /** Count matching records (ignores `limit`/`offset`, honors `filter`). */
  count(): Promise<number> {
    const range = this.resolveRange();
    return this.ctx.run('readonly', async (store) => {
      const source = this.source(store);
      if (this.state.filters.length === 0) {
        return requestToPromise<number>(
          source.count(range ?? undefined),
          'Query count',
        );
      }
      let total = 0;
      await walkCursor<T>(source, { query: range, direction: this.state.direction }, (step) => {
        if (this.matches(step.value, step.key, step.primaryKey)) total += 1;
        return undefined;
      });
      return total;
    });
  }

  /** Return the cursor keys (index keys when an index is active). */
  keys(): Promise<ValidKey[]> {
    const range = this.resolveRange();
    return this.ctx.run('readonly', (store) =>
      this.collect<ValidKey>(this.source(store), range, (step) => step.key),
    );
  }

  /** Return the primary keys of matching records. */
  primaryKeys(): Promise<Array<StoreKey<S, Name>>> {
    const range = this.resolveRange();
    return this.ctx.run('readonly', (store) =>
      this.collect<StoreKey<S, Name>>(
        this.source(store),
        range,
        (step) => step.primaryKey as StoreKey<S, Name>,
      ),
    );
  }

  /** Invoke `callback` for each matching record, in order. */
  forEach(callback: (value: T, primaryKey: StoreKey<S, Name>) => void): Promise<void> {
    const range = this.resolveRange();
    return this.ctx
      .run('readonly', async (store) => {
        await this.collect<void>(this.source(store), range, (step) => {
          callback(
            this.state.mapper ? (this.state.mapper(step.value) as T) : (step.value as T),
            step.primaryKey as StoreKey<S, Name>,
          );
          return undefined as unknown as void;
        });
      })
      .then(() => undefined);
  }

  /** Delete every record matching the range and filters. Returns the count deleted. */
  delete(): Promise<number> {
    const range = this.resolveRange();
    return this.ctx.run('readwrite', async (store) => {
      const source = this.source(store);
      let deleted = 0;
      await walkCursor<T>(
        source,
        { query: range, direction: this.state.direction },
        (step) => {
          if (this.matches(step.value, step.key, step.primaryKey)) {
            deleted += 1;
            return { delete: true };
          }
          return undefined;
        },
        'Query delete',
      );
      return deleted;
    });
  }

  /** Offset-paginate within this query's range, index, and direction. */
  paginate(
    options: Pick<OffsetPageOptions, 'page' | 'pageSize'>,
  ): Promise<OffsetPageResult<T>> {
    return offsetPage<T>(this.ctx, {
      ...options,
      index: this.state.index,
      range: this.resolveRange(),
      direction: this.state.direction,
    });
  }

  /** Keyset-paginate within this query's range, index, and direction. */
  paginateKeyset(
    options: Pick<KeysetPageOptions<KQ>, 'pageSize' | 'after'>,
  ): Promise<KeysetPageResult<T, KQ>> {
    return keysetPage<T, KQ>(this.ctx, {
      ...options,
      index: this.state.index,
      range: this.resolveRange(),
      direction: this.state.direction,
    });
  }

  private matches(value: T, key: ValidKey, primaryKey: ValidKey): boolean {
    return this.state.filters.every((f) => f(value, key, primaryKey));
  }

  private async collect<R>(
    source: IDBObjectStore | IDBIndex,
    range: IDBKeyRange | null,
    project: (step: { value: unknown; key: ValidKey; primaryKey: ValidKey }) => R,
  ): Promise<R[]> {
    const out: R[] = [];
    const hasFilter = this.state.filters.length > 0;
    let skipped = 0;
    let taken = 0;

    await walkCursor(
      source,
      {
        query: range,
        direction: this.state.direction,
        // Native offset is only valid when no filter changes the sequence.
        offset: hasFilter ? 0 : this.state.offset,
      },
      (step) => {
        if (hasFilter && !this.matches(step.value as T, step.key, step.primaryKey)) {
          return undefined;
        }
        if (hasFilter && skipped < this.state.offset) {
          skipped += 1;
          return undefined;
        }
        out.push(project(step));
        taken += 1;
        if (this.state.limit !== undefined && taken >= this.state.limit) {
          return { stop: true };
        }
        return undefined;
      },
    );

    return out;
  }
}

/** @internal Build a fresh query for a store. */
export function createQuery<S extends Schema, Name extends keyof S>(
  ctx: StoreContext,
): QueryBuilder<S, Name> {
  return new QueryBuilder<S, Name>(ctx, {
    bounds: {},
    direction: 'next',
    offset: 0,
    filters: [],
  });
}
