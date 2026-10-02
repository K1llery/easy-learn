import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {zipSync} from 'fflate';
const {version}=JSON.parse(await readFile('public/manifest.json','utf8'));
const files={};async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else files[path.relative('dist',file).split(path.sep).join('/')]=await readFile(file);}}await walk('dist');
if(!files['manifest.json'])throw new Error('请先构建浏览器扩展。');
for(const module of ['react','react-dom','dompurify','epubjs','fflate','marked','zod','pdfjs-dist']){const names=await readdir(path.join('node_modules',module));const license=names.find(n=>/^license(?:\.|$)/i.test(n));if(!license)throw new Error(`缺少许可证：${module}`);files['LICENSES/'+module+'.txt']=await readFile(path.join('node_modules',module,license));}
files['THIRD-PARTY-NOTICES.txt']=Buffer.from('Third-party notices in LICENSES/. Vocabulary data CC BY-SA 4.0: vocabulary/ATTRIBUTION.md. All code is bundled locally; no remote extension code is loaded.\n');
await mkdir('artifacts',{recursive:true});const output=`artifacts/Easy-Learn-${version}-extension.zip`;const bytes=zipSync(files,{level:6});await writeFile(output,bytes);await writeFile(output+'.sha256',createHash('sha256').update(bytes).digest('hex')+'  '+path.basename(output)+'\n');console.log(output);
