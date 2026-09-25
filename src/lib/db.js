import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

// Tiny JSON-collection engine. Every collection is one file under DATA_DIR,
// holding a JSON array, cached in memory. Writes are serialised and swapped
// atomically (tmp + rename) so a crash never truncates a file.
//
// This is the single seam for Postgres later: reimplement read()/persist() (or
// the modules that call them) against the DB and nothing above this changes.

const caches = new Map();     // name -> array (the live, mutated reference)
let writeChain = Promise.resolve();

const fileFor = (name) => path.join(config.dataDir, `${name}.json`);

// Returns the cached array for a collection. Callers mutate it in place and then
// call persist(name) — the returned reference IS the cache.
export async function read(name) {
  if (caches.has(name)) return caches.get(name);
  let arr = [];
  try {
    const raw = await fsp.readFile(fileFor(name), 'utf8');
    const parsed = raw.trim() ? JSON.parse(raw) : [];
    arr = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  caches.set(name, arr);
  return arr;
}

export function persist(name) {
  const snapshot = JSON.stringify(caches.get(name) ?? [], null, 2);
  writeChain = writeChain
    .then(async () => {
      await fsp.mkdir(config.dataDir, { recursive: true });
      const file = fileFor(name);
      const tmp = file + '.tmp';
      await fsp.writeFile(tmp, snapshot, 'utf8');
      await fsp.rename(tmp, file);
    })
    .catch((err) => console.error(`[db] persist ${name} failed:`, err.message));
  return writeChain;
}
