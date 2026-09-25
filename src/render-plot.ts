import type { WorksheetData, WorksheetPlot } from "./types";

type Tick = { value: number; label: string; major?: boolean };
type Density = {
  x: number[];
  y: number[];
  z: number[];
  levels: number[];
  massFractions: number[];
  contours: { level: number; x: number[]; y: number[] }[];
};

const finite = (n: number) => Number.isFinite(n);
const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const superscriptDigits = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];
const superscript = (value: number) =>
  `${value < 0 ? "⁻" : ""}${String(Math.abs(value))
    .split("")
    .map((digit) => superscriptDigits[Number(digit)])
    .join("")}`;
const fallbackTick = (v: number) => {
  const a = Math.abs(v);
  if (!finite(v)) return "";
  if (a >= 1000 || (a > 0 && a < 0.01)) {
    let exponent = Math.floor(Math.log10(a));
    let mantissa = +(a / 10 ** exponent).toPrecision(2);
    if (mantissa >= 10) {
      exponent++;
      mantissa = 1;
    }
    const coefficient = mantissa === 1 ? "" : `${mantissa}×`;
    return `${v < 0 ? "−" : ""}${coefficient}10${superscript(exponent)}`;
  }
  return `${+v.toPrecision(4)}`;
};

export function geometry(stage: HTMLElement, d: WorksheetData) {
  const w = stage.clientWidth,
    h = stage.clientHeight,
    left = 70,
    right = w - 30,
    top = 25,
    bottom = h - 53,
    dx = d.xRange[1] - d.xRange[0] || 1,
    dy = d.yRange[1] - d.yRange[0] || 1,
    box = stage.getBoundingClientRect(),
    localPoint = (e: PointerEvent | MouseEvent) => [
      ((e.clientX - box.left) * w) / (box.width || w),
      ((e.clientY - box.top) * h) / (box.height || h),
    ],
    contains = (e: PointerEvent | MouseEvent) => {
      const [x, y] = localPoint(e);
      return x >= left && x <= right && y >= top && y <= bottom;
    };
  const px = (x: number) => left + ((x - d.xRange[0]) / dx) * (right - left);
  const py = (y: number) => bottom - ((y - d.yRange[0]) / dy) * (bottom - top);
  return {
    w,
    h,
    left,
    right,
    top,
    bottom,
    px,
    py,
    contains,
    point: (e: PointerEvent | MouseEvent) => {
      const [localX, localY] = localPoint(e);
      const x = clamp(localX, left, right);
      const y = clamp(localY, top, bottom);
      return [
        d.xRange[0] + ((x - left) / Math.max(1, right - left)) * dx,
        d.yRange[0] + ((bottom - y) / Math.max(1, bottom - top)) * dy,
      ];
    },
  };
}

