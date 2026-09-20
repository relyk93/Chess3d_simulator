// Copies the single-threaded LITE Stockfish WASM build into public/stockfish/ so it can be
// loaded as a classic Worker (new Worker('/stockfish/<name>.js')) without cross-origin
// isolation headers (no SharedArrayBuffer needed).
//
// Layout of the stockfish npm package (v19): node_modules/stockfish/bin/ holds prebuilt
// pairs named stockfish-<ver>[-lite][-single].{js,wasm}. We deliberately take the
// "-lite-single" pair (~1.8 MB wasm, still far stronger than any human). The full
// single-threaded wasm is ~99 MB, which is unacceptable for a first page load.
// The .js loads its .wasm by matching base name from its own directory, so both are
// copied together under their original names.
//
// If this script prints a different name than STOCKFISH_URL in
// src/engine/stockfishWorker.ts, update that constant.
//
// Postinstall must never break an install: exit 0 if the package is absent, exit 1 only
// if the package is present but no suitable build is found.
import { mkdirSync, readdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'node_modules', 'stockfish', 'bin');
const dest = join(root, 'public', 'stockfish');

if (!existsSync(src)) {
  console.warn('[copy-stockfish] node_modules/stockfish/bin not found; skipping');
  process.exit(0);
}

const entries = readdirSync(src);
const jsFiles = entries
  .filter((f) => /^stockfish-.*-lite-single\.js$/.test(f) && entries.includes(f.replace(/\.js$/, '.wasm')))
  .sort();
if (jsFiles.length === 0) {
  console.error('[copy-stockfish] no lite single-threaded build (js + wasm pair) found in', src, '\nContents:', entries);
  process.exit(1);
}

const js = jsFiles[jsFiles.length - 1];
const wasm = js.replace(/\.js$/, '.wasm');

mkdirSync(dest, { recursive: true });
// Drop stale builds from a previous stockfish version so public/ only ships one.
for (const f of readdirSync(dest)) {
  if (f.startsWith('stockfish-') && f !== js && f !== wasm) rmSync(join(dest, f), { force: true });
}
for (const f of [js, wasm]) copyFileSync(join(src, f), join(dest, f));
console.log('[copy-stockfish] copied:', `${js}, ${wasm}`, '->', dest);
