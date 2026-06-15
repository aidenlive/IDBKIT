# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-06-15

### Added

- Initial release.
- `openDatabase` with declarative schema, automatic schema reconciliation, and
  per-version data migrations.
- Typed `Store` API: `get`, `getMany`, `getAll`, `getAllKeys`, `getKey`,
  `count`, `has`, `add`, `put`, `update`, `delete`, `clear`.
- Bulk writes: `bulkAdd`, `bulkPut`, `bulkDelete` (atomic per call).
- Atomic multi-store transactions via `db.transaction`, with optional retry.
- Fluent, immutable `QueryBuilder` with range operators, `filter`, `map`,
  `reverse`, `distinct`, `limit`, `offset`, and terminals including `delete`.
- Typed `Index` accessor and compound-index support.
- Cursor walking via `walkCursor` and `store.iterate` with stop/update/delete
  directives.
- Offset and keyset pagination.
- Key generators: `uuid`, `ulid` (monotonic), `timestampKey`, `counter`.
- Backup/restore: `exportSnapshot`, `importSnapshot`, `restore`, `clearStores`,
  JSON helpers, and a browser `downloadBackup`.
- `withRetry` with exponential backoff and full jitter.
- Branchable error hierarchy and DOMException mapping.
- Dual ESM + CJS builds plus an IIFE global bundle.

[1.0.0]: https://github.com/idbkit/idbkit/releases/tag/v1.0.0
