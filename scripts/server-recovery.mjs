import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotService, restoreService } from '../server/recovery.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const [command,input,output]=process.argv.slice(2),keyFile=process.env.SERVER_BACKUP_KEY_FILE;
function checkTarget(filename){if(!filename)throw Error('A private target path is required');const target=path.resolve(filename).toLowerCase(),repository=path.resolve(root).toLowerCase();if(target.startsWith(repository+path.sep)&&![path.join(repository,'private')+path.sep,path.join(repository,'data')+path.sep].some(p=>target.startsWith(p)))throw Error('Keep recovery keys and artifacts outside source/public directories');}
if(!keyFile)throw Error('Set SERVER_BACKUP_KEY_FILE to a private file; keep a separate offline copy');checkTarget(keyFile);
if(command==='key'){await writeFile(keyFile,randomBytes(32),{flag:'wx',mode:0o600});console.log('Private archive key created; no key material printed.');}
else if(command==='snapshot'){if(!process.env.SERVICE_CONFIG_FILE)throw Error('SERVICE_CONFIG_FILE is required');checkTarget(input);console.log(JSON.stringify(await snapshotService(process.env.SERVICE_CONFIG_FILE,input,keyFile)));}
else if(command==='restore'){checkTarget(output);if(!process.env.ERASURE_LEDGER_FILE)throw Error('Set ERASURE_LEDGER_FILE to the current private erasure ledger');checkTarget(process.env.ERASURE_LEDGER_FILE);console.log(JSON.stringify(await restoreService(input,output,keyFile,process.env.ERASURE_LEDGER_FILE)));}
else throw Error('Usage: server-recovery.mjs key | snapshot <new-archive-file> | restore <archive-file> <new-private-directory>');
