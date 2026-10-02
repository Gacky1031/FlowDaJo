import type { Axis, Gate, WorksheetData } from "./types";
import { axisKey } from "./model";

export function projectCoordinate(value: number, source: Axis, target: Axis, data: WorksheetData, inverse = false): number {
  if (axisKey(source) === axisKey(target)) return value;
  const map = data.gateAxisMaps?.find((entry) => axisKey(entry.source) === axisKey(source) && axisKey(entry.target) === axisKey(target));
  if (!map) return value;
  const from = inverse ? map.to : map.from;
  const to = inverse ? map.from : map.to;
  if (value <= from[0]) return to[0];
  if (value >= from[from.length - 1]) return to[to.length - 1];
  let low = 0, high = from.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (from[mid] <= value) low = mid; else high = mid;
  }
  const span = from[high] - from[low];
  return span > 0 ? to[low] + (value - from[low]) / span * (to[high] - to[low]) : to[high];
}

export function projectGatePoint(gate: Gate, data: WorksheetData, point: number[], inverse = false): number[] {
  return [projectCoordinate(point[0], gate.x, data.x, data, inverse),
    gate.type === "range" ? point[1] : projectCoordinate(point[1], gate.y, data.y, data, inverse)];
}

/** Keep the stored gate intact; curved outlines are only for display. */
export function projectGate(gate: Gate, data: WorksheetData): Gate {
  if (axisKey(gate.x) === axisKey(data.x) && (gate.type === "range" || axisKey(gate.y) === axisKey(data.y))) return gate;
  const result = { ...gate };
  const point = (p: number[]) => projectGatePoint(gate, data, p);
  if (gate.bounds) {
    const b = gate.bounds;
    result.bounds = [point([b[0], b[2] ?? 0])[0], point([b[1], b[3] ?? 0])[0]];
    if (gate.type !== "range") result.bounds.push(point([b[0], b[2]])[1], point([b[1], b[3]])[1]);
  }
  if (gate.center) result.center = point(gate.center);
  if (gate.type === "polygon") {
    result.vertices = gate.vertices!.flatMap((a, index, vertices) => {
      const b = vertices[(index + 1) % vertices.length];
      return Array.from({ length: 48 }, (_, i) => point([a[0] + (b[0] - a[0]) * i / 48, a[1] + (b[1] - a[1]) * i / 48]));
    });
  } else if (gate.type === "ellipse") {
    const b = gate.bounds!;
    result.vertices = Array.from({ length: 192 }, (_, i) => {
      const angle = i * Math.PI * 2 / 192;
      return point([(b[0] + b[1]) / 2 + (b[1] - b[0]) / 2 * Math.cos(angle),
        (b[2] + b[3]) / 2 + (b[3] - b[2]) / 2 * Math.sin(angle)]);
    });
  }
  return result;
}
