import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rWorker } from "./r-worker.mjs";

test("Normal worksheet retains 3 and 10 samples without rereading unchanged frames", async () => {
  const worker = rWorker(mkdtempSync(join(tmpdir(), "flowdesk-cache-")));
  try {
    const original = (await worker.call({ action: "demo" })).samples[0];
    const samples = Array.from({ length: 10 }, (_, index) => ({ ...structuredClone(original), id: `cache-${index}`, name: `Sample ${index}`, seed: 42 + index }));
    const project = { schema: "flowdesk-r/1", name: "Cache", samples, gates: [], selectedGate: "root" };
    const run = (count) => worker.call({ action: "worksheet", project, sampleId: samples[0].id,
      plots: [], widgets: samples.slice(0, count).map((item) => ({ id: item.id, type: "statistics", sampleId: item.id })) });
    await run(3);
    const first = (await worker.call({ action: "health" })).cache;
    assert.equal(first.rawReads, 3);
    await run(3);
    const again = (await worker.call({ action: "health" })).cache;
    assert.equal(again.rawReads, first.rawReads);
    assert.equal(again.maskBuilds, first.maskBuilds);
    await run(10);
    const ten = (await worker.call({ action: "health" })).cache;
    assert.equal(ten.rawReads, 10);
    assert.equal(ten.entries, 10);
    assert.ok(ten.bytes <= ten.budgetBytes);
    await run(10);
    const repeat = (await worker.call({ action: "health" })).cache;
    assert.equal(repeat.rawReads, 10);
    assert.ok(repeat.rawHits >= 13);
    project.gates.push({ id: "local", sampleId: samples[0].id, scope: "sample", parent: "root", name: "P1", type: "rectangle",
      x: { channel: "FSC-A", scale: "linear", w: .5, t: 262144, m: 4.5, a: 0 },
      y: { channel: "SSC-A", scale: "linear", w: .5, t: 262144, m: 4.5, a: 0 }, bounds: [0, 200000, 0, 200000] });
    await run(10);
    const changed = (await worker.call({ action: "health" })).cache;
    assert.equal(changed.rawReads, 10);
    assert.equal(changed.maskBuilds, repeat.maskBuilds + 1);
  } finally { worker.close(); }
});
