/**
 * Directional microbenchmarks for idbkit.
 *
 * IMPORTANT: these run against `fake-indexeddb`, an in-memory Node polyfill, not
 * a real browser engine. The ABSOLUTE timings here are meaningless as a measure
 * of production performance. What they ARE good for is RELATIVE comparison —
 * showing that, say, bulk writes beat per-record writes, or that an indexed
 * query beats a full scan, by a wide margin. Those relationships hold in real
 * browsers; the milliseconds do not. Measure in your target browser for numbers
 * you intend to quote.
 *
 * Run with: npm run bench
 */
import 'fake-indexeddb/auto';
import { openDatabase, uuid, type Schema } from '../src/index.js';

interface Row {
  id: string;
  group: string;
  n: number;
  createdAt: number;
}

interface BenchDB extends Schema {
  rows: {
    key: string;
    value: Row;
    indexes: { byGroup: string; byCreatedAt: number };
  };
}

function makeRows(count: number): Row[] {
  const groups = ['alpha', 'beta', 'gamma', 'delta'];
  const base = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    id: uuid(),
    group: groups[i % groups.length],
    n: i,
    createdAt: base + i,
  }));
}

async function freshDB() {
  const db = await openDatabase<BenchDB>({
    name: `bench-${uuid()}`,
    version: 1,
    stores: {
      rows: {
        keyPath: 'id',
        indexes: {
          byGroup: { keyPath: 'group' },
          byCreatedAt: { keyPath: 'createdAt' },
        },
      },
    },
  });
  return db;
}

interface Result {
  name: string;
  ms: number;
  detail?: string;
}

async function time(name: string, fn: () => Promise<string | void>): Promise<Result> {
  const start = performance.now();
  const detail = await fn();
  const ms = performance.now() - start;
  return { name, ms, detail: detail ?? undefined };
}

function printGroup(title: string, results: Result[]): void {
  const width = Math.max(...results.map((r) => r.name.length));
  // eslint-disable-next-line no-console
  console.log(`\n${title}`);
  // eslint-disable-next-line no-console
  console.log('─'.repeat(title.length));
  for (const r of results) {
    const ms = `${r.ms.toFixed(1)}ms`.padStart(10);
    const detail = r.detail ? `  ${r.detail}` : '';
    // eslint-disable-next-line no-console
    console.log(`  ${r.name.padEnd(width)} ${ms}${detail}`);
  }
  if (results.length === 2) {
    const [a, b] = results;
    const faster = a.ms < b.ms ? a : b;
    const slower = a.ms < b.ms ? b : a;
    const ratio = slower.ms / Math.max(faster.ms, 0.0001);
    // eslint-disable-next-line no-console
    console.log(`  → ${faster.name} ~${ratio.toFixed(1)}x faster`);
  }
}

async function benchWrites(): Promise<void> {
  const COUNT = 10_000;
  const rows = makeRows(COUNT);

  const perRecord = await time('per-record add()', async () => {
    const db = await freshDB();
    const store = db.store('rows');
    for (const row of rows) await store.add(row);
    await db.delete();
    return `${COUNT.toLocaleString()} rows`;
  });

  const bulk = await time('bulkAdd()', async () => {
    const db = await freshDB();
    await db.store('rows').bulkAdd(rows);
    await db.delete();
    return `${COUNT.toLocaleString()} rows`;
  });

  printGroup(`Writes (${COUNT.toLocaleString()} rows)`, [perRecord, bulk]);
}

async function benchQueries(): Promise<void> {
  const COUNT = 20_000;
  const db = await freshDB();
  await db.store('rows').bulkAdd(makeRows(COUNT));

  const indexed = await time('indexed equals()', async () => {
    const found = await db.store('rows').query().index('byGroup').equals('alpha').toArray();
    return `${found.length.toLocaleString()} matched`;
  });

  const scan = await time('filter() full scan', async () => {
    const found = await db.store('rows').query().filter((r) => r.group === 'alpha').toArray();
    return `${found.length.toLocaleString()} matched`;
  });

  printGroup(`Query (${COUNT.toLocaleString()} rows, ~1/4 match)`, [indexed, scan]);

  await db.delete();
}

async function benchKeyGen(): Promise<void> {
  const COUNT = 100_000;
  const u = await time('uuid()', async () => {
    for (let i = 0; i < COUNT; i++) uuid();
    return `${COUNT.toLocaleString()} keys`;
  });
  const { ulid } = await import('../src/index.js');
  const ul = await time('ulid()', async () => {
    for (let i = 0; i < COUNT; i++) ulid();
    return `${COUNT.toLocaleString()} keys`;
  });
  printGroup(`Key generation (${COUNT.toLocaleString()} keys)`, [u, ul]);
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('idbkit microbenchmarks (fake-indexeddb — directional only)\n');
  // eslint-disable-next-line no-console
  console.log('Absolute numbers are NOT representative of real browsers.');
  await benchWrites();
  await benchQueries();
  await benchKeyGen();
  // eslint-disable-next-line no-console
  console.log('\nDone. Treat ratios as directional; measure in a real browser for production numbers.');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
