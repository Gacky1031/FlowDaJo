import type { HistogramOverlay, WorksheetPlot } from "./types";

export const histogramPalette = ["#17699b", "#c33c54", "#26836b", "#7156a5", "#9b5d16", "#666666"];
export const histogramAxisLabel = (normalization?: string) =>
  normalization === "percent" ? "% of events" : normalization === "max" ? "% Max" : normalization === "mode" ? "Normalized to Mode" : "Count";
export function histogramSources(plot: WorksheetPlot): HistogramOverlay[] {
  return [{ id: "primary", sampleId: plot.sampleId, population: plot.population, color: plot.histogramColor }, ...(plot.histogramOverlays ?? [])];
}
export function histogramSeriesColor(plot: WorksheetPlot, source: HistogramOverlay, index: number): string {
  return source.color ?? (plot.histogramControl === source.id ? "#666666" : index === 0 ? plot.color ?? histogramPalette[0] : histogramPalette[index % histogramPalette.length]);
}
export function histogramExpansionOwner(plot: WorksheetPlot): string {
  return histogramSources(plot).find((source) => source.id !== plot.histogramControl)?.sampleId ?? plot.sampleId;
}
export function expandHistogram(plot: WorksheetPlot, targetSampleId: string): WorksheetPlot {
  const copy = structuredClone(plot);
  if (copy.mode !== "histogram") { copy.sampleId = targetSampleId; return copy; }
  if (copy.histogramControl !== "primary") copy.sampleId = targetSampleId;
  copy.histogramOverlays = copy.histogramOverlays?.map((source) => ({ ...source,
    sampleId: source.id === copy.histogramControl ? source.sampleId : targetSampleId,
  }));
  return copy;
}
/** The destination owns the common axis, bins, smoothing and normalization. */
export function mergeHistograms(target: WorksheetPlot, source: WorksheetPlot): boolean {
  if (target.id === source.id || target.mode !== "histogram" || source.mode !== "histogram" || target.x.channel !== source.x.channel) return false;
  const existing = histogramSources(target);
  const incoming = histogramSources(source);
  for (const item of incoming) {
    const duplicate = existing.find((entry) => entry.sampleId === item.sampleId && JSON.stringify(entry.population) === JSON.stringify(item.population));
    if (duplicate) {
      if (!target.histogramControl && source.histogramControl === item.id) target.histogramControl = duplicate.id;
      continue;
    }
    const addition: HistogramOverlay = { ...structuredClone(item), id: crypto.randomUUID(), color: item.color ?? (item.id === "primary" ? source.color : undefined) };
    // Preserve explicit overrides; otherwise select a contrasting default for the combined graph.
    target.histogramOverlays ??= [];
    target.histogramOverlays.push(addition);
    existing.push(addition);
    if (!target.histogramControl && source.histogramControl === item.id) target.histogramControl = addition.id;
  }
  return true;
}
