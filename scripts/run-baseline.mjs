import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const tests = ['verify-feature-domains.mjs', 'verify-party-summaries.mjs', 'verify-report-sources.mjs', 'verify-french-locale.mjs', 'verify-approved-source-navigation.mjs', 'verify-import-features.mjs'];
for (const script of tests) {
  const result = spawnSync(process.execPath, ['scripts/' + script], { cwd: ROOT, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(script + ' failed: ' + result.status);
}
console.log(JSON.stringify({ baselineScripts: tests.length, status: 'passed' }));
