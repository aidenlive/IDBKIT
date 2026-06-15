import { defineConfig } from 'tsup';

/**
 * Build matrix:
 *  - ESM   -> dist/index.js        (modern bundlers, `import`)
 *  - CJS   -> dist/index.cjs       (Node `require`, legacy tooling)
 *  - IIFE  -> dist/index.global.js (drop-in <script>, exposes `window.idbkit`)
 *
 * Declarations are emitted once (dist/index.d.ts). The bundle is marked
 * side-effect-free in package.json so consumers tree-shake unused exports.
 */
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs', 'iife'],
  globalName: 'idbkit',
  target: 'es2021',
  platform: 'browser',
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  minify: false,
  outExtension({ format }) {
    if (format === 'esm') return { js: '.js' };
    if (format === 'cjs') return { js: '.cjs' };
    return { js: '.global.js' };
  },
});
