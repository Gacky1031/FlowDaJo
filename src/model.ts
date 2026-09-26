import type {
  Axis,
  Gate,
  Project,
  Sample,
  CompensationWidget,
  StatisticsWidget,
  Worksheet,
  WorksheetPlot,
  WorksheetTemplate,
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
export function createWorksheetTemplate(p: Project, worksheet: Worksheet, activeSampleId: string): WorksheetTemplate {
  const sourceIds = new Set<string>();
  const addSource = (id?: string) => sourceIds.add(!id || id === "active" ? activeSampleId : id);
  if (worksheet.mode !== "normal") addSource(activeSampleId);
  for (const plot of worksheet.plots) addSource(plot.sampleId);
  for (const widget of worksheet.widgets ?? []) addSource(widget.sampleId);
  const needed = new Set<string>();
  const includeAncestors = (id: string) => {
    while (id !== "root" && !needed.has(id)) {
      const gate = p.gates.find((item) => item.id === id);
      if (!gate) throw Error(`テンプレートの分画IDが見つかりません: ${id}`);
      needed.add(id);
      id = gate.parent;
    }
  };
  for (const plot of worksheet.plots) {
    const sid = plot.sampleId === "active" ? activeSampleId : plot.sampleId;
    const populationId = resolveGate(p, plot.population, sid);
    if (populationId === undefined) throw Error(`分画が見つかりません: ${plot.population.join(" / ")}`);
    includeAncestors(populationId);
    for (const gate of p.gates) {
      if (!gateAppliesToSample(gate, sid)) continue;
      const path = pathFor(p, gate.id, sid);
      if (plot.population.every((part, index) => path[index] === part)) includeAncestors(gate.id);
    }
    for (const id of plot.displayGates ?? []) includeAncestors(id);
  }
  for (const widget of worksheet.widgets ?? []) {
    if (widget.type === "compensation") continue;
    const sid = !widget.sampleId || widget.sampleId === "active" ? activeSampleId : widget.sampleId;
    for (const gate of p.gates) if (gateAppliesToSample(gate, sid)) includeAncestors(gate.id);
  }
  let prior = -1;
  while (prior !== needed.size) {
    prior = needed.size;
    for (const gate of p.gates) {
      if (!needed.has(gate.id) || !gate.groupId) continue;
      for (const peer of p.gates) if (peer.groupId === gate.groupId &&
          gateScope(peer) === gateScope(gate) &&
          (gateScope(gate) === "global" || peer.sampleId === gate.sampleId))
        includeAncestors(peer.id);
    }
  }
  const gates = p.gates.filter((gate) => needed.has(gate.id));
  for (const gate of gates) if (gateScope(gate) === "sample") sourceIds.add(gate.sampleId);
  const bindings = [...sourceIds].map((id) => {
    const sample = p.samples.find((item) => item.id === id);
    if (!sample) throw Error(`テンプレート元のサンプルが見つかりません: ${id}`);
    return { id, name: sample.name, channels: structuredClone(sample.channels) };
  });
  return {
    schema: "flowdesk-worksheet-template/1", name: p.name,
    worksheet: structuredClone(worksheet), gateDefinitions: structuredClone(gates),
    sampleBindings: bindings,
  };
}
export function templateSourceIds(template: WorksheetTemplate): string[] {
  return [...new Set([
    ...(template.sampleBindings ?? []).map((item) => item.id),
    ...template.worksheet.plots.map((item) => item.sampleId).filter((id) => id !== "active"),
    ...(template.worksheet.widgets ?? []).map((item) => item.sampleId).filter((id): id is string => !!id && id !== "active"),
    ...template.gateDefinitions.filter((gate) => gateScope(gate) === "sample").map((gate) => gate.sampleId),
  ])];
}
export function templateChannels(template: WorksheetTemplate): string[] {
  const channels = new Set<string>();
  const add = (axis: Axis) => { if (axis.channel) channels.add(axis.channel); };
  for (const plot of template.worksheet.plots) { add(plot.x); add(plot.y); }
  for (const gate of template.gateDefinitions) { add(gate.x); add(gate.y); }
  for (const widget of template.worksheet.widgets ?? []) if (widget.type !== "compensation")
    for (const channel of widget.mfiChannels ?? []) channels.add(channel);
  return [...channels];
}
export function applyWorksheetTemplate(
  p: Project, template: WorksheetTemplate, sampleMap: Record<string, string>,
  channelMap: Record<string, string>, activeSampleId: string,
): { worksheet: Worksheet; gates: Gate[] } {
  if (template?.schema !== "flowdesk-worksheet-template/1" || !template.worksheet ||
      !Array.isArray(template.worksheet.plots) || !Array.isArray(template.gateDefinitions))
    throw Error("ワークシートテンプレートの形式が正しくありません。");
  if (!p.samples.length) throw Error("先に適用先のサンプルを読み込んでください。");
  const target = (id: string) => {
    const mapped = id === "active" ? activeSampleId : sampleMap[id];
    if (!p.samples.some((item) => item.id === mapped)) throw Error(`サンプルの対応がありません: ${id}`);
    return mapped;
  };
  for (const id of templateSourceIds(template)) target(id);
  const mappedChannel = (channel: string) => {
    const mapped = channelMap[channel];
    if (!mapped) throw Error(`検出器の対応がありません: ${channel}`);
    return mapped;
  };
  const usedSamples = new Set<string>(templateSourceIds(template).map(target));
  usedSamples.add(activeSampleId);
  if (template.gateDefinitions.some((gate) => gateScope(gate) === "global"))
    for (const sample of p.samples) usedSamples.add(sample.id);
  for (const channel of templateChannels(template)) {
    const mapped = mappedChannel(channel);
    for (const id of usedSamples) {
      const sample = p.samples.find((item) => item.id === id)!;
      if (!sample.channels.some((item) => item.id === mapped))
        throw Error(`${sample.name} に検出器 ${mapped} がありません（元: ${channel}）。`);
    }
  }
  const remapAxis = (axis: Axis) => ({ ...axis, channel: mappedChannel(axis.channel) });
  const remapped = new Map<string, string>();
  const additions: Gate[] = [];
  const groups = new Map<string, string>();
  let pending = [...template.gateDefinitions];
  while (pending.length) {
    const rest: Gate[] = [];
    let progress = false;
    for (const source of pending) {
      const parent = source.parent === "root" ? "root" : remapped.get(source.parent);
      if (!parent) { rest.push(source); continue; }
      const scope = gateScope(source);
      const sampleId = scope === "global" ? (sampleMap[source.sampleId] ?? activeSampleId) : target(source.sampleId);
      const gate: Gate = {
        ...structuredClone(source), id: uid(), parent, sampleId, scope,
        x: remapAxis(source.x), y: remapAxis(source.y),
        ...(source.groupId ? { groupId: groups.get(source.groupId) ?? (() => {
          const id = uid(); groups.set(source.groupId!, id); return id;
        })() } : {}),
      };
      delete gate.divaSourceId;
      delete gate.divaTemplate;
      const overlapping = [...p.gates, ...additions].filter((item) =>
        item.parent === parent && item.name === gate.name &&
        (scope === "global" || gateScope(item) === "global" || item.sampleId === sampleId));
      if (overlapping.length) {
        const sameShape = (item: Gate) => JSON.stringify([
          item.type, item.x, item.y, item.bounds, item.vertices, item.center,
          item.quadrant, item.edgeExtent,
        ]);
        const reusable = overlapping.length === 1 && gateScope(overlapping[0]) === scope &&
          (scope === "global" || overlapping[0].sampleId === sampleId) &&
          sameShape(overlapping[0]) === sameShape(gate);
        if (!reusable) throw Error(`分画「${gate.name}」が既存分画と衝突します。元の分画を確認してください。`);
        remapped.set(source.id, overlapping[0].id);
      } else {
        additions.push(gate);
        remapped.set(source.id, gate.id);
      }
      progress = true;
    }
    if (!progress) throw Error("テンプレートの分画階層に欠落または循環があります。");
    pending = rest;
  }
  const worksheet = structuredClone(template.worksheet);
  worksheet.id = uid();
  delete worksheet.divaSourceId;
  delete worksheet.divaTemplate;
  const names = new Set((p.worksheets ?? []).map((item) => item.name));
  const baseName = worksheet.name || "Worksheet";
  let name = baseName, n = 2;
  while (names.has(name)) name = `${baseName} (${n++})`;
  worksheet.name = name;
  worksheet.plots = worksheet.plots.map((plot) => ({
    ...plot, id: uid(), x: remapAxis(plot.x), y: remapAxis(plot.y),
    sampleId: worksheet.mode === "normal" ? target(plot.sampleId) : "active",
    displayGates: (plot.displayGates ?? []).map((id) => {
      const mapped = remapped.get(id);
      if (!mapped) throw Error(`表示ゲートの対応がありません: ${id}`);
      return mapped;
    }),
  }));
  worksheet.widgets = (worksheet.widgets ?? []).map((widget) => ({
    ...widget, id: uid(), sampleId: worksheet.mode === "normal" ? target(widget.sampleId ?? "active") : "active",
    ...(widget.type === "compensation"
      ? { targetSampleIds: (widget.targetSampleIds ?? []).map(target), visibleChannels: widget.visibleChannels?.map(mappedChannel) }
      : { mfiChannels: (widget.mfiChannels ?? []).map(mappedChannel) }),
  }));
  worksheet.printPages = (worksheet.printPages ?? []).map((page) => ({ ...page, id: uid() }));
  return { worksheet, gates: additions };
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
