/**
 * @module internal/promisify
 * The bridge between IndexedDB's event-based API and promises. Keeping this in
 * one place means error mapping and transaction-completion semantics are
 * consistent everywhere.
 */
import { toIDBKitError, TransactionError } from '../errors.js';

/**
 * Resolve when an `IDBRequest` succeeds, reject (with a mapped error) on failure.
 *
 * @param request - The request returned by an IndexedDB call.
 * @param context - Description used in any resulting error message.
 */
export function requestToPromise<T>(
  request: IDBRequest<T>,
  context: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      // Prevent the error from bubbling to the transaction and aborting it
      // unless the caller chooses to let it.
      reject(toIDBKitError(request.error, context));
    };
  });
}

/**
 * Resolve when a transaction commits, reject if it errors or aborts.
 *
 * @param tx - The transaction to observe.
 * @param context - Description used in any resulting error message.
 */
export function transactionToPromise(
  tx: IDBTransaction,
  context = 'Transaction',
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(toIDBKitError(tx.error, `${context} failed`));
    tx.onabort = () =>
      reject(
        tx.error
          ? toIDBKitError(tx.error, `${context} aborted`)
          : new TransactionError(`${context} aborted`),
      );
  });
}

/**
 * Wrap a promise so it rejects with a {@link TransactionError} (subclass-able)
 * if it does not settle within `ms` milliseconds.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  context: string,
): Promise<T> {
  if (ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(toIDBKitError(new Error(`timed out after ${ms}ms`), context));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
