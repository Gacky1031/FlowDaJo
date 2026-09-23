import {test} from "node:test";
import assert from "node:assert/strict";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {mkdtemp,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
test("MCP stdio real R: tools, edits, validation rollback, exports and desktop JSON roundtrip", {timeout:180000}, async()=>{
  const dir=await mkdtemp(join(tmpdir(),"flowdesk-mcp-"));
  const client=new Client({name:"flowdesk-test",version:"1.0"});
  const transport=new StdioClientTransport({command:process.execPath,args:[resolve("mcp/server.mjs")],stderr:"pipe"});
  let stderr=""; transport.stderr?.on("data",v=>stderr+=v);
  try {
    await client.connect(transport);
    const tools=await client.listTools(); assert.equal(tools.tools.length,11);
    async function call(name,args={}) {
      const r=await client.callTool({name,arguments:args},undefined,{timeout:150000});
      assert.ok(!r.isError,JSON.stringify(r)); return JSON.parse(r.content[0].text);
    }
    assert.equal((await call("health")).engine,"R / flowCore");
    const p=await call("new_project",{name:"MCP regression",demo:true});
    const sid=p.samples[0].id;
    const x={channel:"FSC-A",scale:"linear"},y={channel:"SSC-A",scale:"linear"};
    const ws=await call("put_worksheet",{id:"global",name:"Global",mode:"global",sampleId:sid,
      plots:[{id:"plot-a",sampleId:"active",population:[],x,y}]});
    assert.equal(ws.plots[0].width,344);
    const a=await call("analyze",{sampleId:sid,worksheetId:"global"});
    assert.equal(a.plots["plot-a"].total,16000);
    assert.equal(a.plots["plot-a"].xValues,undefined);
    const xr=a.plots["plot-a"].xRange,yr=a.plots["plot-a"].yRange;
    await call("put_gate",{id:"g1",name:"Cells",sampleId:sid,type:"rectangle",x,y,bounds:[...xr,...yr]});
    const gated=await call("analyze",{sampleId:sid});
    assert.equal(gated.stats.find(s=>s.id==="g1").count,16000);
    const bad=await client.callTool({name:"put_gate",arguments:{id:"g1",name:"Bad",sampleId:sid,parent:"g1",type:"rectangle",x,y,bounds:[...xr,...yr]}});
    assert.equal(bad.isError,true);
    assert.equal((await call("get_project")).gates[0].name,"Cells");
    const comp=p.samples[0].compensation;
    await call("set_compensation",{sampleId:sid,...comp});
    const wrong=await client.callTool({name:"put_worksheet",arguments:{id:"bad",name:"Bad",mode:"normal",sampleId:sid,plots:[{id:"b",sampleId:"active",x,y}]}});
    assert.equal(wrong.isError,true);
    await call("export",{format:"csv",path:join(dir,"stats.csv")});
    assert.match(await readFile(join(dir,"stats.csv"),"utf8"),/Cells/);
    const noOverwrite=await client.callTool({name:"export",arguments:{format:"csv",path:join(dir,"stats.csv")}});
    assert.equal(noOverwrite.isError,true);
    await call("save_project",{path:join(dir,"project.json")});
    await call("load_project",{path:join(dir,"project.json"),replace:true});
    const saved=await call("get_project");
    assert.equal(saved.worksheets[0].mode,"global");
    assert.equal(saved.gates[0].scope,"global");
    const svg=await call("export",{format:"plot_svg",path:join(dir,"plot.svg"),sampleId:sid,worksheetId:"global",plotId:"plot-a"});
    assert.equal(svg.plots,1);
    assert.match(await readFile(join(dir,"plot.svg"),"utf8"),/<svg/);
  } finally { await client.close(); }
});

