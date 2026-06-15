import { describe, it, expect, vi } from 'vitest';
import {
  buildRange,
  only,
  stringPrefix,
  compoundPrefix,
  uuid,
  ulid,
  timestampKey,
  counter,
  withRetry,
  toIDBKitError,
  isRetryable,
  ConstraintError,
  QuotaError,
  TransactionError,
  ValidationError,
} from '../../src/index.js';

describe('ranges', () => {
  it('returns null when unbounded', () => {
    expect(buildRange({})).toBeNull();
  });

  it('builds lower-only and upper-only bounds', () => {
    const lower = buildRange({ lower: 5 });
    expect(lower?.lower).toBe(5);
    expect(lower?.upper).toBeUndefined();

    const upper = buildRange({ upper: 10, upperOpen: true });
    expect(upper?.upper).toBe(10);
    expect(upper?.upperOpen).toBe(true);
  });

  it('builds a double-bounded range', () => {
    const range = buildRange({ lower: 1, upper: 9, lowerOpen: true });
    expect(range?.lower).toBe(1);
    expect(range?.upper).toBe(9);
    expect(range?.lowerOpen).toBe(true);
    expect(range?.upperOpen).toBe(false);
  });

  it('only() matches a single value', () => {
    const range = only('abc');
    expect(range.lower).toBe('abc');
    expect(range.upper).toBe('abc');
  });

  it('stringPrefix() spans the prefix', () => {
    const range = stringPrefix('user:');
    expect(range.lower).toBe('user:');
    expect(range.upper).toBe('user:\uffff');
  });

  it('stringPrefix() rejects non-strings', () => {
    // @ts-expect-error intentional misuse
    expect(() => stringPrefix(42)).toThrow(ValidationError);
  });

  it('compoundPrefix() builds an array-bounded range', () => {
    const range = compoundPrefix(['alice']);
    expect(Array.isArray(range.lower)).toBe(true);
    expect(range.upperOpen).toBe(true);
  });
});

describe('keys', () => {
  it('uuid() produces a v4 UUID', () => {
    const id = uuid();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('uuid() is unique across calls', () => {
    const set = new Set(Array.from({ length: 1000 }, () => uuid()));
    expect(set.size).toBe(1000);
  });

  it('ulid() is 26 chars of Crockford base32', () => {
    const id = ulid();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('ulid() sorts in creation order even within a millisecond', () => {
    const fixed = 1_700_000_000_000;
    const ids = Array.from({ length: 50 }, () => ulid(fixed));
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('timestampKey() is sortable by time', () => {
    const a = timestampKey();
    const b = timestampKey();
    expect(a <= b || a.slice(0, 15) <= b.slice(0, 15)).toBe(true);
  });

  it('counter() increments, optionally with a prefix', () => {
    const next = counter(1);
    expect(next()).toBe(1);
    expect(next()).toBe(2);

    const keyed = counter(10, 'k');
    expect(keyed()).toBe('k10');
    expect(keyed()).toBe('k11');
  });
});

describe('error mapping', () => {
  const dom = (name: string) =>
    typeof DOMException !== 'undefined'
      ? new DOMException('boom', name)
      : Object.assign(new Error('boom'), { name });

  it('maps ConstraintError', () => {
    expect(toIDBKitError(dom('ConstraintError'), 'x')).toBeInstanceOf(ConstraintError);
  });

  it('maps QuotaExceededError to QuotaError', () => {
    expect(toIDBKitError(dom('QuotaExceededError'), 'x')).toBeInstanceOf(QuotaError);
  });

  it('maps AbortError to TransactionError', () => {
    expect(toIDBKitError(dom('AbortError'), 'x')).toBeInstanceOf(TransactionError);
  });

  it('passes idbkit errors through unchanged', () => {
    const original = new ValidationError('nope');
    expect(toIDBKitError(original, 'x')).toBe(original);
  });

  it('isRetryable() flags transient failures only', () => {
    expect(isRetryable(dom('TransactionInactiveError'))).toBe(true);
    expect(isRetryable(dom('ConstraintError'))).toBe(false);
  });
});

describe('withRetry', () => {
  it('resolves on first success without retrying', async () => {
    const op = vi.fn(async () => 'ok');
    await expect(withRetry(op)).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures then succeeds', async () => {
    let calls = 0;
    const op = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new DOMException('flaky', 'UnknownError');
      return 'recovered';
    });
    await expect(
      withRetry(op, { retries: 5, minDelay: 1, maxDelay: 2 }),
    ).resolves.toBe('recovered');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-retryable errors', async () => {
    const op = vi.fn(async () => {
      throw new ConstraintError('dupe');
    });
    await expect(withRetry(op, { retries: 5 })).rejects.toBeInstanceOf(
      ConstraintError,
    );
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('honors a custom shouldRetry predicate', async () => {
    let calls = 0;
    const op = vi.fn(async () => {
      calls += 1;
      if (calls < 2) throw new Error('custom');
      return 'done';
    });
    await expect(
      withRetry(op, {
        retries: 3,
        minDelay: 1,
        maxDelay: 2,
        shouldRetry: (e) => e instanceof Error && e.message === 'custom',
      }),
    ).resolves.toBe('done');
    expect(op).toHaveBeenCalledTimes(2);
  });
});
