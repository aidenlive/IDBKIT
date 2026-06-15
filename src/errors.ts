/**
 * @module errors
 * A small, branchable error hierarchy. Every rejection from idbkit is an
 * instance of {@link IDBKitError}; specific failure modes get their own
 * subclass so callers can `instanceof`-check instead of string-matching.
 */

/** Base class for every error thrown by idbkit. */
export class IDBKitError extends Error {
  /** The original error or `DOMException`, when this wraps a lower-level failure. */
  public readonly cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'IDBKitError';
    this.cause = options?.cause;
    // Restore prototype chain for transpiled/extended Error subclasses.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Opening, closing, deleting, or connecting to a database failed. */
export class DatabaseError extends IDBKitError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DatabaseError';
  }
}

/** A transaction failed, was aborted, or completed unexpectedly. */
export class TransactionError extends IDBKitError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TransactionError';
  }
}

/** A unique-index or primary-key uniqueness constraint was violated. */
export class ConstraintError extends IDBKitError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ConstraintError';
  }
}

/** A requested record, store, or index does not exist. */
export class NotFoundError extends IDBKitError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'NotFoundError';
  }
}

/** A schema migration or upgrade failed. */
export class MigrationError extends IDBKitError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MigrationError';
  }
}

/** The storage quota was exceeded. */
export class QuotaError extends IDBKitError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'QuotaError';
  }
}

/** An upgrade is blocked by another open connection. */
export class BlockedError extends IDBKitError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BlockedError';
  }
}

/** An operation exceeded its configured timeout. */
export class TimeoutError extends IDBKitError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TimeoutError';
  }
}

/** Invalid arguments were supplied to an idbkit API. */
export class ValidationError extends IDBKitError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ValidationError';
  }
}

function isDomException(value: unknown): value is DOMException {
  return (
    typeof DOMException !== 'undefined' &&
    value instanceof DOMException
  );
}

/**
 * Translate a native `DOMException` (or arbitrary thrown value) into the most
 * specific idbkit error available, preserving the original as `cause`.
 *
 * @param error - The raw error caught from an IndexedDB operation.
 * @param context - Short human description of what was being attempted.
 */
export function toIDBKitError(error: unknown, context: string): IDBKitError {
  if (error instanceof IDBKitError) return error;

  if (isDomException(error)) {
    const message = `${context}: ${error.name} — ${error.message}`;
    switch (error.name) {
      case 'ConstraintError':
        return new ConstraintError(message, { cause: error });
      case 'QuotaExceededError':
        return new QuotaError(message, { cause: error });
      case 'NotFoundError':
        return new NotFoundError(message, { cause: error });
      case 'AbortError':
        return new TransactionError(message, { cause: error });
      case 'VersionError':
        return new MigrationError(message, { cause: error });
      case 'TransactionInactiveError':
      case 'ReadOnlyError':
      case 'DataError':
      case 'InvalidStateError':
        return new TransactionError(message, { cause: error });
      default:
        return new DatabaseError(message, { cause: error });
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  return new IDBKitError(`${context}: ${message}`, { cause: error });
}

/**
 * Determine whether a failure is plausibly transient and worth retrying.
 * Quota and constraint violations are deterministic and excluded.
 */
export function isRetryable(error: unknown): boolean {
  const name =
    isDomException(error) || error instanceof Error ? error.name : '';
  return (
    name === 'TransactionInactiveError' ||
    name === 'AbortError' ||
    name === 'UnknownError' ||
    name === 'TimeoutError'
  );
}
