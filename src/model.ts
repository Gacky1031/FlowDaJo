import type {
  Axis,
  Gate,
  Project,
  Sample,
  Worksheet,
  WorksheetPlot,
} from "./types";
export const uid = () => crypto.randomUUID();
export const populationPalette = [
  "#17699b", "#c33c54", "#26836b", "#9b5d16", "#7156a5", "#007f92", "#bd4b8a", "#52713d",
];
export const axis = (channel: string): Axis => ({
  channel,
  scale: /^(FSC|SSC|Time)/i.test(channel) ? "linear" : "logicle",
  w: 0.5,
  t: 262144,
  m: 4.5,
  a: 0,
});
export const axisKey = (a: Axis) =>
  JSON.stringify([a.channel, a.scale, a.w, a.t, a.m, a.a]);
export const gateScope = (g: Gate): "global" | "sample" =>
  g.scope === "global" ? "global" : "sample";
export const gateAppliesToSample = (g: Gate, sampleId: string) =>
  g.scope === "global" || g.sampleId === sampleId;
export function pathFor(p: Project, id: string, sampleId: string): string[] {
  const path: string[] = [];
  const visited = new Set<string>();
  while (id !== "root") {
    const g = p.gates.find(
      (g) => g.id === id && gateAppliesToSample(g, sampleId),
    );
    if (!g || visited.has(id)) break;
    visited.add(id);
    path.unshift(g.name);
    id = g.parent;
  }
  return path;
}
export function resolveGate(p: Project, path: string[], sampleId: string) {
  let id = "root";
  for (const name of path) {
    const gates = p.gates.filter(
      (g) =>
        gateAppliesToSample(g, sampleId) && g.parent === id && g.name === name,
    );
    if (gates.length !== 1) return undefined;
    id = gates[0].id;
  }
  return id;
}
export function newPlot(
  s: Sample,
  index: number,
  population: string[] = [],
): WorksheetPlot {
  return {
    id: uid(),
    x: axis(s.channels[0].id),
    y: axis(s.channels[Math.min(1, s.channels.length - 1)].id),
    sampleId: "active",
    population,
    mode: "scatter",
    left: 24 + (index % 3) * 360,
    top: 24 + Math.floor(index / 3) * 330,
    width: 344,
    height: 314,
  };
}
export function migrate(p: Project): Project {
  p.importWarnings ??= [];
  p.notes ??= "";
  p.gates ??= [];
  p.gates.forEach((g, i) => { g.color ||= populationPalette[i % populationPalette.length]; });
  if (!p.worksheets?.length) {
    const s = p.samples[0];
    const sheet: Worksheet = { id: uid(), name: "Global worksheet", plots: [], mode: "global" };
    if (s) {
      sheet.plots = (
        s.plots ?? [
          {
            id: "initial",
            x: axis(s.channels[0].id),
            y: axis(s.channels[Math.min(1, s.channels.length - 1)].id),
          },
        ]
      ).map((plot, i) => ({ ...newPlot(s, i), x: plot.x, y: plot.y }));
    }
    p.worksheets = [sheet];
    p.activeWorksheet = sheet.id;
  }
  for (const worksheet of p.worksheets) {
    worksheet.mode ??= "global";
    worksheet.zoom ??= 1;
    worksheet.print ??= { showGateNames: false, showGatePercentages: false };
  }
  if (!p.worksheets.some((s) => s.id === p.activeWorksheet))
    p.activeWorksheet = p.worksheets[0].id;
  return p;
}
export function deleteBranch(p: Project, gate: Gate) {
  const ids = new Set([gate.id]);
  let n = 0;
  while (n !== ids.size) {
    n = ids.size;
    p.gates
      .filter(
        (g) =>
          ids.has(g.parent) &&
          (gateScope(gate) === "global" ||
            gateAppliesToSample(g, gate.sampleId)),
      )
      .forEach((g) => ids.add(g.id));
  }
  p.gates = p.gates.filter((g) => !ids.has(g.id));
  if (ids.has(p.selectedGate)) p.selectedGate = gate.parent;
}

export const oneDimensional = (p: { mode: string }) =>
  p.mode === "histogram" || p.mode === "cdf";
export const plotModes = [
  { value: "scatter", label: "Dot plot" },
  { value: "pseudocolor", label: "Pseudocolor" },
  { value: "density", label: "Density" },
  { value: "contour", label: "Contour" },
  { value: "zebra", label: "Zebra" },
  { value: "histogram", label: "Histogram" },
  { value: "cdf", label: "CDF" },
];
export const scaleLabel = (s: string) =>
  s === "linear"
    ? "Linear"
    : s === "log"
      ? "Log (10)"
      : "Biexponential (Logicle)";
