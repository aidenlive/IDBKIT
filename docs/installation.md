# Installation

idbkit ships as ESM, CommonJS, and a standalone IIFE bundle, with TypeScript
declarations included. It has **zero runtime dependencies**.

## Package managers

```bash
npm install idbkit
# or
pnpm add idbkit
# or
yarn add idbkit
```

```ts
import { openDatabase, uuid } from 'idbkit';
```

CommonJS works too:

```js
const { openDatabase } = require('idbkit');
```

## CDN / no build step

The IIFE build exposes a global named `idbkit`:

```html
<script src="https://unpkg.com/idbkit"></script>
<script>
  const { openDatabase, uuid } = idbkit;
  openDatabase({
    name: 'demo',
    version: 1,
    stores: { items: { keyPath: 'id' } },
  }).then(async (db) => {
    await db.store('items').add({ id: uuid(), at: Date.now() });
  });
</script>
```

You can also load the ESM build directly in a modern browser:

```html
<script type="module">
  import { openDatabase } from 'https://unpkg.com/idbkit/dist/index.js';
</script>
```

> Loading ES modules from `file://` is blocked by browser CORS rules. Serve the
> page over `http://` (e.g. `npx serve`) or use the IIFE `<script>` build, which
> works from the filesystem.

## Bundlers

idbkit is `"sideEffects": false`, so any modern bundler (Vite, webpack, Rollup,
esbuild, Parcel) tree-shakes the parts you don't import. No configuration is
required. The `exports` map points each environment at the right build:

```jsonc
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  }
}
```

## TypeScript

Types are bundled — there's nothing extra to install. idbkit targets ES2021 and
relies on the DOM `lib` for IndexedDB types, which is on by default in browser
projects. For a non-DOM `tsconfig`, add `"DOM"` to `compilerOptions.lib`.

## Deno

```ts
import { openDatabase } from 'npm:idbkit';
```

## Requirements

- A runtime with IndexedDB (any modern browser; Web Workers included).
- For Node-based tests, a polyfill such as
  [`fake-indexeddb`](https://github.com/dumbmatter/fakeIndexedDB).
