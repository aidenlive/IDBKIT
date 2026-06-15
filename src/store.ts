/**
 * @module store
 * The typed object-store facade. Each method either runs in its own
 * auto-committing transaction (when reached via `db.store(...)`) or joins the
 * caller's transaction (when reached via `db.transaction(...)`).
 */
import { walkCursor, type CursorDirective, type CursorStep } from './cursor.js';
import { requestToPromise } from './internal/promisify.js';
import {
  keysetPage,
  offsetPage,
  type KeysetPageOptions,
  type KeysetPageResult,
  type OffsetPageOptions,
  type OffsetPageResult,
} from './pagination.js';
import { createQuery, type QueryBuilder } from './query.js';
import { ValidationError } from './errors.js';
import type { StoreContext } from './internal/context.js';
import type {
  CursorDirection,
  IndexKey,
  Schema,
  StoreIndexName,
  StoreKey,
  StoreValue,
  TransactionMode,
  ValidKey,
} from './types.js';

/** A range or single key accepted by read operations. */
export type Query<K extends ValidKey> = K | IDBKeyRange | null;

/** Options for {@link Store.iterate}. */
export interface IterateOptions {
  /** Transaction mode. Use `'readwrite'` if the callback updates or deletes. */
  mode?: TransactionMode;
  /** Restrict iteration to a range. */
  query?: IDBKeyRange | null;
  /** Traversal direction. Defaults to `'next'`. */
  direction?: CursorDirection;
  /** Skip this many leading records. */
  offset?: number;
  /** Iterate a named index instead of the primary key. */
  index?: string;
}

/**
 * Typed access to a single index. Reach it via {@link Store.index}.
 */
export class Index<
  S extends Schema,
  Name extends keyof S,
  IX extends StoreIndexName<S, Name>,
> {
  /** @internal */
  constructor(
    private readonly ctx: StoreContext,
    private readonly indexName: IX,
  ) {}

  /** First record whose index key equals `value`. */
  get(value: IndexKey<S, Name, IX>): Promise<StoreValue<S, Name> | undefined> {
    return this.ctx.run('readonly', (store) =>
      requestToPromise(
        store.index(this.indexName).get(value),
        `Index "${String(this.indexName)}" get`,
      ),
    ) as Promise<StoreValue<S, Name> | undefined>;
  }

  /** All records matching `query` on this index. */
  getAll(
    query?: Query<IndexKey<S, Name, IX>>,
    count?: number,
  ): Promise<Array<StoreValue<S, Name>>> {
    return this.ctx.run('readonly', (store) =>
      requestToPromise(
        store.index(this.indexName).getAll(query ?? undefined, count),
        `Index "${String(this.indexName)}" getAll`,
      ),
    ) as Promise<Array<StoreValue<S, Name>>>;
  }

  /** Primary keys of records matching `query` on this index. */
  getAllKeys(
    query?: Query<IndexKey<S, Name, IX>>,
    count?: number,
  ): Promise<Array<StoreKey<S, Name>>> {
    return this.ctx.run('readonly', (store) =>
      requestToPromise(
        store.index(this.indexName).getAllKeys(query ?? undefined, count),
        `Index "${String(this.indexName)}" getAllKeys`,
      ),
    ) as Promise<Array<StoreKey<S, Name>>>;
  }

  /** Primary key of the first record matching `query`. */
  getKey(
    query: IndexKey<S, Name, IX> | IDBKeyRange,
  ): Promise<StoreKey<S, Name> | undefined> {
    return this.ctx.run('readonly', (store) =>
      requestToPromise(
        store.index(this.indexName).getKey(query),
        `Index "${String(this.indexName)}" getKey`,
      ),
    ) as Promise<StoreKey<S, Name> | undefined>;
  }

  /** Count records matching `query` on this index. */
  count(query?: Query<IndexKey<S, Name, IX>>): Promise<number> {
    return this.ctx.run('readonly', (store) =>
      requestToPromise(
        store.index(this.indexName).count(query ?? undefined),
        `Index "${String(this.indexName)}" count`,
      ),
    );
  }

  /** Start a fluent query scoped to this index. */
  query(): QueryBuilder<S, Name, StoreValue<S, Name>, IndexKey<S, Name, IX>> {
    return createQuery<S, Name>(this.ctx).index(this.indexName);
  }
}

/**
 * Typed access to an object store: CRUD, bulk writes, iteration, and queries.
 * Reach it via {@link Database.store} or, inside a transaction, the store
 * accessor passed to your callback.
 */
export class Store<S extends Schema, Name extends keyof S> {
  /** @internal */
  constructor(private readonly ctx: StoreContext) {}

