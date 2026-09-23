import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync } from "node:fs";

const output = ts.transpileModule(readFileSync("src/gate-hit.ts", "utf8"), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const { gateContains } = await import(
  "data:text/javascript;base64," + Buffer.from(output).toString("base64")
);

const gate = (type, shape = {}) => ({ type, ...shape });

test("rectangle includes its boundary and excludes points outside either axis", () => {
  const rectangle = gate("rectangle", { bounds: [1, 4, -2, 3] });
  assert.equal(gateContains(rectangle, [2, 0]), true);
  assert.equal(gateContains(rectangle, [1, 3]), true);
  assert.equal(gateContains(rectangle, [0.999, 0]), false);
  assert.equal(gateContains(rectangle, [2, 3.001]), false);
});

test("ellipse excludes bounding-box corners while retaining center and edge", () => {
  const ellipse = gate("ellipse", { bounds: [0, 4, 0, 2] });
  assert.equal(gateContains(ellipse, [2, 1]), true);
  assert.equal(gateContains(ellipse, [4, 1]), true);
  assert.equal(gateContains(ellipse, [0.1, 0.1]), false);
  assert.equal(gateContains(ellipse, [3.9, 1.9]), false);
});

test("concave polygon includes both arms and excludes its cutout", () => {
  const polygon = gate("polygon", {
    vertices: [
      [0, 0],
      [3, 0],
      [3, 1],
      [1, 1],
      [1, 3],
      [0, 3],
    ],
  });
  assert.equal(gateContains(polygon, [2.5, 0.5]), true);
  assert.equal(gateContains(polygon, [0.5, 2.5]), true);
  assert.equal(gateContains(polygon, [2, 2]), false);
  assert.equal(gateContains(polygon, [-0.1, 0.5]), false);
});

test("range membership depends only on x and includes both endpoints", () => {
  const range = gate("range", { bounds: [-3, 7] });
  assert.equal(gateContains(range, [-3, -1e12]), true);
  assert.equal(gateContains(range, [7, 1e12]), true);
  assert.equal(gateContains(range, [0, Number.NaN]), true);
  assert.equal(gateContains(range, [7.001, 0]), false);
});

test("quadrants partition every point exclusively, including center lines", () => {
  const quadrants = [1, 2, 3, 4].map((quadrant) =>
    gate("quadrant", { center: [10, 20], quadrant }),
  );
  const cases = [
    { point: [9, 21], expected: 1 },
    { point: [11, 21], expected: 2 },
    { point: [9, 19], expected: 3 },
    { point: [11, 19], expected: 4 },
    { point: [10, 20], expected: 2 },
    { point: [10, 19], expected: 4 },
    { point: [9, 20], expected: 1 },
  ];
  for (const { point, expected } of cases) {
    const hits = quadrants
      .filter((quadrant) => gateContains(quadrant, point))
      .map((quadrant) => quadrant.quadrant);
    assert.deepEqual(hits, [expected], `${point} belongs to exactly quadrant ${expected}`);
  }
});
