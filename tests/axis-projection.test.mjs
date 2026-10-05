import { test } from "node:test";
import assert from "node:assert/strict";
import { tsModuleUrl } from "./ts-module.mjs";
import { readFileSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { rWorker } from "./r-worker.mjs";

const projection = await import(tsModuleUrl("src/gate-projection.ts"));
const axis = (channel, scale = "linear") => ({ channel, scale, w: .5, t: 262144, m: 4.5, a: 0 });

test("axis transforms preserve gate counts, outlines, pointer coordinates and vector exports", async () => {
  const storage = process.env.FLOWDESK_AXIS_ARTIFACTS ? resolve("artifacts/axis-projection") : mkdtempSync(join(tmpdir(), "flowdajo-axis-"));
  const worker = rWorker(storage);
  try {
    const sample = (await worker.call({ action: "demo" })).samples[0];
    const base = { sampleId: sample.id, scope: "global", parent: "root", x: axis("FSC-A"), y: axis("SSC-A"), color: "#17699b" };
    const gates = [
      { ...base, id: "rect", name: "Rectangle", type: "rectangle", bounds: [30000, 140000, 20000, 80000] },
      { ...base, id: "ellipse", name: "Ellipse", type: "ellipse", bounds: [30000, 140000, 20000, 80000] },
      { ...base, id: "polygon", name: "Polygon", type: "polygon", vertices: [[30000, 20000], [140000, 40000], [40000, 80000]] },
      ...[1, 2, 3, 4].map((q) => ({ ...base, id: "q" + q, name: "Quadrant " + q, type: "quadrant", groupId: "quadrants", quadrant: q, center: [70000, 50000] })),
      { ...base, id: "range", name: "Range", type: "range", bounds: [30000, 140000] },
    ];
    const project = { schema: "flowdesk-r/1", name: "Axis projection", samples: [sample], gates, selectedGate: "root" };
    const card = { id: "original", sampleId: "active", population: [], mode: "scatter", x: base.x, y: base.y, left: 16, top: 16, width: 500, height: 370 };
    const call = (plots) => worker.call({ action: "worksheet", project, sampleId: sample.id, plots });
    const original = await call([card]);
    const copies = ["log", "logicle"].map((scale, i) => ({ ...card, id: scale, x: axis("FSC-A", scale), y: axis("SSC-A", scale), left: 16 + i * 520 }));
    copies.push({ ...copies[0], id: "histogram", mode: "histogram", top: 410 });
    const result = await call(copies);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.stats, original.stats, "display changes never alter gate membership");
    assert.deepEqual(result.plots.log.displayGateIds, gates.filter((g) => g.type !== "range").map((g) => g.id));
    assert.deepEqual(result.plots.histogram.displayGateIds, ["range"]);
    assert.equal(result.plots.log.gateAxisMaps.length, 2);
    const rectangle = projection.projectGate(gates[0], result.plots.log);
    rectangle.bounds.forEach((value, i) => assert.ok(Math.abs(value - Math.log10(gates[0].bounds[i])) < 1e-9));
    assert.equal(projection.projectGate(gates[1], result.plots.log).vertices.length, 192);
    assert.equal(projection.projectGate(gates[2], result.plots.log).vertices.length, 144);
    for (const scale of ["log", "logicle"]) for (const point of [[30000, 20000], [95000, 45000], [140000, 80000]]) {
      const display = projection.projectGatePoint(gates[0], result.plots[scale], point);
      if (scale === "log") assert.ok(display.every((v, i) => Math.abs(v - Math.log10(point[i])) < 1e-5));
      const restored = projection.projectGatePoint(gates[0], result.plots[scale], display, true);
      assert.ok(restored.every((v, i) => Math.abs(v - point[i]) < 1e-6));
    }
    assert.deepEqual(gates[0].bounds, [30000, 140000, 20000, 80000]);
    const path = join(storage, "transformed-gates.pdf");
    await worker.call({ action: "worksheet_pdf", project, sampleId: sample.id, plots: copies, path });
    assert.ok(statSync(path).size > 1000);
    const svg = join(storage, "transformed-gates.svg");
    await worker.call({ action: "plot_svg", project, sampleId: sample.id, plots: [copies[0]], path: svg });
    assert.ok(statSync(svg).size > 1000);
    const biexGate = { ...gates[0], id: "biex", name: "Biex gate", x: copies[1].x, y: copies[1].y,
      bounds: projection.projectGate(gates[0], result.plots.logicle).bounds };
    project.gates = [biexGate];
    const reference = await call([copies[1]]);
    const changed = { ...copies[1], id: "changed", x: { ...copies[1].x, w: 1, t: 1e6, m: 5, a: .2 } };
    const reversed = await call([card, copies[0], changed]);
    assert.deepEqual(reversed.errors, []);
    assert.deepEqual(reversed.stats, reference.stats, "Logicle parameter changes preserve the original definition too");
    const raw = projection.projectGate(biexGate, reversed.plots.original);
    raw.bounds.forEach((value, i) => assert.ok(Math.abs(value - gates[0].bounds[i]) < 1e-5));
    assert.deepEqual(reversed.plots.changed.displayGateIds, ["biex"]);
  } finally { worker.close(); }
});

test("axis recommendations recover from implausible settings and explain poor current ranges", async () => {
  const worker = rWorker(mkdtempSync(join(tmpdir(), "flowdajo-axis-suggest-")));
  try {
    const sample = (await worker.call({ action: "demo" })).samples[0];
    const project = { schema: "flowdesk-r/1", name: "Recommendations", samples: [sample], gates: [], selectedGate: "root" };
    const request = { project, sampleId: sample.id, population: [] };
    const fluorescent = await worker.call({ ...request, action: "axis_suggestion", axis: { ...axis("FITC-A"), t: 1e99, min: 0, max: 1e99 } });
    assert.equal(fluorescent.axis.scale, "logicle");
    assert.ok(fluorescent.axis.t > 0 && fluorescent.axis.t < 1e10);
    assert.ok(fluorescent.axis.w >= 0 && 2 * fluorescent.axis.w <= fluorescent.axis.m);
    assert.match(fluorescent.reason, /分布/);
    const preview = await worker.call({ ...request, action: "axis_preview", axis: fluorescent.axis });
    assert.equal(preview.outside, 0);
    const bad = await worker.call({ ...request, action: "axis_preview", axis: { ...axis("FSC-A"), min: 0, max: 1e12 } });
    assert.ok(bad.warnings.some((message) => message.includes("集中")));
    const scatter = await worker.call({ ...request, action: "axis_suggestion", axis: axis("FSC-A", "log") });
    assert.equal(scatter.axis.scale, "linear");
    assert.equal(scatter.axis.min, 0);
    assert.ok(scatter.axis.max > 100000);
  } finally { worker.close(); }
});
