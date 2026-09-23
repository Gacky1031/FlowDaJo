import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, isAbsolute } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rHome = join(root, "src-tauri/runtime/R");
const storage = join(root, "output/mcp-cache");
await mkdir(storage, { recursive: true });
let project;
let queue = Promise.resolve();
const children = new Set();
const server = new McpServer({ name: "flowdesk", version: "0.1.0" }, {
  instructions: "FlowDesk R/flowCore analysis session, separate from the desktop's unsaved state. Start with new_project or load_project, inspect get_project, then edit gates/worksheets/compensation, analyze and save_project. All file paths must be absolute. No arbitrary R code execution. Save JSON and open it in the desktop to see changes. Gate coordinates and axis min/max use transformed display coordinates, not raw fluorescence for log/logicle."
});
async function rcall(payload) {
  return new Promise((ok, fail) => {
    const child = spawn(join(rHome, "bin/Rscript.exe"), ["--vanilla", join(root, "r/worker.R")], {
      cwd: root, windowsHide: true, env: { ...process.env, R_HOME: rHome,
        R_LIBS: join(rHome, "library"), R_LIBS_USER: join(rHome, "library"), LANG: "C", LC_ALL: "C" },
      stdio: ["pipe", "pipe", "pipe"]
    });
    children.add(child);
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill(); fail(new Error("R request exceeded 120 seconds")); }, 120000);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", v => { out += v; if (out.length > 64 * 1024 * 1024) { child.kill(); fail(new Error("R response too large")); } });
    child.stderr.on("data", v => { err = (err + v).slice(-4000); });
    child.stdin.on("error", e => fail(e));
    child.on("error", e => { clearTimeout(timer); children.delete(child); fail(e); });
    child.on("close", code => {
      clearTimeout(timer); children.delete(child);
      try { const result = JSON.parse(out); if (!result.ok) throw new Error(result.error); ok(result.data); }
      catch (e) { fail(new Error(out ? e.message : "R failed (" + code + "): " + err)); }
    });
    child.stdin.end(JSON.stringify({ ...payload, storage }));
  });
}
const pathSchema = z.string().refine(isAbsolute, "Use an absolute path");
const axis = z.object({
  channel: z.string().min(1), scale: z.enum(["linear", "log", "logicle"]),
  w: z.number().default(0.5), t: z.number().positive().default(262144),
  m: z.number().positive().default(4.5), a: z.number().default(0),
  min: z.number().optional(), max: z.number().optional()
}).refine(v => (v.min === undefined && v.max === undefined) ||
  (v.min !== undefined && v.max !== undefined && v.min < v.max), "Both min and max must be set, min < max");
