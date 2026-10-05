import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { rWorker } from "./r-worker.mjs";
import { tsModuleUrl } from "./ts-module.mjs";
const histogram = await import(tsModuleUrl("src/histogram.ts"));
const model = await import(tsModuleUrl("src/model.ts"));
const axis = (channel, scale = "linear") => ({ channel, scale, w: .5, t: 262144, m: 4.5, a: 0 });
const plot = (sampleId = "A") => ({ id: sampleId, sampleId, mode: "histogram", population: [], x: axis("FITC-A", "logicle"), y: axis("PE-A"), left: 24, top: 24, width: 540, height: 410 });

test("histogram merging, overrides, either-side controls and template binding roundtrip", () => {
  const base = plot(); const source = plot("B"); source.histogramColor = "#c33c54";
  assert.equal(histogram.mergeHistograms(base, source), true);
  const overlay = base.histogramOverlays[0];
  assert.equal(overlay.sampleId, "B"); assert.equal(overlay.color, "#c33c54");
  base.histogramControl = "primary";
  assert.equal(histogram.histogramExpansionOwner(base), "B");
  let copy = histogram.expandHistogram(base, "C");
  assert.equal(copy.sampleId, "A"); assert.equal(copy.histogramOverlays[0].sampleId, "C");
  base.histogramControl = overlay.id;
  copy = histogram.expandHistogram(base, "C");
  assert.equal(copy.sampleId, "C"); assert.equal(copy.histogramOverlays[0].sampleId, "B");
  assert.equal(copy.histogramOverlays[0].color, "#c33c54");
  assert.equal(base.sampleId, "A"); assert.equal(base.histogramOverlays[0].sampleId, "B");
  assert.equal(histogram.mergeHistograms(base, { ...source, x: axis("PE-A") }), false);
  const samples = ["A", "B"].map((id) => ({ id, name: id, channels: [{ id: "FITC-A" }, { id: "PE-A" }] }));
  const project = { schema: "flowdesk-r/1", name: "Test", samples, gates: [], worksheets: [] };
  const sheet = { id: "normal", name: "Comparison", mode: "normal", plots: [base] };
  const template = model.createWorksheetTemplate(project, sheet, "A");
  assert.deepEqual(model.templateSourceIds(template), ["A", "B"]);
  const target = { ...project, samples: samples.map((sample) => ({ ...sample, id: sample.id + "2" })) };
  const applied = model.applyWorksheetTemplate(target, template, { A: "A2", B: "B2" }, { "FITC-A": "FITC-A", "PE-A": "PE-A" }, "A2").worksheet.plots[0];
  assert.equal(applied.sampleId, "A2"); assert.equal(applied.histogramOverlays[0].sampleId, "B2");
  assert.equal(applied.histogramControl, applied.histogramOverlays[0].id);
  assert.notEqual(applied.histogramControl, overlay.id);
});

test("shared bins, mass-preserving smoothing, normalization, control labels and vector exports use all populations", async () => {
  const storage = process.env.FLOWDESK_HISTOGRAM_ARTIFACTS ? resolve("artifacts/histograms") : mkdtempSync(join(tmpdir(), "flowdajo-histogram-"));
  mkdirSync(storage, { recursive: true });
  const worker = rWorker(storage);
  try {
    const first = (await worker.call({ action: "demo" })).samples[0];
    first.id = "A"; first.name = "Control";
    const second = structuredClone(first); second.id = "B"; second.name = "Treatment"; second.seed = 77;
    const project = { schema: "flowdesk-r/1", name: "Histogram comparison", samples: [first, second], gates: [], selectedGate: "root" };
    const base = { ...plot(), bins: 128, histogramControl: "primary", histogramOverlays: [{ id: "second", sampleId: "B", population: [], color: "#c33c54" }] };
    const get = async (card) => {
      const result = await worker.call({ action: "worksheet", project, sampleId: "A", plots: [card] });
      assert.deepEqual(result.errors, []); return result.plots[card.id];
    };
    const raw = await get(base); const smooth = await get({ ...base, histogramSmoothing: true });
    assert.equal(raw.histogramSeries.length, 2);
    assert.deepEqual(raw.histogramSeries[0].edges, raw.histogramSeries[1].edges);
    assert.equal(raw.histogramSeries[0].control, true); assert.equal(raw.histogramSeries[0].color, "#666666");
    assert.equal(raw.histogramSeries[1].color, "#c33c54");
    for (let i = 0; i < 2; i++) {
      const r = raw.histogramSeries[i], s = smooth.histogramSeries[i];
      assert.equal(r.total, 16000); assert.equal(r.rawCounts.reduce((a,b) => a+b, 0), 16000);
      assert.deepEqual(r.rawCounts, s.rawCounts); assert.notDeepEqual(r.counts, s.counts);
      assert.ok(Math.abs(s.counts.reduce((a,b) => a+b, 0) - 16000) < 1e-8);
    }
    for (const normalization of ["max", "mode"]) {
      const normalized = await get({ ...base, histogramSmoothing: true, histogramNormalize: normalization });
      for (const source of normalized.histogramSeries) assert.ok(Math.abs(Math.max(...source.counts) - 100) < 1e-10);
    }
    const percent = await get({ ...base, histogramNormalize: "percent" });
    for (const source of percent.histogramSeries) assert.ok(Math.abs(source.counts.reduce((a,b) => a+b, 0) - 100) < 1e-10);
    const missing = await get({ ...base, histogramOverlays: [{ id: "bad", sampleId: "B", population: ["Absent"] }] });
    assert.match(missing.histogramSeries[1].error, /Population/); assert.equal(missing.histogramSeries[0].total, 16000);
    project.gates.push({ id: "subsetB", name: "Subset", parent: "root", sampleId: "B", scope: "sample", type: "range", x: axis("FITC-A", "logicle"), y: axis("PE-A"), bounds: [0, 2.3] });
    const subset = await get({ ...base, histogramOverlays: [{ id: "subset", sampleId: "B", population: ["Subset"] }] });
    const standalone = await get({ ...plot("B"), population: ["Subset"] });
    assert.equal(subset.histogramSeries[0].total, 16000);
    assert.ok(subset.histogramSeries[1].total > 0 && subset.histogramSeries[1].total < 16000);
    assert.equal(subset.histogramSeries[1].total, standalone.total);
    for (const type of ["pdf", "svg"]) {
      const path = join(storage, "comparison." + type);
      await worker.call({ action: "plot_" + type, project, sampleId: "A", plots: [{ ...base, histogramSmoothing: true, histogramNormalize: "mode" }], path });
      assert.ok(statSync(path).size > 1000);
    }
    const worksheetPath = join(storage, "comparison-worksheet.pdf");
    await worker.call({ action: "worksheet_pdf", project, sampleId: "A", plots: [{ ...base, width: 344, height: 314, histogramNormalize: "mode" }], printPages: [{ id: "a4", left: 0, top: 0, orientation: "landscape", scale: 1 }], path: worksheetPath });
    assert.ok(statSync(worksheetPath).size > 1000);
  } finally { worker.close(); }
});
