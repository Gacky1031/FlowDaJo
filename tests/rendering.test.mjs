import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { rWorker } from "./r-worker.mjs";

const axis = (channel, scale = "linear") => ({ channel, scale, w: .5, t: 262144, m: 4.5, a: 0 });

test("v0.4 scientific rendering payload, gates, modes, and vector/statistics exports", async () => {
  const storage = process.env.FLOWDESK_RENDER_ARTIFACTS ? resolve("artifacts/rendering-0.4.0") : mkdtempSync(join(tmpdir(), "flowdesk-rendering-"));
  mkdirSync(storage,{recursive:true});
  const w = rWorker(storage);
  try {
    const sample = (await w.call({ action: "demo" })).samples[0];
    const project = { schema: "flowdesk-r/1", name: "Rendering", samples: [sample], gates: [], selectedGate: "root" };
    const base = { sampleId: "active", population: [], left: 0, top: 0, width: 300, height: 250,
      x: axis("FITC-A", "log"), y: axis("PE-A", "logicle"), bins: 96, contourPercent: 10 };
    const modes = ["scatter", "histogram", "cdf", "density", "contour", "pseudocolor", "zebra"];
    const plots = modes.map((mode, i) => ({
      ...structuredClone(base), id: mode, mode,
      // Keep every card inside the default A4 safe area, matching the UI grid.
      left: 16 + (i % 3) * 360,
      top: 16 + Math.floor(i / 3) * 250,
    }));
    const result = await w.call({ action: "worksheet", project, sampleId: sample.id, plots });
    assert.deepEqual(result.errors, []);
    for (const mode of modes) assert.equal(result.plots[mode].mode, mode);
    const scatter = result.plots.scatter;
    assert.equal(scatter.excluded, 0, "nonpositive log intensities are pinned to the plot edge");
    assert.equal(scatter.total, 16000);
    assert.ok(scatter.xTicks.some(t => t.value === 3 && t.label === "10³"));
    assert.ok(scatter.xTicks.some(t => t.major === false && t.label === ""), "log scale includes unlabeled minor ticks");
    assert.ok(scatter.xTicks.every(t => !t.label.includes("e") && !t.label.includes("E")));
    assert.ok(result.plots.histogram.excluded > 0, "histogram still excludes undefined logarithms");
    assert.equal(result.plots.histogram.histogram.rawCounts.reduce((a,b) => a+b, 0), 16000 - result.plots.histogram.excluded);
    assert.ok(Math.abs(result.plots.cdf.cdf.y.at(-1) - 100) < 1e-12);
    for (const mode of ["density", "contour", "pseudocolor", "zebra"]) {
      const d = result.plots[mode].density;
      assert.equal(d.x.length, 96); assert.equal(d.y.length, 96); assert.equal(d.z.length, 96 * 96);
      assert.ok(Math.abs(d.z.reduce((a,b) => a+b, 0) - (16000 - result.plots[mode].excluded)) < 1e-5);
      assert.ok(d.contours.length > 0);
      assert.ok(d.levels.length > 1, "scalar contour spacing produces a contour series");
    }
    assert.equal(result.plots.pseudocolor.pointDensity.length, result.plots.pseudocolor.xValues.length);
    const narrow = await w.call({ action: "worksheet", project, sampleId: sample.id,
      plots: [{ ...base, id: "narrow", mode: "scatter", x: { ...base.x, min: 1, max: 2 }, y: { ...base.y, min: 0, max: 3 } }] });
    assert.deepEqual(narrow.errors, []);
    assert.ok(narrow.plots.narrow.xValues.some(v => v > 2), "out-of-range events remain in the dot payload for edge rendering");
    const preview = await w.call({ action: "axis_preview", project, sampleId: sample.id, population: [],
      axis: { ...base.x, min: 1, max: 2 } });
    assert.equal(preview.counts.length, 64);
    assert.ok(preview.outside > 0);
    assert.ok(preview.ticks.some(t => t.major === false));
    const linearPreview = await w.call({ action: "axis_preview", project, sampleId: sample.id, population: [],
      axis: { ...axis("FSC-A"), min: 0, max: 200000 } });
    assert.ok(linearPreview.ticks.some(t => t.label === "100,000"), "linear ticks use ordinary numbers");

    project.gates.push({ id: "positive", name: "Positive", sampleId: sample.id, parent: "root", type: "range",
      x: axis("FITC-A", "log"), y: axis("PE-A", "logicle"), bounds: [-10, 6] });
    const gated = await w.call({ action: "worksheet", project, sampleId: sample.id,
      plots: [{ ...base, id: "gated", mode: "histogram", population: ["Positive"] }] });
    assert.deepEqual(gated.errors, []);
    assert.equal(gated.plots.gated.total, 16000 - result.plots.histogram.excluded, "log range gate rejects nonpositive raw values unless extended to the edge");

    project.gates.push({ id: "empty", name: "Empty", sampleId: sample.id, parent: "root", type: "range",
      x: axis("FITC-A", "log"), y: axis("PE-A", "logicle"), bounds: [99, 100] });
    const empty = await w.call({ action: "worksheet", project, sampleId: sample.id,
      plots: [{ ...base, id: "empty-density", mode: "density", population: ["Empty"] }] });
    assert.deepEqual(empty.errors, []); assert.deepEqual(empty.plots["empty-density"].xRange, [0, 1]);
    assert.ok(empty.plots["empty-density"].density.z.every(Number.isFinite));

    const modeHistogram = await w.call({ action: "worksheet", project, sampleId: sample.id,
      plots: [{ ...base, id: "mode-hist", mode: "histogram", histogramNormalize: "mode" }] });
    assert.equal(Math.max(...modeHistogram.plots["mode-hist"].histogram.counts), 100);

    project.gates.push({id:"negative",name:"Negative",sampleId:sample.id,parent:"root",type:"range",x:axis("FITC-A"),y:axis("PE-A"),bounds:[-1e6,-.001]});
    const negative=await w.call({action:"worksheet",project,sampleId:sample.id,plots:[{...base,id:"negative-log",mode:"density",population:["Negative"]}]});
    assert.deepEqual(negative.errors,[]);assert.ok(negative.plots["negative-log"].total>0);assert.equal(negative.plots["negative-log"].excluded,0);assert.ok(negative.plots["negative-log"].density.z.some(v=>v>0));
    const csv = join(storage, "statistics.csv"), pdf = join(storage, "plot.pdf"), svg = join(storage, "plot.svg");
    sample.name = "=日本語";
    await w.call({ action: "statistics_csv", project, sampleIds: [sample.id], path: csv });
    await w.call({ action: "plot_pdf", project, sampleId: sample.id, plots: [plots[3]], path: pdf });
    await w.call({ action: "plot_svg", project, sampleId: sample.id, plots: [plots[4]], path: svg });
    assert.deepEqual([...readFileSync(csv).subarray(0,3)], [0xef,0xbb,0xbf]);
    const csvText = readFileSync(csv, "utf8"); assert.match(csvText, /'=日本語/u); assert.match(csvText, /"-\d/);
    assert.ok(statSync(pdf).size > 1000); assert.match(readFileSync(svg, "utf8"), /<svg/);

    const allModesPdf = join(storage, "all-modes.pdf"), report = join(storage, "report.pdf");
    await w.call({ action: "worksheet_pdf", project, sampleId: sample.id, plots, path: allModesPdf });
    const reportResult = await w.call({ action: "worksheet_report_pdf", project, sampleId: sample.id, plots, path: report,
      includeStatistics: true, includeCompensation: true });
    assert.equal(reportResult.pages, 1, "legacy appendix flags do not add report pages");
    assert.ok(statSync(allModesPdf).size > 5000); assert.ok(statSync(report).size > 1000);
  } finally { w.close(); }
});
