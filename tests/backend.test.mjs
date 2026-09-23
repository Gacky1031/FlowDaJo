import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const r='src-tauri/runtime/R/bin/Rscript.exe';
const storage=mkdtempSync(join(tmpdir(),'flowdesk-protocol-'));
function run(input){const result=spawnSync(r,['--vanilla','r/worker.R'],{input:JSON.stringify({...input,storage}),encoding:'utf8',maxBuffer:30*1024*1024,env:{...process.env,LANG:'C',LC_ALL:'C'}});if(result.error)throw result.error;return {status:result.status,body:JSON.parse(result.stdout)};}
test('real R health handshake',()=>{const r=run({action:'health'});assert.equal(r.status,0);assert.equal(r.body.ok,true);assert.match(r.body.data.flowCore,/^\d/);});
test('unsupported commands return structured error',()=>{const r=run({action:'eval',code:'1+1'});assert.equal(r.status,1);assert.equal(r.body.ok,false);assert.match(r.body.error,/Unknown action/);});
test('demo roundtrip across independent R workers',()=>{const demo=run({action:'demo'}).body.data;const result=run({action:'analyze',sampleId:'demo-42',project:{schema:'flowdesk-r/1',name:'Protocol test',samples:demo.samples,gates:[],selectedGate:'root'}});assert.equal(result.status,0);assert.equal(result.body.data.stats[0].count,16000);assert.equal(result.body.data.plots.length,4);assert.equal(result.body.data.plots[0].points[0].length,2);});
