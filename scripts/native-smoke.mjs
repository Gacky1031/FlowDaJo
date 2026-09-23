import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const executable=resolve(process.argv[2]||'release/FlowDesk-Tauri-0.3.0/FlowDesk-Tauri.exe');
mkdirSync('artifacts',{recursive:true});
const app=spawn(executable,[],{windowsHide:true,env:{...process.env,PATH:`${process.env.SystemRoot}/System32;${process.env.SystemRoot}`,FLOWDESK_RSCRIPT:'C:/invalid-system-R/Rscript.exe',R_HOME:'C:/invalid-system-R',R_LIBS_USER:'C:/invalid-library',R_LIBS_SITE:'C:/invalid-library',WEBVIEW2_BROWSER_EXECUTABLE_FOLDER:'C:/invalid-WebView2',WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9237',WEBVIEW2_USER_DATA_FOLDER:resolve('artifacts/native-0.3-profile')}});
let browser,page;
try {
 for(let i=0;i<60;i++){if(app.exitCode!==null)throw Error('Native EXE exited '+app.exitCode);try{browser=await chromium.connectOverCDP('http://127.0.0.1:9237');break;}catch{await new Promise(r=>setTimeout(r,500));}}
 if(!browser)throw Error('Native WebView2 unavailable');
 for(let i=0;i<30;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('tauri'));if(page)break;await new Promise(r=>setTimeout(r,300));}
 if(!page)throw Error('Tauri page missing');
 await page.getByText(/起動完了/).waitFor({timeout:30000});
 const health=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('request',{payload:{action:'health'}}));
 assert.equal(health.rHome.toLowerCase(),resolve(executable,'../runtime/R').replaceAll('\\','/').toLowerCase());
 const version=await(await browser.newBrowserCDPSession()).send('Browser.getVersion');assert.ok(version.product.includes('153.0.4234.32'));
 await page.locator('#demo').click();await page.getByRole('cell',{name:'16,000',exact:true}).waitFor({timeout:30000});
 for(let i=0;i<5;i++)await page.locator('#add-plot').click();
 await page.waitForFunction(()=>document.querySelectorAll('.plot-card').length===6&&!document.querySelector('.status.pending'),{},{timeout:30000});
 assert.equal(await page.locator('.plot-error:visible').count(),0);
 await page.getByRole('button',{name:'矩形',exact:true}).click();const stage=page.locator('.plot-stage').first();const rect=await stage.boundingBox();
 await page.mouse.move(rect.x+75,rect.y+85);await page.mouse.down();await page.mouse.move(rect.x+170,rect.y+175,{steps:8});await page.mouse.up();
 await page.waitForFunction(()=>document.querySelectorAll('.statistics tbody tr').length===2&&!document.querySelector('.status.pending'),{},{timeout:30000});
 const result=await page.evaluate(async({projectPath,pdfPath,fcsPath})=>{
  const call=payload=>window.__TAURI_INTERNALS__.invoke('request',{payload});
  const before=await call({action:'health'});const demo=await call({action:'demo'});const axis=channel=>({channel,scale:/^(FSC|SSC)/.test(channel)?'linear':'logicle',w:.5,t:262144,m:4.5,a:0});
  const plots=Array.from({length:12},(_,i)=>({id:'p'+i,sampleId:'active',population:[],mode:i===11?'histogram':'scatter',x:axis(i%2?'FITC-A':'FSC-A'),y:axis(i%2?'PE-A':'SSC-A'),left:24+i%3*360,top:24+Math.floor(i/3)*330,width:344,height:314}));
  const project={schema:'flowdesk-r/1',name:'Native worksheet verification',samples:demo.samples,gates:[],selectedGate:'root',notes:'',importWarnings:[],worksheets:[{id:'global',name:'Global',plots}],activeWorksheet:'global'};
  project.samples[0].compensation.enabled=true;
  const start=performance.now();const analysis=await call({action:'worksheet',project,sampleId:'demo-42',plots});const elapsedMs=performance.now()-start;
  await call({action:'save',project,path:projectPath});const restored=await call({action:'load',path:projectPath});
  await call({action:'worksheet_report_pdf',project,sampleId:'demo-42',plots,worksheetName:'Global',path:pdfPath});
  const fcs=await call({action:'import',paths:[fcsPath]});
  const after=await call({action:'health'});
  return {elapsedMs,workerPid:before.workerPid,sameWorker:before.workerPid===after.workerPid,plots:Object.keys(analysis.plots).length,events:analysis.stats['demo-42'][0].count,histogram:analysis.plots.p11.histogram.counts.reduce((a,b)=>a+b,0),restored:restored.worksheets[0].plots.length,imported:fcs.samples[0].events,errors:analysis.errors};
 },{projectPath:resolve('artifacts/native-0.3-project.json'),pdfPath:resolve('artifacts/native-0.3-report.pdf'),fcsPath:resolve('artifacts/demo.fcs')});
 assert.equal(result.plots,12);assert.equal(result.events,16000);assert.equal(result.histogram,16000);assert.equal(result.restored,12);assert.equal(result.imported,16000);assert.equal(result.sameWorker,true);assert.equal(Object.keys(result.errors).length,0);
 await page.screenshot({path:'artifacts/native-0.3-workspace.png',fullPage:true});
 const record={...result,bundledR:health.rHome,webview:version.product};writeFileSync('artifacts/native-0.3-validation.json',JSON.stringify(record,null,2));console.log('PASS native 0.3',JSON.stringify(record));
}finally{
 if(browser)await browser.close();
 if(app.exitCode===null){try{execFileSync('taskkill.exe',['/PID',String(app.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{app.kill();}}
}