const plot = z.object({
  id: z.string().min(1), sampleId: z.string().min(1),
  population: z.array(z.string()).default([]), x: axis, y: axis,
  mode: z.enum(["scatter","histogram","cdf","density","contour","pseudocolor","zebra"]).default("scatter"),
  left: z.number().nonnegative().default(24), top: z.number().nonnegative().default(24),
  width: z.number().min(280).default(344), height: z.number().min(270).default(314),
  dotSize: z.number().min(0.5).max(8).optional(), dotOpacity: z.number().min(0.05).max(1).optional(),
  bins: z.number().int().min(16).max(256).optional(),
  histogramNormalize: z.enum(["count","percent","mode"]).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()
});
function current() { if (!project) throw new Error("Call new_project or load_project first"); return project; }
function sample(id, p = current()) {
  const s = p.samples.find(s => s.id === id);
  if (!s) throw new Error("Unknown sample: " + id); return s;
}
function worksheet(id) {
  const s = (current().worksheets ?? []).find(s => s.id === id);
  if (!s) throw new Error("Unknown worksheet: " + id); return s;
}
function result(value) { return { content: [{ type: "text", text: JSON.stringify(value) }] }; }
function tool(name, description, inputSchema, run, readOnlyHint = false) {
  server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint, openWorldHint: false } }, args => {
    const task = queue.then(async () => {
      try { return result(await run(args)); }
      catch(e) { return { isError: true, content: [{ type: "text", text: e.message }] }; }
    });
    queue = task.catch(() => {}); return task;
  });
}
function compact(d) {
  if (d.plots) {
    const entries = Array.isArray(d.plots) ? d.plots.map((p,i) => [i,p]) : Object.entries(d.plots);
    d.plots = Object.fromEntries(entries.map(([id,p]) => [id, {
      id:p.id,sampleId:p.sampleId,gateId:p.gateId,mode:p.mode,x:p.x,y:p.y,
      xRange:p.xRange,yRange:p.yRange,total:p.total,shown:p.shown,excluded:p.excluded
    }]));
  }
  return d;
}
async function validate(p, ids = p.samples.map(s => s.id)) {
  for (const sampleId of ids) await rcall({ action:"analyze", project:p, sampleId });
}
async function writable(path, overwrite) {
  if (!overwrite) {
    try { await access(path); } catch(e) { if (e.code === "ENOENT") return; throw e; }
    throw new Error("Output exists; use overwrite:true explicitly");
  }
}
tool("health", "Check bundled R and flowCore. Does not require an open project.", {}, () => rcall({action:"health"}), true);
tool("new_project", "Create an independent MCP session project. Replaces the session only with replace:true. Optional synthetic demo.", {
  name:z.string().min(1), demo:z.boolean().default(false), replace:z.boolean().default(false)
}, async a => {
  if (project && !a.replace) throw new Error("Session already has a project; save it or set replace:true");
  const d = a.demo ? await rcall({action:"demo"}) : {samples:[],warnings:[]};
  project = {schema:"flowdesk-r/1",name:a.name,samples:d.samples,gates:[],selectedGate:"root",notes:"",
    importWarnings:d.warnings,worksheets:[],activeWorksheet:""};
  return project;
});
tool("get_project", "Read the complete current project: sample channels, compensation, gate definitions and worksheet layouts.", {}, () => current(), true);
tool("load_project", "Load and validate a FlowDesk JSON project; does not read desktop unsaved state.", {
  path:pathSchema, replace:z.boolean().default(false)
}, async a => {
  if (project && !a.replace) throw new Error("Session has a project; save it or set replace:true");
  const p = await rcall({action:"load",path:a.path}); project=p; return project;
});
tool("save_project", "Save the MCP project as desktop-compatible JSON. Open it in FlowDesk to view/edit it.", {
  path:pathSchema, overwrite:z.boolean().default(false)
}, async a => { current(); await writable(a.path,a.overwrite); return rcall({action:"save",project,path:a.path}); });
tool("import_samples", "Import FCS files or a DIVA folder into this session; returns channel metadata and import warnings. DIVA gate XML is not restored.", {
  paths:z.array(pathSchema).min(1)
}, async a => {
  current();
  const d = await rcall({action:"import",paths:a.paths});
  for (const s of d.samples) { if (project.samples.some(old => old.id === s.id)) s.id=randomUUID(); }
  project.samples.push(...d.samples);
  project.importWarnings = [...(project.importWarnings ?? []), ...(d.warnings ?? [])];
  project.divaMetadata = [...(project.divaMetadata ?? []), ...(d.divaMetadata ?? [])];
  return d;
});
tool("put_worksheet", "Create or replace a worksheet by id. Global plots must use sampleId active; Normal plots must bind concrete samples. Arrays replace the whole sheet. Axis min/max should be shared for comparisons.", {
  id:z.string().min(1),name:z.string().min(1),mode:z.enum(["global","normal"]),plots:z.array(plot),
  sampleId:z.string().describe("Sample used to validate Global plots")
}, async a => {
  sample(a.sampleId);
  if (new Set(a.plots.map(p=>p.id)).size !== a.plots.length) throw new Error("Duplicate plot ids");
  for (const p of a.plots) {
    if (a.mode === "global" && p.sampleId !== "active") throw new Error("Global requires active sample bindings");
    if (a.mode === "normal") sample(p.sampleId);
  }
  const check = await rcall({action:"worksheet",project:current(),sampleId:a.sampleId,plots:a.plots});
  if (Object.keys(check.errors).length) throw new Error(JSON.stringify(check.errors));
  const ws = {id:a.id,name:a.name,mode:a.mode,plots:a.plots};
  project.worksheets = [...(project.worksheets ?? []).filter(w=>w.id !== a.id),ws];
  project.activeWorksheet=a.id; return ws;
});
tool("put_gate", "Create/update a gate by id; global is default. Coordinates use transformed axis units. Rectangle/ellipse bounds=[xmin,xmax,ymin,ymax], range=[xmin,xmax]. Validates affected samples before committing.", {
  id:z.string().min(1).refine(v=>v!=="root"), name:z.string().min(1), sampleId:z.string(),
  parent:z.string().default("root"), scope:z.enum(["global","sample"]).default("global"),
  type:z.enum(["rectangle","ellipse","polygon","range","quadrant"]), x:axis,y:axis,
  bounds:z.array(z.number()).optional(), vertices:z.array(z.tuple([z.number(),z.number()])).min(3).optional(),
  center:z.tuple([z.number(),z.number()]).optional(),quadrant:z.number().int().min(1).max(4).optional()
}, async gate => {
  sample(gate.sampleId);
  if (["rectangle","ellipse"].includes(gate.type) && (gate.bounds?.length!==4 || gate.bounds[0]>=gate.bounds[1] || gate.bounds[2]>=gate.bounds[3])) throw new Error("Invalid rectangular bounds");
  if (gate.type==="range" && (gate.bounds?.length!==2 || gate.bounds[0]>=gate.bounds[1])) throw new Error("Invalid range bounds");
  if (gate.type==="polygon" && !gate.vertices) throw new Error("Polygon vertices required");
  if (gate.type==="quadrant" && (!gate.center || !gate.quadrant)) throw new Error("Quadrant center and quadrant required");
  const p=structuredClone(current());
  p.gates=[...p.gates.filter(g=>g.id!==gate.id),gate];
  await validate(p); project=p; return gate;
});
tool("set_compensation", "Replace a sample's spillover matrix; rows are source detectors, columns measured detectors; values are fractions (0.01=1%), not percentages. Validates with flowCore before committing.", {
  sampleId:z.string(), enabled:z.boolean(), channels:z.array(z.string()).min(1),values:z.array(z.array(z.number()))
}, async a => {
  const p=structuredClone(current()),s=sample(a.sampleId,p);
  if (new Set(a.channels).size!==a.channels.length || a.values.length!==a.channels.length || a.values.some(r=>r.length!==a.channels.length)) throw new Error("Matrix must be square with unique channels");
  s.compensation={enabled:a.enabled,channels:a.channels,values:a.values};
  // Validate even disabled matrices by applying them to a temporary project.
  const check=structuredClone(p); sample(a.sampleId,check).compensation.enabled=true;
  await validate(check,[a.sampleId]); project=p; return s.compensation;
});
tool("analyze", "Calculate full-event population counts/percentages/medians. Optional worksheet returns compact plot ranges/counts; event arrays are omitted.", {
  sampleId:z.string(), worksheetId:z.string().optional()
}, async a => {
  sample(a.sampleId);
  return compact(await rcall(a.worksheetId ? {action:"worksheet",project,sampleId:a.sampleId,plots:worksheet(a.worksheetId).plots}
    : {action:"analyze",project,sampleId:a.sampleId}));
}, true);
tool("export", "Export statistics CSV, worksheet PDF, all-samples PDF, or one plot SVG/PDF using current session. A worksheet and sample are required except for CSV.", {
  format:z.enum(["csv","worksheet_pdf","worksheet_report_pdf","plot_pdf","plot_svg"]),
  path:pathSchema, sampleId:z.string().optional(),worksheetId:z.string().optional(),plotId:z.string().optional(),
  includePlots:z.boolean().default(true),includeStatistics:z.boolean().default(true),includeCompensation:z.boolean().default(false),
  overwrite:z.boolean().default(false)
}, async a => {
  current();
  const extension=a.format==="csv"?".csv":a.format==="plot_svg"?".svg":".pdf";
  if (!a.path.toLowerCase().endsWith(extension)) throw new Error("Output must end with "+extension);
  await writable(a.path,a.overwrite);
  if (a.format==="csv") {
    if (a.sampleId) sample(a.sampleId);
    return rcall({action:"statistics_csv",project,path:a.path,sampleIds:a.sampleId?[a.sampleId]:undefined});
  }
  sample(a.sampleId);
  const ws=worksheet(a.worksheetId);
  const plots=a.format.startsWith("plot_") ? ws.plots.filter(p=>p.id===a.plotId) : ws.plots;
  if (!plots.length) throw new Error("No matching plots");
  return rcall({...a,action:a.format,project,plots,worksheetName:ws.name});
});
process.stdin.on("end",()=>{ for (const child of children) child.kill(); });
for (const signal of ["SIGINT","SIGTERM"]) process.on(signal,()=>{ for(const child of children) child.kill(); process.exit(0); });
await server.connect(new StdioServerTransport());

