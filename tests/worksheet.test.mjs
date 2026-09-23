import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { rWorker } from "./r-worker.mjs";
const axis = (channel) => ({
  channel,
  scale: channel === "FSC-A" || channel === "SSC-A" ? "linear" : "logicle",
  w: 0.5,
  t: 262144,
  m: 4.5,
  a: 0,
});
test("persistent worksheet: 12 plots, cache invalidation, linked/pinned samples, histograms, errors and roundtrip", async () => {
  const storage = mkdtempSync(join(tmpdir(), "flowdesk-worksheet-")),
    w = rWorker(storage);
  try {
    const a = await w.call({ action: "health" }),
      b = await w.call({ action: "health" });
    assert.equal(a.workerPid, b.workerPid);
    const demo = await w.call({ action: "demo" });
    const first = demo.samples[0],
      second = {
        ...structuredClone(first),
        id: "other",
        seed: 19,
        name: "Second",
      };
    const project = {
      schema: "flowdesk-r/1",
      name: "Worksheet validation",
      samples: [first, second],
      gates: [],
      notes: "",
      selectedGate: "root",
    };
    const plots = Array.from({ length: 12 }, (_, i) => ({
      id: "plot" + i,
      x: axis("FSC-A"),
      y: axis("SSC-A"),
      mode: i === 11 ? "histogram" : "scatter",
      sampleId: i === 1 ? first.id : "active",
      population: [],
      left: 24 + (i % 3) * 360,
      top: 24 + Math.floor(i / 3) * 330,
      width: 344,
      height: 314,
    }));
    const request = () =>
      w.call({ action: "worksheet", project, sampleId: first.id, plots });
    const t = performance.now(),
      result = await request();
    console.log("12 plots cold ms", Math.round(performance.now() - t));
    assert.deepEqual(result.errors, []);
    assert.equal(Object.keys(result.plots).length, 12);
    assert.equal(result.stats[first.id][0].count, 16000);
    assert.equal(
      result.plots.plot11.histogram.counts.reduce((a, b) => a + b, 0),
      16000,
    );
    const gate = {
      id: "g",
      name: "Lymphocytes",
      sampleId: first.id,
      parent: "root",
      type: "rectangle",
      x: axis("FSC-A"),
      y: axis("SSC-A"),
      bounds: [10000, 80000, 0, 40000],
    };
    project.gates.push(gate);
    plots[0].population = ["Lymphocytes"];
    const before = await request();
    const count = before.plots.plot0.total;
    assert.ok(count > 0 && count < 16000);
    gate.bounds = [0, 250000, -50000, 250000];
    const after = await request();
    assert.equal(after.plots.plot0.total, 16000);
    const switched = await w.call({
      action: "worksheet",
      project,
      sampleId: "other",
      plots,
    });
    assert.match(switched.errors.plot0, /missing/);
    assert.equal(switched.plots.plot1.sampleId, first.id);
    assert.equal(switched.plots.plot2.sampleId, "other");
    plots[2].x = { ...axis("FITC-A"), min: -1, max: 5 };
    plots[2].x.w = 0.7;
    first.compensation.enabled = true;
    const updated = await request();
    assert.equal(updated.plots.plot2.compensationEnabled, true);
    assert.deepEqual(updated.plots.plot2.xRange, [-1, 5]);
    assert.equal(updated.plots.plot2.x.w, 0.7);
    plots[3].x.min = 2;
    plots[3].x.max = 1;
    const bad = await request();
    assert.match(bad.errors.plot3, /minimum/);
    assert.ok(bad.plots.plot4);
    delete plots[3].x.min;
    delete plots[3].x.max;
    project.worksheets = [{ id: "sheet1", name: "Global", plots }];
    project.activeWorksheet = "sheet1";
    const path = join(storage, "project.json");
    await w.call({ action: "save", project, path });
    const restored = await w.call({ action: "load", path });
    assert.deepEqual(restored.worksheets, project.worksheets);
    await assert.rejects(w.call({ action: "no-such-action" }));
    assert.equal((await w.call({ action: "health" })).workerPid, a.workerPid);
    if (process.env.FLOWDESK_TEST_PDF)
      await w.call({
        action: "worksheet_report_pdf",
        project: { ...project, samples: [first] },
        sampleId: first.id,
        plots,
        path: resolve("artifacts/worksheet-12-plots.pdf"),
        worksheetName: "Global worksheet",
      });
  } finally {
    w.close();
  }
});
