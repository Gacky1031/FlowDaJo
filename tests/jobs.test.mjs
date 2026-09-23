import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync } from "node:fs";
const output = ts.transpileModule(readFileSync("src/jobs.ts", "utf8"), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const { LatestJob } = await import(
  "data:text/javascript;base64," + Buffer.from(output).toString("base64")
);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
test("latest job coalesces rapid changes and never publishes stale results", async () => {
  const calls = [],
    results = [],
    errors = [];
  let active = 0,
    max = 0;
  const job = new LatestJob(
    async (value) => {
      calls.push(value);
      max = Math.max(max, ++active);
      await delay(130);
      active--;
      if (value === 4) throw Error("invalid");
      return value;
    },
    (v) => results.push(v),
    (e) => errors.push(e.message),
    () => {},
  );
  job.submit(1);
  await delay(90);
  job.submit(2);
  job.submit(3);
  await delay(350);
  assert.deepEqual(calls, [1, 3]);
  assert.deepEqual(results, [3]);
  assert.equal(max, 1);
  job.submit(4);
  await delay(250);
  assert.deepEqual(errors, ["invalid"]);
  job.submit(5);
  await delay(90);
  job.invalidate();
  await delay(180);
  assert.deepEqual(results, [3]);
  job.submit(6);
  await delay(250);
  assert.deepEqual(results, [3, 6]);
});
