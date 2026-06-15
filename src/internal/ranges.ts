/**
 * @module internal/ranges
 * Helpers that build `IDBKeyRange` objects from high-level query operators.
 * Centralizing this keeps the query builder declarative and testable.
 */
import { ValidationError } from '../errors.js';
import type { ValidKey } from '../types.js';

/** Bounds accepted when constructing a range. */
export interface RangeBounds {
  /** Lower bound (inclusive unless `lowerOpen`). */
  lower?: ValidKey;
  /** Upper bound (inclusive unless `upperOpen`). */
  upper?: ValidKey;
  /** Exclude the lower bound. */
  lowerOpen?: boolean;
  /** Exclude the upper bound. */
  upperOpen?: boolean;
}

/** Build a range from explicit bounds, or `null` for an unbounded query. */
export function buildRange(bounds: RangeBounds): IDBKeyRange | null {
  const { lower, upper, lowerOpen = false, upperOpen = false } = bounds;
  const hasLower = lower !== undefined;
  const hasUpper = upper !== undefined;

  if (!hasLower && !hasUpper) return null;
  if (hasLower && hasUpper) {
    return IDBKeyRange.bound(lower, upper, lowerOpen, upperOpen);
  }
  if (hasLower) return IDBKeyRange.lowerBound(lower, lowerOpen);
  return IDBKeyRange.upperBound(upper as ValidKey, upperOpen);
}

/** An exact-match range for a single key. */
export function only(value: ValidKey): IDBKeyRange {
  return IDBKeyRange.only(value);
}

/**
 * A prefix range for string keys: matches everything from `prefix` up to but
 * not including the next string sort-order boundary. Only valid for strings or
 * compound keys whose final segment is a string.
 *
 * @throws {ValidationError} If `prefix` is not a string.
 */
export function stringPrefix(prefix: string): IDBKeyRange {
  if (typeof prefix !== 'string') {
    throw new ValidationError('startsWith() requires a string prefix');
  }
  // '\uffff' is the highest BMP code point; appending it produces an upper
  // bound just past every string that begins with `prefix`.
  return IDBKeyRange.bound(prefix, `${prefix}\uffff`, false, false);
}

/**
 * A prefix range over a compound key whose leading segments are fixed.
 * For a `[a, b, c]` index, `compoundPrefix([x])` matches every entry whose
 * first segment equals `x`, regardless of `b`/`c`.
 */
export function compoundPrefix(prefix: ValidKey[]): IDBKeyRange {
  if (!Array.isArray(prefix) || prefix.length === 0) {
    throw new ValidationError('compoundPrefix() requires a non-empty array');
  }
  // `[]` sorts before any populated array and `[[]]` sorts after any array of
  // primitives sharing the prefix, giving an inclusive lower / exclusive upper.
  const lower = [...prefix];
  const upper = [...prefix, []];
  return IDBKeyRange.bound(lower, upper, false, true);
}