  /** The store's name. */
  get name(): Name {
    return this.ctx.storeName as Name;
  }

  // ---- Reads -------------------------------------------------------------

  /** Get a single record by primary key, or `undefined` if absent. */
  get(key: StoreKey<S, Name>): Promise<StoreValue<S, Name> | undefined> {
    return this.ctx.run('readonly', (store) =>
      requestToPromise(store.get(key), `get from "${String(this.name)}"`),
    ) as Promise<StoreValue<S, Name> | undefined>;
  }

  /** Get many records by primary key in one transaction (order preserved). */
  getMany(
    keys: Array<StoreKey<S, Name>>,
  ): Promise<Array<StoreValue<S, Name> | undefined>> {
    return this.ctx.run('readonly', (store) =>
      Promise.all(
        keys.map((key) =>
          requestToPromise(store.get(key), `getMany from "${String(this.name)}"`),
        ),
      ),
    ) as Promise<Array<StoreValue<S, Name> | undefined>>;
  }

  /** Get all records, optionally limited to `query` and `count`. */
  getAll(
    query?: Query<StoreKey<S, Name>>,
    count?: number,
  ): Promise<Array<StoreValue<S, Name>>> {
    return this.ctx.run('readonly', (store) =>
      requestToPromise(
        store.getAll(query ?? undefined, count),
        `getAll from "${String(this.name)}"`,
      ),
    ) as Promise<Array<StoreValue<S, Name>>>;
  }

  /** Get all primary keys, optionally limited to `query` and `count`. */
  getAllKeys(
    query?: Query<StoreKey<S, Name>>,
    count?: number,
  ): Promise<Array<StoreKey<S, Name>>> {
    return this.ctx.run('readonly', (store) =>
      requestToPromise(
        store.getAllKeys(query ?? undefined, count),
        `getAllKeys from "${String(this.name)}"`,
      ),
    ) as Promise<Array<StoreKey<S, Name>>>;
  }

  /** Primary key of the first record matching `query`. */
  getKey(
    query: StoreKey<S, Name> | IDBKeyRange,
  ): Promise<StoreKey<S, Name> | undefined> {
    return this.ctx.run('readonly', (store) =>
      requestToPromise(
        store.getKey(query),
        `getKey from "${String(this.name)}"`,
      ),
    ) as Promise<StoreKey<S, Name> | undefined>;
  }

  /** Count records, optionally limited to `query`. */
  count(query?: Query<StoreKey<S, Name>>): Promise<number> {
    return this.ctx.run('readonly', (store) =>
      requestToPromise(
        store.count(query ?? undefined),
        `count "${String(this.name)}"`,
      ),
    );
  }

  /** True when a record exists for `key`. */
  async has(key: StoreKey<S, Name>): Promise<boolean> {
    const found = await this.getKey(key);
    return found !== undefined;
  }

  // ---- Writes ------------------------------------------------------------

  /**
   * Insert a record. Rejects with {@link ConstraintError} if the key already
   * exists. Returns the (possibly generated) key.
   */
  add(
    value: StoreValue<S, Name>,
    key?: StoreKey<S, Name>,
  ): Promise<StoreKey<S, Name>> {
    return this.ctx.run('readwrite', (store) =>
      requestToPromise(
        store.add(value, key),
        `add to "${String(this.name)}"`,
      ),
    ) as Promise<StoreKey<S, Name>>;
  }

  /** Insert or replace a record. Returns the key. */
  put(
    value: StoreValue<S, Name>,
    key?: StoreKey<S, Name>,
  ): Promise<StoreKey<S, Name>> {
    return this.ctx.run('readwrite', (store) =>
      requestToPromise(
        store.put(value, key),
        `put to "${String(this.name)}"`,
      ),
    ) as Promise<StoreKey<S, Name>>;
  }

  /**
   * Read-modify-write a record atomically. The updater receives the current
   * value (or `undefined`); return the new value, or `undefined` to delete.
   * Returns the stored value, or `undefined` if it was deleted.
   */
  update(
    key: StoreKey<S, Name>,
    updater: (current: StoreValue<S, Name> | undefined) => StoreValue<S, Name> | undefined,
  ): Promise<StoreValue<S, Name> | undefined> {
    return this.ctx.run('readwrite', async (store) => {
      const current = (await requestToPromise(
        store.get(key),
        `update get from "${String(this.name)}"`,
      )) as StoreValue<S, Name> | undefined;
      const updated = updater(current);
      if (updated === undefined) {
        await requestToPromise(
          store.delete(key),
          `update delete from "${String(this.name)}"`,
        );
        return undefined;
      }
      const outOfLine = store.keyPath === null;
      await requestToPromise(
        outOfLine ? store.put(updated, key) : store.put(updated),
        `update put to "${String(this.name)}"`,
      );
      return updated;
    });
  }

