import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
/** @param {string} root */
export async function verifySource(root = ROOT) {
  const manifest = JSON.parse(await readFile(path.join(root, 'resources/source-manifest.json'), 'utf8'));
  if (manifest.commit !== '1efb01fc1cd7bc62670510e57c6158734ad4bf05') throw new Error('Unexpected upstream revision');
  const seen = new Set();
  for (const entry of manifest.files) {
    const relative = entry.destination;
    if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('..') || seen.has(relative)) throw new Error('Invalid source allowlist');
    seen.add(relative);
    const bytes = await readFile(path.join(root, relative));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const blob = createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + bytes.length + '\0'), bytes])).digest('hex');
    if (sha256 !== entry.sha256 || blob !== entry.gitBlob || bytes.length !== entry.bytes) throw new Error('Upstream bytes changed: ' + relative);
  }
  const extraAssets = new Set(['assets/sql-asm.js', 'assets/package.json']);
  /** @param {string} relative */
  async function inspect(relative = '') {
    for (const item of await readdir(path.join(root, 'approved-runtime', relative), { withFileTypes: true })) {
      const nested = path.posix.join(relative, item.name);
      if (item.isDirectory()) await inspect(nested);
      else if (!seen.has('approved-runtime/' + nested) && !extraAssets.has(nested)) throw new Error('Unlisted runtime file: ' + nested);
    }
  }
  await inspect();
  return { files: manifest.files.length, commit: manifest.commit };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await verifySource()));