const rgb = (hex: string) => {
  const s = hex.replace("#", "");
  const n = Number.parseInt(
    s.length === 3 ? [...s].map((c) => c + c).join("") : s,
    16,
  );
  return finite(n)
    ? [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    : [16, 116, 151];
};

// Perceptually ordered: light low-density events, saturated warm high-density events.
const heat = (t: number, points = false) => {
  const stops = [
    points ? [52, 91, 158] : [246, 248, 250],
    [47, 134, 167],
    [32, 158, 112],
    [244, 190, 48],
    [196, 48, 43],
  ];
  const q = clamp(t) * (stops.length - 1),
    i = Math.min(stops.length - 2, Math.floor(q)),
    f = q - i;
  return `rgb(${stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f)).join(",")})`;
};

const quantileScale = (values: number[]) => {
  const good = values.filter(finite).sort((a, b) => a - b);
  if (!good.length) return (_: number) => 0;
  const lo = good[Math.floor((good.length - 1) * 0.03)],
    hi = good[Math.floor((good.length - 1) * 0.98)];
  return (v: number) => clamp((v - lo) / (hi - lo || 1));
};

function ticks(range: [number, number], supplied?: Tick[], scale = "linear") {
  if (supplied?.length) return supplied.filter((t) => finite(t.value));
  return Array.from({ length: 5 }, (_, i) => {
    const value = range[0] + ((range[1] - range[0]) * i) / 4;
    return { value, label: scale === "linear" ? Number(value.toPrecision(4)).toLocaleString() : fallbackTick(value) };
  });
}

function spacedTicks(
  source: Tick[],
  position: (value: number) => number,
  minimum: number,
) {
  const ordered = source
    .filter((tick) => !!tick.label && finite(position(tick.value)))
    .sort((a, b) => position(a.value) - position(b.value));
  const zero = ordered.find((tick) => tick.value === 0);
  const keep: Tick[] = zero ? [zero] : [];
  for (const tick of ordered) {
    if (tick === zero) continue;
    if (
      keep.every(
        (other) =>
          Math.abs(position(tick.value) - position(other.value)) >= minimum,
      )
    )
      keep.push(tick);
  }
  return keep.sort((a, b) => position(a.value) - position(b.value));
}

function densityGrid(
  ctx: CanvasRenderingContext2D,
  g: ReturnType<typeof geometry>,
  den: Density,
  zebra = false,
) {
  const nx = den.x.length,
    ny = den.y.length;
  if (nx < 1 || ny < 1 || den.z.length < nx * ny) return;
  const scale = quantileScale(den.z);
  const edge = (a: number[], i: number, upper: boolean) => {
    if (a.length === 1) return a[0] + (upper ? 0.5 : -0.5);
    if (!upper) return i ? (a[i - 1] + a[i]) / 2 : a[0] - (a[1] - a[0]) / 2;
    return i < a.length - 1
      ? (a[i] + a[i + 1]) / 2
      : a[i] + (a[i] - a[i - 1]) / 2;
  };
  const levels = [...den.levels].filter(finite).sort((a, b) => a - b);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const z = den.z[j * nx + i];
      if (!finite(z) || z <= 0) continue;
      if (zebra) {
        let band = 0;
        while (band < levels.length && z >= levels[band]) band++;
        ctx.fillStyle = band % 2 ? "#dcecf0" : "#f7fafb";
      } else ctx.fillStyle = heat(scale(z));
      const x0 = g.px(edge(den.x, i, false)),
        x1 = g.px(edge(den.x, i, true));
      const y0 = g.py(edge(den.y, j, false)),
        y1 = g.py(edge(den.y, j, true));
      ctx.fillRect(
        Math.min(x0, x1),
        Math.min(y0, y1),
        Math.abs(x1 - x0) + 0.7,
        Math.abs(y1 - y0) + 0.7,
      );
    }
}

function contours(
  ctx: CanvasRenderingContext2D,
  g: ReturnType<typeof geometry>,
  den: Density,
  dark = false,
  strokeColor = "#146b8c",
) {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const selected = den.contours;
  selected.forEach((line, index) => {
    const n = Math.min(line.x.length, line.y.length);
    if (n < 2) return;
    ctx.beginPath();
    let open = false;
    for (let i = 0; i < n; i++) {
      if (!finite(line.x[i]) || !finite(line.y[i])) {
        open = false;
        continue;
      }
      const x = g.px(line.x[i]),
        y = g.py(line.y[i]);
      if (open) ctx.lineTo(x, y);
      else {
        ctx.moveTo(x, y);
        open = true;
      }
    }
    const ink = rgb(strokeColor);
    ctx.strokeStyle = dark
      ? `rgba(${ink.join(",")},${0.5 + (0.45 * index) / Math.max(1, selected.length - 1)})`
      : "rgba(255,255,255,.82)";
    ctx.lineWidth = dark ? 1.15 : 1;
    ctx.stroke();
  });
}

