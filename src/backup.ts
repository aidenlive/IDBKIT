/**
 * @module backup
 * Snapshot, restore, and JSON import/export. These operate on a raw
 * `IDBDatabase` so they stay decoupled from the higher-level facade; the
 * {@link Database} class wires them to its own connection for convenience.
 *
 * A snapshot captures explicit keys only for out-of-line stores (where the key
 * lives outside the value). For in-line and auto-increment stores the key is
 * already part of the record, so it round-trips automatically.
 */
import { transactionToPromise, requestToPromise } from './internal/promisify.js';
import { IDBKitError } from './errors.js';
import type { DatabaseSnapshot, SnapshotRecord, ValidKey } from './types.js';

/** How an import reconciles incoming records with existing data. */
export type ImportMode = 'merge' | 'replace';

/** Options for {@link importSnapshot}. */
export interface ImportOptions {
  /** `'merge'` upserts incoming records; `'replace'` clears each store first. */
  mode?: ImportMode;
  /** Restrict the import to these stores (defaults to all present in both). */
  stores?: string[];
}

/**
 * Read every object store into a structured-clone-friendly snapshot.
 */
export async function exportSnapshot(idb: IDBDatabase): Promise<DatabaseSnapshot> {
  const names = Array.from(idb.objectStoreNames);
  const data: Record<string, SnapshotRecord[]> = {};

  if (names.length > 0) {
    const tx = idb.transaction(names, 'readonly');
    const done = transactionToPromise(tx, 'Export');
    await Promise.all(
      names.map(async (name) => {
        const store = tx.objectStore(name);
        const valuesPromise = requestToPromise<unknown[]>(
          store.getAll(),
          `Export "${name}" values`,
        );
        const keysPromise =
          store.keyPath === null
            ? requestToPromise<ValidKey[]>(
                store.getAllKeys() as IDBRequest<ValidKey[]>,
                `Export "${name}" keys`,
              )
            : null;
        const values = await valuesPromise;
        const keys = keysPromise ? await keysPromise : null;
        data[name] = values.map((value, i) =>
          keys ? { key: keys[i], value } : { value },
        );
      }),
    );
    await done;
  }

  return {
    name: idb.name,
    version: idb.version,
    exportedAt: new Date().toISOString(),
    data,
  };
}

/** Alias of {@link exportSnapshot} for readability at call sites. */
export const backup = exportSnapshot;

/**
 * Write a snapshot back into the database. Atomic: if any write fails the whole
 * import rolls back.
 */
export async function importSnapshot(
  idb: IDBDatabase,
  snapshot: DatabaseSnapshot,
  options: ImportOptions = {},
): Promise<void> {
  const mode = options.mode ?? 'merge';
  const candidates = options.stores ?? Object.keys(snapshot.data);
  const targets = candidates.filter((name) => idb.objectStoreNames.contains(name));
  if (targets.length === 0) return;

  const tx = idb.transaction(targets, 'readwrite');
  const done = transactionToPromise(tx, 'Import');

  for (const name of targets) {
    const store = tx.objectStore(name);
    if (mode === 'replace') store.clear();
    const records = snapshot.data[name] ?? [];
    const outOfLine = store.keyPath === null;
    for (const record of records) {
      if (outOfLine && record.key !== undefined) {
        store.put(record.value, record.key);
      } else {
        store.put(record.value);
      }
    }
  }

  await done;
}

/**
 * Replace the database's contents with a snapshot (clear then import).
 */
export function restore(
  idb: IDBDatabase,
  snapshot: DatabaseSnapshot,
  stores?: string[],
): Promise<void> {
  return importSnapshot(idb, snapshot, { mode: 'replace', stores });
}

/** Empty the given stores (or all stores) in a single transaction. */
export function clearStores(idb: IDBDatabase, stores?: string[]): Promise<void> {
  const targets = stores ?? Array.from(idb.objectStoreNames);
  if (targets.length === 0) return Promise.resolve();
  const tx = idb.transaction(targets, 'readwrite');
  const done = transactionToPromise(tx, 'Clear');
  for (const name of targets) tx.objectStore(name).clear();
  return done;
}

/** Serialize a snapshot to a JSON string. */
export function snapshotToJSON(snapshot: DatabaseSnapshot, pretty = false): string {
  return JSON.stringify(snapshot, null, pretty ? 2 : undefined);
}

/** Parse a snapshot from a JSON string, with a light shape check. */
export function snapshotFromJSON(json: string): DatabaseSnapshot {
  const parsed = JSON.parse(json) as DatabaseSnapshot;
  if (!parsed || typeof parsed !== 'object' || typeof parsed.data !== 'object') {
    throw new IDBKitError('Invalid snapshot JSON: missing "data" map');
  }
  return parsed;
}

/**
 * Browser helper: export a snapshot and trigger a file download. Requires a DOM.
 *
 * @returns The snapshot that was downloaded.
 */
export async function downloadBackup(
  idb: IDBDatabase,
  filename?: string,
): Promise<DatabaseSnapshot> {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new IDBKitError('downloadBackup requires a browser environment');
  }
  const snapshot = await exportSnapshot(idb);
  const blob = new Blob([snapshotToJSON(snapshot, true)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename ?? `${snapshot.name}-${Date.now()}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return snapshot;
}
