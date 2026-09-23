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
}
export interface Sample {
  id: string;
  name: string;
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
}
export interface Project {
  schema: "flowdesk-r/1";
  name: string;
  samples: Sample[];
  gates: Gate[];
  selectedGate: string;
  notes: string;
  importWarnings: string[];
  divaMetadata?: { file: string; experiments: string[] }[];
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
}
export interface WorksheetPlot extends Plot, PlotStyle {
  sampleId: string;
  population: string[];
  mode: PlotMode;
  left: number;
  top: number;
  width: number;
  height: number;
}
export type WorksheetMode = "global" | "normal";
export interface Worksheet {
  id: string;
  name: string;
  plots: WorksheetPlot[];
  /** Global sheets batch the active sample; normal sheets keep per-sample cards. */
  mode?: WorksheetMode;
  /** View-only canvas magnification. */
  zoom?: number;
  /** Annotations rendered on the worksheet PDF. */
  print?: { showGateNames?: boolean; showGatePercentages?: boolean };
}
export interface WorksheetData extends PlotData, PlotStyle {
  xTicks?: { value: number; label: string }[];
  yTicks?: { value: number; label: string }[];
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
