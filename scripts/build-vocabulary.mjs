// Offline, reproducible data generation. Download pinned official inputs listed
// in vocabulary-sources.json into the supplied directory first; never sort the
// resulting vocabulary alphabetically before selecting a frequency baseline.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const dir=process.argv[2];if(!dir)throw new Error('Usage: node scripts/build-vocabulary.mjs <source-directory>');
const sources=JSON.parse(await readFile(new URL('./vocabulary-sources.json',import.meta.url),'utf8'));
const ranks=new Map();
for(const source of sources){
  const input=await readFile(path.join(dir,source.file));
  if(createHash('sha256').update(input).digest('hex')!==source.sha256)throw new Error(`Source integrity mismatch: ${source.file}`);
  const lines=input.toString('utf8').trim().split(/\r?\n/);
  lines.forEach((line,i)=>{const word=(source.format==='counts'?line.split(' ')[0]:line).trim().toLowerCase();if(!/^[a-z]+$/.test(word))return;const rank=i+1+source.rankOffset;ranks.set(word,Math.min(rank,ranks.get(word)??Infinity));});
}
const words=[...ranks].sort((a,b)=>a[1]-b[1]||a[0].localeCompare(b[0],'en')).map(([word])=>word);
await writeFile('public/vocabulary/english-frequency.txt',words.join('\n')+'\n');
await writeFile('public/vocabulary/common-words-10k.txt',words.slice(0,10000).join('\n')+'\n');
console.log(`Generated ${words.length} ranked words and the 10000-word compatibility baseline.`);
