import { adaptApp, adaptIndex } from './adapt-web.mjs';
import { cp, mkdir, readFile, writeFile, readdir, stat, rm } from 'node:fs/promises';
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
  await verifySource(root); await prepareAssets(root);
  const upstreamCount = await verifyPrecache(path.join(root, 'approved-runtime'));
  const output = path.resolve(root, 'dist');
  if (output !== path.join(path.resolve(root), 'dist')) throw new Error('Unsafe build directory');
  await rm(output, { recursive: true, force: true });
  await mkdir(path.join(output, 'app'), { recursive: true });
  await cp(path.join(root, 'approved-runtime'), path.join(output, 'app'), { recursive: true, filter: file => !file.endsWith('package.json') });
  const appRoot = path.join(output, 'app');
  await writeFile(path.join(appRoot, 'app.js'), adaptApp(await readFile(path.join(appRoot, 'app.js'), 'utf8')));
  await writeFile(path.join(appRoot, 'index.html'), adaptIndex(await readFile(path.join(appRoot, 'index.html'), 'utf8')));
  const reports = await readFile(path.join(appRoot, 'report-output.js'), 'utf8'), boundary = reports.indexOf('// Canvas uses');
  if (boundary < 0) throw new Error('PDF adaptation boundary changed');
  await writeFile(path.join(appRoot, 'report-output.js'), reports.slice(0, boundary) + "export {reportPdf} from './web-report-pdf.js';\n");
  for (const entry of await readdir(path.join(root, 'web'))) {
    if (entry === 'sw-template.js' || entry.startsWith('landing.') || entry.startsWith('admin.')) continue;
    await cp(path.join(root, 'web', entry), path.join(appRoot, entry));
  }
  await cp(path.join(root, 'shared/permit.mjs'), path.join(appRoot, 'permit.js'));
  for (const name of ['landing.css', 'landing.js']) await cp(path.join(root, 'web', name), path.join(output, name));
  await cp(path.join(root, 'web/landing.html'), path.join(output, 'index.html'));
  await mkdir(path.join(output,'admin'),{recursive:true});
  await cp(path.join(root,'web/admin.html'),path.join(output,'admin/index.html'));
  await cp(path.join(root,'web/admin.js'),path.join(output,'admin/admin.js'));
  await cp(path.join(root, 'node_modules/jspdf/dist/jspdf.umd.min.js'), path.join(appRoot, 'assets/jspdf.umd.min.js'));
  await cp(path.join(root, 'node_modules/jspdf/LICENSE'), path.join(appRoot, 'assets/jsPDF-LICENSE.txt'));
  const { default: sharp } = await import('sharp');
  for (const size of [192,512]) await sharp(path.join(appRoot, 'assets/alkarna-logo.png')).resize(size,size,{fit:'contain',background:'#142944'}).png().toFile(path.join(appRoot, 'assets/icon-'+size+'.png'));
  const manifest = {id:'/app/',name:'الكرنه | AlKarna',short_name:'الكرنه',lang:'ar',dir:'rtl',start_url:'/app/',scope:'/app/',display:'standalone',background_color:'#080e19',theme_color:'#080e19',icons:[{src:'assets/icon-192.png',sizes:'192x192',type:'image/png'},{src:'assets/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any maskable'}]};
  await writeFile(path.join(appRoot, 'manifest.webmanifest'), JSON.stringify(manifest)+'\n');
  /** @type {Array<{path:string,bytes:number,sha256:string}>} */
  const files=[];
  /** @param {string} relative */
  async function collect(relative=''){
    for(const entry of await readdir(path.join(output,relative),{withFileTypes:true})){
      const name=path.posix.join(relative,entry.name);
      if(entry.isDirectory())await collect(name);
      else if(name!=='app/sw.js'&&name!=='build-manifest.json'){
        const bytes=await readFile(path.join(output,name));files.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
      }
    }
  }
  await collect();files.sort((a,b)=>a.path.localeCompare(b.path));
  const template=await readFile(path.join(root,'web/sw-template.js'),'utf8');
  const version=createHash('sha256').update(JSON.stringify(files)).update(template).digest('hex').slice(0,20);
  const assets=files.filter(file=>file.path.startsWith('app/')).map(file=>({url:'/'+file.path,sha256:file.sha256}));
  const worker=template.replace('__VERSION__',JSON.stringify(version)).replace('__ASSETS__',JSON.stringify(assets));
  await writeFile(path.join(appRoot,'sw.js'),worker);
  files.push({path:'app/sw.js',bytes:Buffer.byteLength(worker),sha256:createHash('sha256').update(worker).digest('hex')});
  await writeFile(path.join(output,'build-manifest.json'),JSON.stringify({phase:2,deployable:false,version,upstream:'1efb01fc1cd7bc62670510e57c6158734ad4bf05',upstreamPrecacheEntries:upstreamCount,precacheEntries:assets.length,files},null,2)+'\n');
  return {phase:2,files:files.length,precacheEntries:assets.length,version,deployable:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await build()));
