import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rWorker } from "./r-worker.mjs";

const output = ts.transpileModule(readFileSync("src/model.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const model = await import("data:text/javascript;base64," + Buffer.from(output).toString("base64"));
const axis = (channel) => ({ channel, scale: "linear", w: .5, t: 262144, m: 4.5, a: 0 });
const sample = (id, channels) => ({ id, name: id, kind: "demo", seed: 42, events: 10,
  channels: channels.map((value) => ({ id: value, label: value })), compensation: { enabled: false, channels: [], values: [] } });
const gate = (id, sampleId, parent, name, scope = "sample") => ({ id, sampleId, parent, name, scope,
  type: "rectangle", x: axis("FITC-A"), y: axis("PE-A"), bounds: [0, 1, 0, 1] });

test("template roundtrip maps samples/channels and includes only worksheet gate dependencies", () => {
  const source = { schema: "flowdesk-r/1", name: "source", samples: [sample("A", ["FITC-A", "PE-A"]), sample("other", ["FITC-A", "PE-A"])],
    gates: [gate("p1", "A", "root", "P1"), gate("p2", "A", "p1", "P2"), gate("irrelevant", "other", "root", "Other")],
    worksheets: [], selectedGate: "root", notes: "", importWarnings: [] };
  const worksheet = { id: "old-sheet", name: "Analysis", mode: "normal", plots: [{ id: "old-plot", sampleId: "A", population: ["P1"],
    displayGates: ["p2"], mode: "scatter", x: axis("FITC-A"), y: axis("PE-A"), left: 20, top: 40, width: 344, height: 314 }],
    widgets: [{ id: "stat", type: "statistics", sampleId: "A", left: 400, top: 40, width: 640, height: 340, mfiChannels: ["FITC-A"] }],
    printPages: [{ id: "page", left: 0, top: 0, orientation: "landscape" }] };
  const template = model.createWorksheetTemplate(source, worksheet, "A");
  assert.deepEqual(template.gateDefinitions.map((item) => item.id), ["p1", "p2"]);
  assert.deepEqual(template.sampleBindings.map((item) => item.id), ["A"]);
  const target = { ...source, samples: [sample("B", ["FITC-B", "PE-B"])], gates: [], worksheets: [] };
  const mapping = { "FITC-A": "FITC-B", "PE-A": "PE-B" };
  const applied = model.applyWorksheetTemplate(target, template, { A: "B" }, mapping, "B");
  assert.equal(applied.worksheet.plots[0].sampleId, "B");
  assert.equal(applied.worksheet.plots[0].x.channel, "FITC-B");
  assert.equal(applied.worksheet.widgets[0].mfiChannels[0], "FITC-B");
  assert.equal(applied.worksheet.printPages[0].orientation, "landscape");
  assert.notEqual(applied.worksheet.printPages[0].id, "page");
  assert.equal(applied.gates[1].parent, applied.gates[0].id);
  assert.deepEqual(applied.worksheet.plots[0].displayGates, [applied.gates[1].id]);
  target.gates = applied.gates;
  target.worksheets = [applied.worksheet];
  const again = model.applyWorksheetTemplate(target, template, { A: "B" }, mapping, "B");
  assert.equal(again.gates.length, 0, "identical gates are reused");
  assert.equal(again.worksheet.name, "Analysis (2)");
  assert.throws(() => model.applyWorksheetTemplate(target, template, { A: "B" }, { "FITC-A": "missing", "PE-A": "PE-B" }, "B"), /検出器/);
  target.gates[0].bounds = [2, 3, 2, 3];
  assert.throws(() => model.applyWorksheetTemplate(target, template, { A: "B" }, mapping, "B"), /衝突/);
});

test("R worker saves and loads the worksheet template without project sample data", async () => {
  const storage = mkdtempSync(join(tmpdir(), "flowdesk-template-"));
  const worker = rWorker(storage);
  try {
    const path = join(storage, "template.flowdesk-worksheet.json");
    const template = { schema: "flowdesk-worksheet-template/1", name: "Source",
      worksheet: { id: "s1", name: "Panel", mode: "global", plots: [] }, gateDefinitions: [],
      sampleBindings: [{ id: "a", name: "A", channels: [{ id: "FITC-A", label: "FITC" }] }] };
    await worker.call({ action: "save_template", path, template });
    const loaded = await worker.call({ action: "load_template", path });
    assert.deepEqual(loaded, template);
    assert.equal("samples" in loaded, false);
  } finally { worker.close(); }
});

test("template keeps a whole quadrant group when a sheet displays only one quadrant", () => {
  const source = { schema: "flowdesk-r/1", name: "Quadrants", samples: [sample("A", ["FITC-A", "PE-A"])],
    gates: [{ ...gate("q1", "A", "root", "Q1"), groupId: "four" },
      { ...gate("q2", "A", "root", "Q2"), groupId: "four" }],
    worksheets: [], selectedGate: "root", notes: "", importWarnings: [] };
  const worksheet = { id: "s", name: "Single quadrant", mode: "normal", plots: [{ id: "p", sampleId: "A", population: ["Q1"], mode: "scatter",
    x: axis("FITC-A"), y: axis("PE-A"), left: 0, top: 0, width: 344, height: 314 }] };
  const template = model.createWorksheetTemplate(source, worksheet, "A");
  assert.deepEqual(template.gateDefinitions.map((item) => item.id), ["q1", "q2"]);
});
