# Browser compatibility

idbkit is a thin layer over native IndexedDB and adds no polyfills. If a runtime
has IndexedDB, idbkit works there.

## Supported environments

- **Chrome / Edge / other Chromium browsers** — full support.
- **Firefox** — full support.
- **Safari (desktop and iOS)** — full support in current and recent versions.
- **Web Workers** (dedicated, shared) and **Service Workers** — IndexedDB is
  available; idbkit runs unchanged.
- **Node.js** — no IndexedDB by default. For tests, add a polyfill such as
  [`fake-indexeddb`](https://github.com/dumbmatter/fakeIndexedDB) (this is what
  idbkit's own test suite uses).

All evergreen browsers from roughly 2018 onward ship the IndexedDB 2.0 features
idbkit relies on.

## Platform features idbkit uses

| Feature | Used for | Availability |
| --- | --- | --- |
| IndexedDB core | everything | All modern browsers. |
| `getAll` / `getAllKeys` | fast range reads, snapshots | IndexedDB 2.0 — all current browsers. |
| Compound (array) key paths | compound indexes & keys | All current browsers. |
| `multiEntry` indexes | indexing array fields | All current browsers. |
| `IDBKeyRange` | every query | Universal. |
| `structuredClone` semantics | stored values | Universal (storage layer). |
| `crypto.randomUUID` | `uuid()` | Recent browsers; idbkit falls back to `crypto.getRandomValues` automatically. |
| `crypto.getRandomValues` | `uuid()`, `ulid()` | Universal in browsers; Node 18+. |

The key generators degrade gracefully: `uuid()` uses `crypto.randomUUID` when
present and a `getRandomValues` implementation otherwise.

## Known platform quirks

These are IndexedDB engine behaviors, not idbkit-specific:

- **Private / incognito modes.** Some browsers restrict or wipe IndexedDB in
  private windows. Storage may be capped or cleared when the session ends.
  Detect failures and degrade rather than assuming persistence.
- **Storage eviction.** For origins that haven't been granted persistence, the
  browser may evict IndexedDB under storage pressure. Use
  `navigator.storage.persist()` for data you can't lose, and treat the database
  as a cache otherwise.
- **`file://` pages.** IndexedDB availability on `file://` origins varies by
  browser. The bundled playground detects this and tells you to serve the page
  over `http://` if needed.
- **Safari historical bugs.** Safari versions from several years ago had
  IndexedDB reliability issues that have since been fixed. Current Safari is
  solid; very old Safari is not a supported target.
- **Cross-tab upgrades.** When one tab opens a newer schema version, other open
  connections block the upgrade until they close. idbkit's default
  `onVersionChange` closes the old connection to let the upgrade through; provide
  an `onBlocked` handler to prompt the user when appropriate.

## Feature detection

```ts
if (typeof indexedDB === 'undefined') {
  // No IndexedDB — fall back to in-memory storage or warn the user.
}
```

idbkit throws a clear `DatabaseError` if you call `openDatabase` where IndexedDB
isn't available, so you can also wrap the open call in `try/catch`.
