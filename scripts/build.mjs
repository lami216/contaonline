import { cp, mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareAssets } from './prepare-assets.mjs';
import { verifySource } from './verify-source.mjs';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
/** Verify the actual precache list; missing files must fail the build.
 * @param {string} root */
export async function verifyPrecache(root) {
  const sw = await readFile(path.join(root, 'sw.js'), 'utf8');
  const declaration = sw.match(/const FILES=(\[.*?\]);/s)?.[1];
  if (!declaration) throw new Error('Missing precache declaration');
  const files = /** @type {string[]} */ (JSON.parse(declaration.replaceAll("'", '"')));
  for (const name of files) {
    const relative = name === './' ? 'index.html' : name.replace(/^\.\//, '');
    if (relative.includes('..') || path.isAbsolute(relative) || !(await stat(path.join(root, relative))).isFile()) throw new Error('Invalid precache asset: ' + name);
  }
  return files.length;
}
/** @param {string} root */
export async function build(root = ROOT) {
  await verifySource(root);
  await prepareAssets(root);
  const count = await verifyPrecache(path.join(root, 'approved-runtime'));
  const output = path.join(root, 'dist');
  await mkdir(path.join(output, 'app'), { recursive: true });
  await cp(path.join(root, 'approved-runtime'), path.join(output, 'app'), { recursive: true, filter: file => !file.endsWith('package.json') });
  // Phase 1 cannot expose the unlicensed upstream setup through its entry point.
  const locked = '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>الكرنه</title><main><h1>النسخة قيد التجهيز</h1><p>هذه دفعة تحقق داخلية. لم يجهز تفعيل الويب بعد.</p></main></html>';
  await writeFile(path.join(output, 'app/index.html'), locked);
  await writeFile(path.join(output, 'index.html'), locked);
  /** @type {Array<{path:string,bytes:number,sha256:string}>} */
  const files = [];
  /** @param {string} relative */
  async function collect(relative = '') {
    for (const item of await readdir(path.join(output, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, item.name);
      if (item.isDirectory()) await collect(name);
      else if (name !== 'build-manifest.json') {
        const data = await readFile(path.join(output, name));
        files.push({ path: name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
      }
    }
  }
  await collect();
  const manifest = { phase: 1, deployable: false, upstream: '1efb01fc1cd7bc62670510e57c6158734ad4bf05', precacheEntries: count, files: files.sort((a,b) => a.path.localeCompare(b.path)) };
  await writeFile(path.join(output, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { phase: 1, files: files.length, precacheEntries: count, deployable: false };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await build()));
