import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
const root='src-tauri/runtime';
const manifest=JSON.parse(await readFile(`${root}/r-manifest.json`,'utf8'));
const dest=`${root}/sources`;await mkdir(dest,{recursive:true});
const jobs=[{name:'R',version:manifest.r,urls:[`https://cran.r-project.org/src/base/R-4/R-${manifest.r}.tar.gz`]}];
for(const p of manifest.packages.filter(p=>p.priority!=='base')){
  const file=`${p.package}_${p.version}.tar.gz`;
  const urls=p.repository?.startsWith('Bioconductor')?
    [`https://bioconductor.org/packages/3.21/bioc/src/contrib/${file}`,`https://bioconductor.org/packages/3.21/bioc/src/contrib/Archive/${p.package}/${file}`]:
    [`https://cran.r-project.org/src/contrib/${file}`,`https://cran.r-project.org/src/contrib/Archive/${p.package}/${file}`];
  jobs.push({name:p.package,version:p.version,urls});
}
const records=[];let next=0;
async function worker(){while(next<jobs.length){const job=jobs[next++];const filename=job.name==='R'?`R-${job.version}.tar.gz`:`${job.name}_${job.version}.tar.gz`;const path=`${dest}/${filename}`;let url;
  try{if((await stat(path)).size>1000)url=job.urls[0];}catch{}
  if(!url)for(const candidate of job.urls){try{const response=await fetch(candidate,{signal:AbortSignal.timeout(90000)});if(!response.ok)continue;await pipeline(Readable.fromWeb(response.body),createWriteStream(path));const bytes=await readFile(path);if(bytes[0]!==31||bytes[1]!==139)throw new Error('Not gzip');url=candidate;break;}catch(e){console.log('Retry',job.name,String(e));}}
  if(!url)throw new Error(`No exact source archive found for ${filename}`);
  const bytes=await readFile(path);records.push({...job,urls:undefined,url,file:filename,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});console.log('SOURCE',filename,bytes.length);
}}
await Promise.all([worker(),worker(),worker()]);
await writeFile(`${dest}/manifest.json`,JSON.stringify(records.sort((a,b)=>a.name.localeCompare(b.name)),null,2));
