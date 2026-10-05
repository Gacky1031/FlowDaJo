import { test } from "node:test";
import assert from "node:assert/strict";
import { tsModuleUrl } from "./ts-module.mjs";
const { newPlot } = await import(tsModuleUrl("src/model.ts"));

test("new plots prioritize FSC-A / SSC-A regardless of channel order and spelling", () => {
  const sample = { channels: ["Time", "FITC-A", "SSC-A", "FSC-A"].map((id) => ({ id })) };
  const plot = newPlot(sample, 0, ["Lymphocytes"]);
  assert.equal(plot.x.channel, "FSC-A");
  assert.equal(plot.y.channel, "SSC-A");
  assert.deepEqual(plot.population, ["Lymphocytes"]);
  const alternate = newPlot({ channels: ["Time", "ssc_a", "FSC A"].map((id) => ({ id })) }, 0);
  assert.equal(alternate.x.channel, "FSC A");
  assert.equal(alternate.y.channel, "ssc_a");
  const missing = newPlot({ channels: [{ id: "Time" }, { id: "FSC-A" }] }, 0);
  assert.equal(missing.x.channel, "FSC-A");
  assert.equal(missing.y.channel, "Time");
  const one = newPlot({ channels: [{ id: "FITC-A" }] }, 0);
  assert.equal(one.x.channel, "FITC-A");
  assert.equal(one.y.channel, "FITC-A");
});
