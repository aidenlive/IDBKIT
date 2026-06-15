// Provide a real, in-memory IndexedDB implementation for the Node test runner.
import 'fake-indexeddb/auto';

// idbkit targets the browser, where Web Crypto is a global. Node 18 doesn't
// expose it on globalThis (it became a global in Node 19), so provision it for
// the test runner the same way fake-indexeddb provisions IndexedDB above.
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    enumerable: false,
    writable: false,
  });
}
