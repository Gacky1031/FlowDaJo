export interface Axis {
  channel: string;
  scale: "linear" | "log" | "logicle";
  w: number;
  t: number;
  m: number;
  a: number;
  min?: number;
  max?: number;
  autoRange?: boolean;
}
export interface Plot {
  id: string;
  x: Axis;
  y: Axis;
}
export interface PlotData extends Plot {
  xRange: [number, number];
  yRange: [number, number];
  points: [number, number][];
  shown: number;
  total: number;
}
export interface Compensation {
  enabled: boolean;
  channels: string[];
  values: number[][];
  source?: string;
}
export interface DivaCompensation extends Compensation {
  id: string;
  name: string;
  template: string;
  file: string;
  active: boolean;
  divaSourceId?: string;
}
export interface Sample {
  id: string;
  name: string;
  /** Stable sequence number assigned when the sample enters this project. */
  importOrder?: number;
  kind: "demo" | "fcs";
  path?: string;
  seed?: number;
  md5?: string;
  events: number;
  channels: { id: string; label: string }[];
  compensation: Compensation;
  plots?: Plot[];
}
export interface Gate {
  id: string;
  sampleId: string;
  name: string;
  parent: string;
  type: "rectangle" | "polygon" | "quadrant" | "ellipse" | "range";
  x: Axis;
  y: Axis;
  bounds?: number[];
  vertices?: number[][];
  center?: number[];
  quadrant?: number;
  groupId?: string;
  /** Global gates are evaluated for every sample; sample gates stay local. */
  scope?: "global" | "sample";
  /** Stable color used in gate overlays and plots of this population. */
  color?: string;
  divaTemplate?: string;
  divaSourceId?: string;
  /** Extend a gate touching a plot edge to include events beyond that edge. */
  edgeExtent?: { xMin?: number; xMax?: number; yMin?: number; yMax?: number };
}
export interface Project {
  schema: "flowdesk-r/1";
  name: string;
  samples: Sample[];
  sampleSort?: "import" | "name" | "manual";
  gates: Gate[];
  selectedGate: string;
  notes: string;
  importWarnings: string[];
  divaMetadata?: { file: string; sourcePath?: string; experiments: string[]; version?: string; worksheets?: string[]; importedGateCount?: number; importedPlotCount?: number; importedCompensationCount?: number }[];
  divaCompensations?: DivaCompensation[];
  /** Per-channel axis defaults imported from FACSDiva worksheets. */
  divaAxisDefaults?: Axis[];
  worksheets?: Worksheet[];
  activeWorksheet?: string;
}
export type PlotMode =
  | "scatter"
  | "histogram"
  | "cdf"
  | "density"
  | "contour"
  | "pseudocolor"
  | "zebra";
export interface PlotStyle {
  dotSize?: number;
  dotOpacity?: number;
  color?: string;
  smoothing?: boolean;
  showOutliers?: boolean;
  contourPercent?: number;
  bins?: number;
  histogramNormalize?: "count" | "percent" | "mode";
  showGateNames?: boolean;
  showGatePercentages?: boolean;
  showXAxis?: boolean;
}
export interface WorksheetPlot extends Plot, PlotStyle {
  sampleId: string;
  population: string[];
  mode: PlotMode;
  /** Gate IDs whose outlines are shown, independent of the displayed population. */
  displayGates?: string[];
  left: number;
  top: number;
  width: number;
  height: number;
}
export type WorksheetMode = "global" | "normal";
export interface StatisticsWidget {
  type?: "statistics";
  id: string;
  /** Global worksheets follow the active sample; Normal worksheets pin one. */
  sampleId?: string;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Population event count is enabled by default to preserve the standard view. */
  showEvents?: boolean;
  showPercentParent?: boolean;
  showPercentTotal?: boolean;
  /** Optional median fluorescence intensity columns, keyed by channel id. */
  mfiChannels?: string[];
  /** JSON-encoded population name paths hidden from this widget. Empty by default. */
  hiddenPopulationPaths?: string[];
}
export interface CompensationWidget {
  type: "compensation";
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  /** "active" follows the current sample in a Global worksheet. */
  sampleId?: string;
  /** Selected destinations for applying the edited matrix. */
  targetSampleIds?: string[];
  /** Fluorescence channels currently shown in the matrix. Undefined shows all. */
  visibleChannels?: string[];
}
export type WorksheetWidget = StatisticsWidget | CompensationWidget;
export interface PrintPage {
  id: string;
  left: number;
  top: number;
  orientation: "portrait" | "landscape";
  /** Canvas scale of the A4 frame; PDF output remains physical A4. */
  scale?: number;
}
export interface Worksheet {
  id: string;
  name: string;
  plots: WorksheetPlot[];
  /** Movable worksheet objects printed together with the plot cards. */
  widgets?: WorksheetWidget[];
  /** Global sheets batch the active sample; normal sheets keep per-sample cards. */
  mode?: WorksheetMode;
  /** View-only canvas magnification. */
  zoom?: number;
  /** Annotations rendered on the worksheet PDF. */
  print?: { showGateNames?: boolean; showGatePercentages?: boolean };
  /** A4 regions on the worksheet. Objects fully inside a region appear on its PDF page. */
  printPages?: PrintPage[];
  /** Source worksheet identity used while importing FACSDiva worksheets. */
  divaTemplate?: string;
  divaSourceId?: string;
}
export interface WorksheetData extends PlotData, PlotStyle {
  xTicks?: { value: number; label: string; major?: boolean }[];
  yTicks?: { value: number; label: string; major?: boolean }[];
  excluded?: number;
  density?: {
    x: number[];
    y: number[];
    z: number[];
    levels: number[];
    massFractions: number[];
    contours: { level: number; x: number[]; y: number[] }[];
  };
  pointDensity?: number[];
  compensation: Compensation;
  xValues?: number[];
  yValues?: number[];
  pointColors?: string[];
  displayGateIds?: string[];
  mode: PlotMode;
  sampleId: string;
  sampleName: string;
  gateId: string;
  compensationEnabled: boolean;
  cdf?: { x: number[]; y: number[]; condition: string };
  histogram?: {
    edges: number[];
    counts: number[];
    rawCounts?: number[];
    normalize?: string;
  };
}
export interface WorksheetResult {
  plots: Record<string, WorksheetData>;
  stats: Record<string, Statistic[]>;
  errors: Record<string, string>;
  workerPid: number;
}
export interface Statistic {
  id: string;
  name: string;
  parent: string | null;
  count: number;
  percentParent: number | null;
  percentTotal: number | null;
  medians: Record<string, number | null>;
}
export interface Analysis {
  sample: Sample;
  stats: Statistic[];
  plots: PlotData[];
  selectedGate: string;
  compensationEnabled: boolean;
  engine: Record<string, string>;
}
