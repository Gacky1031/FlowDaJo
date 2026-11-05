import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rWorker } from "./r-worker.mjs";

const axis = (channel, scale = "linear") => ({ channel, scale, w: .5, t: 262144, m: 4.5, a: 0 });

test("vector export draws gate outlines and labels in black only when requested", async () => {
  const storage = mkdtempSync(join(tmpdir(), "flowdesk-gate-black-"));
  const w = rWorker(storage);
  try {
    const sample = (await w.call({ action: "demo" })).samples[0];
    const gate = { id: "g1", name: "Red", sampleId: sample.id, parent: "root", type: "rectangle", color: "#ff0000",
      x: axis("FSC-A"), y: axis("SSC-A"), bounds: [20000, 120000, 10000, 100000] };
    const project = { schema: "flowdesk-r/1", name: "Black", samples: [sample], gates: [gate], selectedGate: "root" };
    const card = { id: "p", sampleId: "active", population: [], left: 0, top: 0, width: 360, height: 300, mode: "contour", showOutliers: false,
      x: axis("FSC-A"), y: axis("SSC-A"), displayGates: ["g1"] };
    const red = async (name, options) => {
      const path = join(storage, `${name}.svg`);
      await w.call({ action: "plot_svg", project, sampleId: sample.id, plots: [{ ...card, ...options }], path });
      return (readFileSync(path, "utf8").match(/rgb\(100%, 0%, 0%\)/g) ?? []).length;
    };
    const normal = await red("normal", {});
    const outlinesBlack = await red("outlines", { blackGateOutlines: true });
    const labelsBlack = await red("labels", { blackGateLabels: true });
    const bothBlack = await red("both", { blackGateOutlines: true, blackGateLabels: true });
    assert.ok(normal > 0, "gate color is used by default");
    assert.ok(outlinesBlack > 0 && outlinesBlack < normal, "outline black leaves the label color");
    assert.ok(labelsBlack > 0 && labelsBlack < normal, "label black leaves the outline color");
    assert.equal(bothBlack, 0, "no gate color remains");
  } finally { w.close(); }
});
