/**
 * Example: Offline cache (TTL + stale-while-revalidate)
 * -----------------------------------------------------
 * Cache API responses (or any async lookup) in IndexedDB so the app works
 * offline and avoids redundant network calls. Each entry has a fetched-at
 * timestamp; reads can return fresh data immediately, serve stale data while a
 * background refresh runs, or skip the cache when offline.
 */
import { openDatabase, type Database, type Schema } from 'idbkit';

interface CacheEntry<T = unknown> {
  key: string;
  value: T;
  fetchedAt: number;
  expiresAt: number;
}

interface CacheDB extends Schema {
  cache: {
    key: string;
    value: CacheEntry;
    indexes: { byExpiresAt: number };
  };
}

export interface CacheOptions {
  /** Time-to-live in milliseconds. Default 5 minutes. */
  ttl?: number;
  /** Serve stale data instantly and refresh in the background. Default true. */
  staleWhileRevalidate?: boolean;
}

export class OfflineCache {
  private constructor(
    private readonly db: Database<CacheDB>,
    private readonly defaultTtl: number,
  ) {}

  static async open(name = 'example-cache', defaultTtl = 5 * 60_000): Promise<OfflineCache> {
    const db = await openDatabase<CacheDB>({
      name,
      version: 1,
      stores: {
        cache: { keyPath: 'key', indexes: { byExpiresAt: { keyPath: 'expiresAt' } } },
      },
    });
    return new OfflineCache(db, defaultTtl);
  }

  /**
   * Return cached `key`, fetching with `loader` when missing or expired.
   *
   * - Fresh entry → returned immediately, no fetch.
   * - Expired entry + staleWhileRevalidate → stale value returned now, refreshed
   *   in the background.
   * - Missing/expired without SWR → awaits a fresh fetch.
   * - Loader throws (offline) but a stale entry exists → the stale value is
   *   served as a fallback.
   */
  async get<T>(key: string, loader: () => Promise<T>, options: CacheOptions = {}): Promise<T> {
    const ttl = options.ttl ?? this.defaultTtl;
    const swr = options.staleWhileRevalidate ?? true;
    const entry = (await this.db.store('cache').get(key)) as CacheEntry<T> | undefined;
    const now = Date.now();

    if (entry && entry.expiresAt > now) {
      return entry.value; // fresh
    }

    if (entry && swr) {
      // Serve stale immediately; refresh without blocking.
      void this.refresh(key, loader, ttl).catch(() => undefined);
      return entry.value;
    }

    try {
      return await this.refresh(key, loader, ttl);
    } catch (err) {
      if (entry) return entry.value; // offline fallback to stale
      throw err;
    }
  }

  /** Fetch and store a fresh value. */
  async refresh<T>(key: string, loader: () => Promise<T>, ttl = this.defaultTtl): Promise<T> {
    const value = await loader();
    const now = Date.now();
    await this.db.store('cache').put({ key, value, fetchedAt: now, expiresAt: now + ttl });
    return value;
  }

  /** Read a value only if present and fresh (no fetch). */
  async peek<T>(key: string): Promise<T | undefined> {
    const entry = (await this.db.store('cache').get(key)) as CacheEntry<T> | undefined;
    return entry && entry.expiresAt > Date.now() ? entry.value : undefined;
  }

  async invalidate(key: string): Promise<void> {
    await this.db.store('cache').delete(key);
  }

  /** Delete every entry whose expiry is in the past. Returns the count removed. */
  async evictExpired(): Promise<number> {
    return this.db
      .store('cache')
      .query()
      .index('byExpiresAt')
      .below(Date.now())
      .delete();
  }

  close(): void {
    this.db.close();
  }
}

// Demo when run directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  const run = async () => {
    const cache = await OfflineCache.open(`example-cache-${Date.now()}`, 50);
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return { now: Date.now(), call: calls };
    };

    console.log('first (fetch):', await cache.get('key', loader));
    console.log('second (cached):', await cache.get('key', loader));
    console.log('loader calls so far:', calls); // 1

    await new Promise((r) => setTimeout(r, 60)); // let it expire
    console.log('after TTL (stale-while-revalidate):', await cache.get('key', loader));
    await new Promise((r) => setTimeout(r, 10)); // let background refresh land
    console.log('loader calls after refresh:', calls); // 2

    console.log('evicted expired:', await cache.evictExpired());
    cache.close();
  };
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
