// Copies the built IIFE bundle into the site so the playground works by simply
// opening site/index.html — no build step required for end users.
import { copyFile, mkdir, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'dist/index.global.js');
const dest = resolve(root, 'site/vendor/idbkit.global.js');

try {
  await access(src);
} catch {
  console.error(
    '[copy-vendor] dist/index.global.js not found. Run `npm run build` first.',
  );
  process.exit(0); // Don't fail the build; the site simply won't have the bundle yet.
}

await mkdir(dirname(dest), { recursive: true });
await copyFile(src, dest);
console.log('[copy-vendor] site/vendor/idbkit.global.js updated');
