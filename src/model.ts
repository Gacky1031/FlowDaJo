import type {
  Axis,
  Gate,
  Project,
  Sample,
  CompensationWidget,
  StatisticsWidget,
  Worksheet,
  WorksheetPlot,
} from "./types";
export const uid = () => crypto.randomUUID();
export const populationPalette = [
  "#17699b", "#c33c54", "#26836b", "#9b5d16", "#7156a5", "#007f92",
  "#bd4b8a", "#52713d", "#b44725", "#4c65a8", "#816b19", "#a54b78",
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
export const worksheetGrid = {
  originX: 24,
  originY: 24,
  columnStep: 360,
  rowStep: 330,
};
/** A4 at 96 CSS pixels per inch. PDF rendering uses 210 × 297 mm. */
export const a4Page = {
  short: 794,
  long: 1123,
  gap: 24,
};
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
    left: worksheetGrid.originX + (index % 3) * worksheetGrid.columnStep,
    top: worksheetGrid.originY + Math.floor(index / 3) * worksheetGrid.rowStep,
    width: 344,
    height: 314,
  };
}
export function newStatisticsWidget(
  plots: WorksheetPlot[] = [],
  sampleId = "active",
): StatisticsWidget {
  const right = plots.reduce((edge, plot) => Math.max(edge, plot.left + plot.width), worksheetGrid.originX - 16);
  return {
    type: "statistics",
    id: uid(),
    sampleId,
    left: plots.length ? right + 16 : worksheetGrid.originX,
    top: plots.length ? worksheetGrid.originY : worksheetGrid.originY + worksheetGrid.rowStep,
    width: 640,
    height: 340,
    showEvents: true,
    showPercentParent: true,
    showPercentTotal: true,
    mfiChannels: [],
  };
}
export function newCompensationWidget(
  plots: WorksheetPlot[] = [],
  widgets: { left: number; top: number; width: number; height: number }[] = [],
  sampleId = "active",
): CompensationWidget {
  const occupied = [...plots, ...widgets];
  let left = worksheetGrid.originX;
  let top = worksheetGrid.originY;
  for (let row = 0; row < 100; row++) {
    for (let column = 0; column < 100; column++) {
      const candidateLeft = worksheetGrid.originX + column * worksheetGrid.columnStep;
      const candidateTop = worksheetGrid.originY + row * worksheetGrid.rowStep;
      const overlaps = occupied.some((item) =>
        candidateLeft < item.left + item.width &&
        candidateLeft + 440 > item.left &&
        candidateTop < item.top + item.height &&
        candidateTop + 360 > item.top,
      );
      if (!overlaps) {
        left = candidateLeft;
        top = candidateTop;
        row = 100;
        break;
      }
    }
  }
  return { type: "compensation", id: uid(), left, top, width: 440, height: 360, sampleId };
}
export function migrate(p: Project): Project {
  p.samples.forEach((sample, index) => { sample.importOrder ??= index; });
  p.sampleSort ??= "import";
  if (p.sampleSort === "import") p.samples.sort((a, b) => (a.importOrder ?? 0) - (b.importOrder ?? 0));
  if (p.sampleSort === "name") p.samples.sort((a, b) => a.name.localeCompare(b.name, "ja", { numeric: true }) || (a.importOrder ?? 0) - (b.importOrder ?? 0));
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
    if (!Array.isArray(worksheet.printPages) || !worksheet.printPages.length)
      worksheet.printPages = [{ id: uid(), left: 0, top: 0, orientation: "landscape" }];
    worksheet.printPages = worksheet.printPages.filter((page) =>
      Number.isFinite(page.left) && Number.isFinite(page.top) &&
      (page.orientation === "portrait" || page.orientation === "landscape"));
    for (const page of worksheet.printPages)
      page.scale = Number.isFinite(page.scale) ? Math.max(0.25, Math.min(3, page.scale!)) : 1;
    if (!worksheet.printPages.length)
      worksheet.printPages = [{ id: uid(), left: 0, top: 0, orientation: "landscape" }];
    if (!Array.isArray(worksheet.widgets))
      worksheet.widgets = [newStatisticsWidget(worksheet.plots)];
    for (const widget of worksheet.widgets) {
      if (widget.type === "compensation") {
        widget.width ??= 440;
        widget.height ??= 360;
        widget.left ??= worksheetGrid.originX;
        widget.top ??= worksheetGrid.originY;
        continue;
      }
      widget.type ??= "statistics";
      widget.showEvents ??= true;
      widget.showPercentParent ??= true;
      widget.showPercentTotal ??= true;
      widget.mfiChannels ??= [];
      widget.width ??= 640;
      widget.height ??= 340;
      widget.left ??= worksheetGrid.originX;
      widget.top ??= worksheetGrid.originY;
    }
  }
  if (!p.worksheets.some((s) => s.id === p.activeWorksheet))
    p.activeWorksheet = p.worksheets[0].id;
  return p;
}
export function deleteBranch(p: Project, gate: Gate) {
  const ids = new Set([gate.id]);
  if (gate.groupId) {
    p.gates
      .filter(
        (peer) =>
          peer.groupId === gate.groupId &&
          (gateScope(gate) === "global"
            ? gateScope(peer) === "global"
            : peer.sampleId === gate.sampleId),
      )
      .forEach((peer) => ids.add(peer.id));
  }
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
