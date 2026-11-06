import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rWorker } from "./r-worker.mjs";

const axis = (channel, scale = "linear") => ({ channel, scale, w: .5, t: 262144, m: 4.5, a: 0 });

test("vector export hides plot title, axis titles and ticks independently", async () => {
  const storage = mkdtempSync(join(tmpdir(), "flowdesk-annotations-"));
  const w = rWorker(storage);
  try {
    const sample = (await w.call({ action: "demo" })).samples[0];
    const project = { schema: "flowdesk-r/1", name: "Annotations", samples: [sample], gates: [], selectedGate: "root" };
    const card = { id: "p", sampleId: "active", population: [], left: 0, top: 0, width: 360, height: 300, mode: "contour",
      showOutliers: false, x: axis("FSC-A"), y: axis("SSC-A") };
    // Cairo SVG draws text as glyph references, so hidden text lowers the count.
    const glyphs = async (name, options) => {
      const path = join(storage, `${name}.svg`);
      await w.call({ action: "plot_svg", project, sampleId: sample.id, plots: [{ ...card, ...options }], path });
      return (readFileSync(path, "utf8").match(/<use xlink:href="#glyph/g) ?? []).length;
    };
    const all = await glyphs("all", {});
    const counts = {
      showPlotTitle: await glyphs("title", { showPlotTitle: false }),
      showXTitle: await glyphs("x-title", { showXTitle: false }),
      showYTitle: await glyphs("y-title", { showYTitle: false }),
      showTicks: await glyphs("ticks", { showTicks: false }),
    };
    assert.ok(all > 0);
    for (const [key, count] of Object.entries(counts)) assert.ok(count < all, `${key}: ${count} < ${all}`);
    const none = await glyphs("none", { showPlotTitle: false, showXTitle: false, showYTitle: false, showTicks: false });
    assert.equal(none, 0, "no text remains when every annotation is hidden");
  } finally { w.close(); }
});