function points(
  ctx: CanvasRenderingContext2D,
  g: ReturnType<typeof geometry>,
  d: WorksheetData,
  style: WorksheetPlot | undefined,
  colored: boolean,
  outliersOnly = false,
  outlierThreshold = -Infinity,
) {
  const xs = d.xValues,
    ys = d.yValues,
    pairs = !xs || !ys ? d.points : undefined;
  const n = pairs ? pairs.length : Math.min(xs!.length, ys!.length);
  const densities = (d as WorksheetData & { pointDensity?: number[] })
    .pointDensity;
  const pointColors = d.pointColors;
  const densityScale = quantileScale(densities ?? []);
  const dotSize = clamp(style?.dotSize ?? d.dotSize ?? 1.6, 0.5, 12),
    alpha = clamp(style?.dotOpacity ?? d.dotOpacity ?? 0.6, 0.03, 1);
  const base = rgb(style?.color ?? d.color ?? "#146b8c");
  for (let i = 0; i < n; i++) {
    const x = pairs ? pairs[i][0] : xs![i],
      y = pairs ? pairs[i][1] : ys![i];
    if (!finite(x) || !finite(y)) continue;
    const q =
      densities && finite(densities[i]) ? densityScale(densities[i]) : 0;
    if (
      outliersOnly &&
      (!densities || !finite(densities[i]) || densities[i] >= outlierThreshold)
    )
      continue;
    const pointColor = pointColors?.[i];
    const ink = pointColor && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(pointColor)
      ? rgb(pointColor)
      : base;
    ctx.fillStyle = colored
      ? heat(q, true)
      : `rgba(${ink.join(",")},${alpha})`;
    ctx.globalAlpha = colored ? alpha + (1 - alpha) * 0.45 : 1;
    const r = dotSize / 2;
    ctx.beginPath();
    ctx.arc(clamp(g.px(x), g.left, g.right), clamp(g.py(y), g.top, g.bottom), r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function histogram(
  ctx: CanvasRenderingContext2D,
  g: ReturnType<typeof geometry>,
  d: WorksheetData,
  cdf: boolean,
  color: string,
) {
  const cdfData = (d as WorksheetData & { cdf?: { x: number[]; y: number[] } })
    .cdf;
  if (cdf) {
    if (!cdfData?.x.length || !cdfData.y.length) return;
    const n = Math.min(cdfData.x.length, cdfData.y.length);
    ctx.beginPath();
    ctx.moveTo(g.px(cdfData.x[0]), g.py(0));
    let previous = 0;
    for (let i = 0; i < n; i++) {
      if (!finite(cdfData.x[i]) || !finite(cdfData.y[i])) continue;
      ctx.lineTo(g.px(cdfData.x[i]), g.py(previous));
      ctx.lineTo(g.px(cdfData.x[i]), g.py(cdfData.y[i]));
      previous = cdfData.y[i];
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();
    return;
  }
  const h = d.histogram;
  if (!h || h.edges.length < 2 || !h.counts.length) return;
  const n = Math.min(h.counts.length, h.edges.length - 1);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(g.px(h.edges[0]), g.bottom);
  for (let i = 0; i < n; i++) {
    const count = h.counts[i];
    if (!finite(count)) continue;
    ctx.lineTo(g.px(h.edges[i]), g.py(count));
    ctx.lineTo(g.px(h.edges[i + 1]), g.py(count));
  }
  ctx.lineTo(g.px(h.edges[n]), g.bottom);
  ctx.closePath();
  ctx.fill();
}

export function drawPlot(
  stage: HTMLElement,
  d: WorksheetData,
  style?: WorksheetPlot,
) {
  const g = geometry(stage, d),
    canvas = stage.querySelector("canvas");
  if (!canvas || g.w <= 0 || g.h <= 0) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(g.w * ratio);
  canvas.height = Math.round(g.h * ratio);
  canvas.style.width = `${g.w}px`;
  canvas.style.height = `${g.h}px`;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, g.w, g.h);
  ctx.font = "11px Segoe UI, Arial, sans-serif";
  ctx.textBaseline = "middle";

  const allX = ticks(d.xRange, d.xTicks, d.x.scale);
  const allY = ticks(d.yRange, d.yTicks, d.y.scale);
  const xt = spacedTicks(allX, g.px, 35);
  const yt = spacedTicks(allY, g.py, 18);
  ctx.strokeStyle = "#171a1c";
  ctx.fillStyle = "#30363a";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(g.left, g.top);
  ctx.lineTo(g.left, g.bottom);
  if (style?.showXAxis !== false) ctx.lineTo(g.right, g.bottom);
  ctx.stroke();
  if (style?.showXAxis !== false) allX.filter((t) => !t.label).forEach((t) => {
    const x = g.px(t.value);
    if (x < g.left || x > g.right) return;
    ctx.beginPath(); ctx.moveTo(x, g.bottom); ctx.lineTo(x, g.bottom + 2.5); ctx.stroke();
  });
  allY.filter((t) => !t.label).forEach((t) => {
    const y = g.py(t.value);
    if (y < g.top || y > g.bottom) return;
    ctx.beginPath(); ctx.moveTo(g.left - 2.5, y); ctx.lineTo(g.left, y); ctx.stroke();
  });
  ctx.textAlign = "center";
  if (style?.showXAxis !== false) xt.forEach((t) => {
    const x = g.px(t.value);
    if (x < g.left - 1 || x > g.right + 1) return;
    ctx.beginPath();
    ctx.moveTo(x, g.bottom);
    ctx.lineTo(x, g.bottom + 5);
    ctx.stroke();
    ctx.fillText(t.label, x, g.bottom + 15);
  });
  ctx.textAlign = "right";
  yt.forEach((t) => {
    const y = g.py(t.value);
    if (y < g.top - 1 || y > g.bottom + 1) return;
    ctx.beginPath();
    ctx.moveTo(g.left - 5, y);
    ctx.lineTo(g.left, y);
    ctx.stroke();
    ctx.fillText(t.label, g.left - 8, y);
  });

  ctx.save();
  ctx.beginPath();
  ctx.rect(
    g.left,
    g.top,
    Math.max(0, g.right - g.left),
    Math.max(0, g.bottom - g.top),
  );
  ctx.clip();
  const mode = (style?.mode ?? d.mode) as string;
  const den = (d as WorksheetData & { density?: Density }).density;
  const color = style?.color ?? d.color ?? "#146b8c";
  if (mode === "histogram" || mode === "cdf")
    histogram(ctx, g, d, mode === "cdf", color);
  else if (mode === "density" && den) {
    densityGrid(ctx, g, den);
    if ((style?.showOutliers ?? d.showOutliers) !== false && den.levels.length)
      points(ctx, g, d, style, false, true, Math.min(...den.levels));
  } else if (mode === "contour" && den) {
    contours(ctx, g, den, true, color);
    const levels = den.levels.filter(finite);
    if ((style?.showOutliers ?? d.showOutliers) !== false && levels.length)
      points(ctx, g, d, style, false, true, Math.min(...levels));
  } else if (mode === "zebra" && den) {
    densityGrid(ctx, g, den, true);
    contours(ctx, g, den, true, color);
    if ((style?.showOutliers ?? d.showOutliers) !== false && den.levels.length)
      points(ctx, g, d, style, false, true, Math.min(...den.levels));
  } else points(ctx, g, d, style, mode === "pseudocolor");
  ctx.restore();

  ctx.fillStyle = "#3e494f";
  ctx.font = "10px Segoe UI, Arial, sans-serif";
  ctx.textAlign = "left";
  const excluded = d.excluded ?? 0;
  const shown = finite(d.shown) ? d.shown : d.total;
  const sampled =
    shown < d.total - excluded ? ` · ${shown.toLocaleString()} plotted` : "";
  const note = `N=${d.total.toLocaleString()}${sampled}${excluded ? ` · ${excluded.toLocaleString()} excluded` : ""}`;
  ctx.fillText(note, g.left, 12);
}
