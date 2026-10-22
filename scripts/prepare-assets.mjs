import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
/** @param {string} root */
export async function prepareAssets(root = ROOT) {
  const manifest = JSON.parse(await readFile(path.join(root, 'resources/vendor.json'), 'utf8'));
  const sql = manifest.assets.find(/** @param {{name:string}} item */ item => item.name === 'sql.js');
  const bytes = await readFile(new URL(import.meta.resolve('sql.js/dist/sql-asm.js')));
  if (createHash('sha256').update(bytes).digest('hex') !== sql.sha256) throw new Error('Pinned SQLite runtime digest mismatch');
  const destination = path.join(root, sql.output);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  return { asset: sql.output, bytes: bytes.length, sha256: sql.sha256 };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await prepareAssets()));
