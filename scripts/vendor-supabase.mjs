// Bundles @supabase/supabase-js into a single self-contained ESM file that the
// app imports directly — so the web/PWA runtime stays 100% buildless and needs
// no CDN. Re-run after bumping the SDK version in package.json:
//
//   npm install && npm run vendor:supabase
//
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(root, 'www/js/vendor/supabase.js');
const version = require('@supabase/supabase-js/package.json').version;

mkdirSync(dirname(outfile), { recursive: true });

// A tiny entry that re-exports just what the app needs.
const entry = resolve(root, 'scripts/.supabase-entry.mjs');
writeFileSync(entry, "export { createClient } from '@supabase/supabase-js';\n");

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  banner: {
    js: `// @supabase/supabase-js v${version} — vendored single-file ESM build.\n`
      + `// Do not edit by hand. Regenerate with: npm run vendor:supabase\n`,
  },
});

console.log(`Vendored @supabase/supabase-js@${version} → www/js/vendor/supabase.js`);
