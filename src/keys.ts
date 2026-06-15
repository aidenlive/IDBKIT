/**
 * @module keys
 * Strategies for generating primary keys when you don't want IndexedDB's
 * auto-increment integers. All are dependency-free and run in any modern
 * browser or Node 18+.
 */
import { IDBKitError } from './errors.js';

/** A function that produces a fresh key on each call. */
export type KeyGenerator<T extends IDBValidKey = string> = () => T;

function getCrypto(): Crypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new IDBKitError(
      'Web Crypto is unavailable; cannot generate secure random keys.',
    );
  }
  return c;
}

/**
 * RFC 4122 v4 UUID. Uses the native `crypto.randomUUID` when present, falling
 * back to a `getRandomValues`-based implementation.
 *
 * @example
 * const id = uuid(); // "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
 */
export function uuid(): string {
  const c = getCrypto();
  if (typeof c.randomUUID === 'function') return c.randomUUID();

  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  // Per RFC 4122 §4.4: set version (4) and variant (10xx) bits.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let i = 0; i < 256; i++) hex.push((i + 0x100).toString(16).slice(1));
  const b = bytes;
  return (
    hex[b[0]!]! +
    hex[b[1]!]! +
    hex[b[2]!]! +
    hex[b[3]!]! +
    '-' +
    hex[b[4]!]! +
    hex[b[5]!]! +
    '-' +
    hex[b[6]!]! +
    hex[b[7]!]! +
    '-' +
    hex[b[8]!]! +
    hex[b[9]!]! +
    '-' +
    hex[b[10]!]! +
    hex[b[11]!]! +
    hex[b[12]!]! +
    hex[b[13]!]! +
    hex[b[14]!]! +
    hex[b[15]!]!
  );
}

// Crockford's base32 alphabet (no I, L, O, U) — lexicographically sortable.
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(now: number): string {
  let mod: number;
  let str = '';
  let time = now;
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    mod = time % 32;
    str = ENCODING[mod]! + str;
    time = (time - mod) / 32;
  }
  return str;
}

function randomChar(c: Crypto): string {
  const bytes = new Uint8Array(1);
  c.getRandomValues(bytes);
  // Reject values that would bias the modulo (>= 248 = 8 * 31).
  return ENCODING[bytes[0]! % 32]!;
}

let lastTime = 0;
let lastRandom: string[] = [];

function incrementRandom(chars: string[]): string[] {
  const out = [...chars];
  for (let i = out.length - 1; i >= 0; i--) {
    const index = ENCODING.indexOf(out[i]!);
    if (index < ENCODING.length - 1) {
      out[i] = ENCODING[index + 1]!;
      return out;
    }
    out[i] = ENCODING[0]!;
  }
  // Overflow within the same millisecond is astronomically unlikely.
  return out;
}

/**
 * A ULID: a 26-character, lexicographically sortable identifier with a
 * millisecond timestamp prefix. Monotonic within a millisecond, so keys
 * generated in a tight loop still sort in creation order.
 *
 * @param seedTime - Override the timestamp (mainly for tests).
 * @example
 * const id = ulid(); // "01ARZ3NDEKTSV4RRFFQ69G5FAV"
 */
export function ulid(seedTime?: number): string {
  const c = getCrypto();
  const now = seedTime ?? Date.now();

  if (now === lastTime) {
    lastRandom = incrementRandom(lastRandom);
  } else {
    lastTime = now;
    lastRandom = [];
    for (let i = 0; i < RANDOM_LEN; i++) lastRandom.push(randomChar(c));
  }

  return encodeTime(now) + lastRandom.join('');
}

/**
 * A sortable timestamp-based key: zero-padded epoch millis joined to a short
 * random suffix. Cheaper than a ULID and still collision-resistant for most
 * client-side workloads.
 *
 * @param suffixLength - Length of the random suffix. Defaults to `6`.
 */
export function timestampKey(suffixLength = 6): string {
  const c = getCrypto();
  const time = Date.now().toString().padStart(15, '0');
  let suffix = '';
  for (let i = 0; i < suffixLength; i++) {
    suffix += ENCODING[c.getRandomValues(new Uint8Array(1))[0]! % 32]!;
  }
  return `${time}-${suffix}`;
}

/**
 * An in-memory monotonic counter generator. Not persisted across reloads — use
 * it for ephemeral session keys, or seed it from your data on startup.
 *
 * @param start - First value to emit. Defaults to `1`.
 * @param prefix - Optional string prefix; when set, keys are strings.
 */
export function counter(start = 1, prefix?: string): KeyGenerator<number | string> {
  let next = start;
  return () => {
    const value = next++;
    return prefix === undefined ? value : `${prefix}${value}`;
  };
}

/**
 * Wrap any producing function as a {@link KeyGenerator}. A thin convenience so
 * custom strategies share the same type as the built-ins.
 */
export function createKeyGenerator<T extends IDBValidKey>(
  produce: () => T,
): KeyGenerator<T> {
  return produce;
}
