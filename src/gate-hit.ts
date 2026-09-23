import type { Gate } from "./types";

/** Hit testing uses the same transformed coordinates and quadrant boundaries as R. */
export function gateContains(g: Gate, point: number[]): boolean {
  const [x, y] = point;
  if (g.type === "range") return x >= g.bounds![0] && x <= g.bounds![1];
  if (g.type === "rectangle" || g.type === "ellipse") {
    const [x0, x1, y0, y1] = g.bounds!;
    if (g.type === "rectangle") return x >= x0 && x <= x1 && y >= y0 && y <= y1;
    return (
      ((x - (x0 + x1) / 2) / ((x1 - x0) / 2)) ** 2 +
        ((y - (y0 + y1) / 2) / ((y1 - y0) / 2)) ** 2 <=
      1
    );
  }
  if (g.type === "quadrant") {
    const right = x >= g.center![0],
      upper = y >= g.center![1];
    return g.quadrant === (upper ? (right ? 2 : 1) : right ? 4 : 3);
  }
  const vertices = g.vertices!;
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [xi, yi] = vertices[i],
      [xj, yj] = vertices[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