  /** Delete a record by primary key, or every record within a range. */
  delete(key: StoreKey<S, Name> | IDBKeyRange): Promise<void> {
    return this.ctx
      .run('readwrite', (store) =>
        requestToPromise(
          store.delete(key),
          `delete from "${String(this.name)}"`,
        ),
      )
      .then(() => undefined);
  }

  /** Remove every record in the store. */
  clear(): Promise<void> {
    return this.ctx
      .run('readwrite', (store) =>
        requestToPromise(store.clear(), `clear "${String(this.name)}"`),
      )
      .then(() => undefined);
  }

  // ---- Bulk --------------------------------------------------------------

  /**
   * Insert many records in one transaction. Either all succeed or all roll
   * back. Returns the generated keys, aligned to `values`.
   */
  bulkAdd(
    values: Array<StoreValue<S, Name>>,
    keys?: Array<StoreKey<S, Name>>,
  ): Promise<Array<StoreKey<S, Name>>> {
    if (keys && keys.length !== values.length) {
      throw new ValidationError('bulkAdd: keys length must match values length');
    }
    return this.ctx.run('readwrite', (store) =>
      Promise.all(
        values.map((value, i) =>
          requestToPromise(
            store.add(value, keys?.[i]),
            `bulkAdd to "${String(this.name)}"`,
          ),
        ),
      ),
    ) as Promise<Array<StoreKey<S, Name>>>;
  }

  /** Insert-or-replace many records in one transaction. Returns the keys. */
  bulkPut(
    values: Array<StoreValue<S, Name>>,
    keys?: Array<StoreKey<S, Name>>,
  ): Promise<Array<StoreKey<S, Name>>> {
    if (keys && keys.length !== values.length) {
      throw new ValidationError('bulkPut: keys length must match values length');
    }
    return this.ctx.run('readwrite', (store) =>
      Promise.all(
        values.map((value, i) =>
          requestToPromise(
            store.put(value, keys?.[i]),
            `bulkPut to "${String(this.name)}"`,
          ),
        ),
      ),
    ) as Promise<Array<StoreKey<S, Name>>>;
  }

  /** Delete many records by primary key in one transaction. */
  bulkDelete(keys: Array<StoreKey<S, Name>>): Promise<void> {
    return this.ctx
      .run('readwrite', (store) =>
        Promise.all(
          keys.map((key) =>
            requestToPromise(
              store.delete(key),
              `bulkDelete from "${String(this.name)}"`,
            ),
          ),
        ),
      )
      .then(() => undefined);
  }

  // ---- Iteration & queries ----------------------------------------------

  /**
   * Walk records with a cursor. The callback is synchronous and may return a
   * {@link CursorDirective} to stop, update, delete, or skip ahead. Set
   * `mode: 'readwrite'` if you intend to mutate.
   */
  iterate(
    callback: (
      step: CursorStep<StoreValue<S, Name>, ValidKey, StoreKey<S, Name>>,
    ) => CursorDirective | void,
    options: IterateOptions = {},
  ): Promise<void> {
    const mode = options.mode ?? 'readonly';
    return this.ctx.run(mode, (store) => {
      const source: IDBObjectStore | IDBIndex = options.index
        ? store.index(options.index)
        : store;
      return walkCursor<StoreValue<S, Name>, ValidKey, StoreKey<S, Name>>(
        source,
        {
          query: options.query ?? null,
          direction: options.direction ?? 'next',
          offset: options.offset ?? 0,
        },
        callback,
        `iterate "${String(this.name)}"`,
      );
    });
  }

  /** Start a fluent query over the primary key. */
  query(): QueryBuilder<S, Name> {
    return createQuery<S, Name>(this.ctx);
  }

  /** Typed access to a named index. */
  index<IX extends StoreIndexName<S, Name>>(name: IX): Index<S, Name, IX> {
    return new Index<S, Name, IX>(this.ctx, name);
  }

  /** Offset-paginate the store (or a named index). */
  paginate(
    options: OffsetPageOptions,
  ): Promise<OffsetPageResult<StoreValue<S, Name>>> {
    return offsetPage<StoreValue<S, Name>>(this.ctx, options);
  }

  /** Keyset-paginate the store (or a named index). Efficient at any depth. */
  paginateKeyset(
    options: KeysetPageOptions<StoreKey<S, Name>>,
  ): Promise<KeysetPageResult<StoreValue<S, Name>, StoreKey<S, Name>>> {
    return keysetPage<StoreValue<S, Name>, StoreKey<S, Name>>(this.ctx, options);
  }
}
