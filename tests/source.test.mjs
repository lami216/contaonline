import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, rm, writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySource } from '../scripts/verify-source.mjs';
import { verifyPrecache } from '../scripts/build.mjs';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
test('imported baseline preserves source bytes and the runtime precache is complete', async () => {
  const result = await verifySource(ROOT);
  assert.equal(result.files, 52);
  assert.equal(await verifyPrecache(path.join(ROOT, 'approved-runtime')), 45);
});
test('modified upstream code and a missing font fail validation before an artifact can ship', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'contaonline-baseline-'));
  try {
    await cp(path.join(ROOT, 'resources'), path.join(temporary, 'resources'), { recursive: true });
    await cp(path.join(ROOT, 'approved-runtime'), path.join(temporary, 'approved-runtime'), { recursive: true });
    await cp(path.join(ROOT, 'scripts'), path.join(temporary, 'scripts'), { recursive: true });
    const app = path.join(temporary, 'approved-runtime/app.js');
    await writeFile(app, (await readFile(app)) + '\n// drift');
    await assert.rejects(verifySource(temporary), /Upstream bytes changed/);
    await unlink(path.join(temporary, 'approved-runtime/assets/StitchArabic.ttf'));
    await assert.rejects(verifyPrecache(path.join(temporary, 'approved-runtime')));
  } finally {
    if (!path.resolve(temporary).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('Unsafe cleanup directory');
    await rm(temporary, { recursive: true, force: true });
  }
});
