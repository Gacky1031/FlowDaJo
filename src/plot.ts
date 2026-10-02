import type {
  Gate,
  WorksheetData,
  WorksheetPlot,
  Project,
  Statistic,
} from "./types";
import { projectGate, projectGatePoint } from "./gate-projection";
import { geometry } from "./render-plot";
export { geometry, drawPlot as draw } from "./render-plot";
import { gateContains } from "./gate-hit";
import { gateAppliesToSample, oneDimensional } from "./model";
export const compatible = (g: Gate, d: WorksheetData) =>
  gateAppliesToSample(g, d.sampleId) &&
  g.x.channel === d.x.channel &&
  (g.type === "range" || g.y.channel === d.y.channel) &&
  (oneDimensional(d) ? g.type === "range" : g.type !== "range");
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function overlay(
  stage: HTMLElement,
  d: WorksheetData,
  gates: Gate[],
  selected: string,
  preview?: Gate,
  polygon: number[][] = [],
  statistics: Statistic[] = [],
  style?: WorksheetPlot,
  labelPreview?: { id: string; position: { x: number; y: number } },
) {
  const geo = geometry(stage, d),
    svg = stage.querySelector("svg")!;
  svg.setAttribute("viewBox", `0 0 ${geo.w} ${geo.h}`);
  const line = (points: number[][]) =>
    points.map((p) => `${geo.px(p[0])},${geo.py(p[1])}`).join(" ");
  let html = "";
  const fontSize = Math.max(6, Math.min(24, style?.gateLabelFontSizePt ?? 8.25)) * 96 / 72;
  const label = (g: Gate, x: number, y: number, anchor = "start") => {
    const position = labelPreview?.id === g.id ? labelPreview.position : style?.gateLabelPositions?.[g.id];
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
      x = geo.left + position.x * (geo.right - geo.left);
      y = geo.top + position.y * (geo.bottom - geo.top);
    }
    return `<text data-shape="${escape(g.id)}" data-gate-label="${escape(g.id)}" x="${x}" y="${y}" text-anchor="${anchor}" fill="${g.color ?? "#303e48"}" font-size="${fontSize}" aria-label="${escape(g.name)}の分画ラベル（ドラッグで移動）">${escape(gateLabel(g))}</text>`;
  };
  const gateLabel = (g: Gate) => {
    const stat = statistics.find((s) => s.id === g.id);
    return `${style?.showGateNames === false ? "" : g.name}${style?.showGatePercentages === false || stat?.percentParent == null ? "" : `${style?.showGateNames === false ? "" : " · "}${stat.percentParent.toFixed(1)}%`}`;
  };
  const visibleIds = new Set(
    style?.displayGates ??
      gates
        .filter((g) => g.parent === d.gateId && compatible(g, d))
        .map((g) => g.id),
  );
  const drawGate = (g: Gate, ghost = false) => {
    const shown = projectGate(g, d);
    let shape = "",
      vertices: number[][] = [];
    if (g.type === "rectangle" || g.type === "ellipse") {
      const b = shown.bounds!;
      vertices = [
        [b[0], b[3]],
        [b[1], b[3]],
        [b[1], b[2]],
        [b[0], b[2]],
      ];
      shape =
        g.type === "ellipse" && shown.vertices
          ? `<polygon points="${line(shown.vertices)}"/>`
          : g.type === "ellipse"
          ? `<ellipse cx="${geo.px((b[0] + b[1]) / 2)}" cy="${geo.py((b[2] + b[3]) / 2)}" rx="${Math.abs(geo.px(b[1]) - geo.px(b[0])) / 2}" ry="${Math.abs(geo.py(b[3]) - geo.py(b[2])) / 2}"/>`
          : `<polygon points="${line(vertices)}"/>`;
    }
    if (g.type === "range") {
      const y = d.yRange[1] - 0.12 * (d.yRange[1] - d.yRange[0]);
      vertices = [
        [shown.bounds![0], y],
        [shown.bounds![1], y],
      ];
      shape = `<path d="M ${geo.px(shown.bounds![0])} ${geo.py(y) + 6} V ${geo.py(y)} H ${geo.px(shown.bounds![1])} V ${geo.py(y) + 6}"/>`;
    }
    if (g.type === "polygon") {
      vertices = g.vertices!.map((p) => projectGatePoint(g, d, p));
      shape = `<polygon points="${line(shown.vertices!)}"/>`;
    }
    if (g.type === "quadrant") {
      vertices = [shown.center!];
      shape = `<path d="M ${geo.px(shown.center![0])} ${geo.top} V ${geo.bottom} M ${geo.left} ${geo.py(shown.center![1])} H ${geo.right}"/>`;
    }
    const active = g.id === selected || ghost;
    const first = vertices[0];
    const color = g.color ?? "#303e48";
    html += `<g data-shape="${escape(g.id)}" class="gate-shape ${active ? "editing" : ""}" stroke="${color}" fill="transparent" stroke-width="${active ? 2.2 : 1.5}">${shape}</g>`;
    if (first && g.type !== "quadrant" && gateLabel(g))
      html += label(g, Math.max(geo.left, Math.min(geo.right - 35, geo.px(first[0]) + 4)), Math.max(geo.top + 12, geo.py(first[1]) - 5));
    if (active)
      vertices.forEach(
        (pt, i) =>
          (html += `<circle data-shape="${escape(g.id)}" data-handle="${i}" cx="${geo.px(pt[0])}" cy="${geo.py(pt[1])}" r="4.5" fill="white" stroke="#dc731d" stroke-width="2"/>`),
      );
  };
  const seen = new Set<string>();
  for (const g of gates.filter((g) => visibleIds.has(g.id) && compatible(g, d))) {
    if (preview?.id === g.id) continue;
    if (g.type === "quadrant" && g.groupId) {
      if (seen.has(g.groupId)) continue;
      seen.add(g.groupId);
    }
    drawGate(
      g.groupId
        ? (gates.find(
            (other) => other.id === selected && other.groupId === g.groupId,
          ) ?? g)
        : g,
    );
  }
  for (const g of gates.filter(
    (g) => visibleIds.has(g.id) && compatible(g, d) && g.type === "quadrant",
  )) {
    const right = g.quadrant === 2 || g.quadrant === 4,
      upper = g.quadrant === 1 || g.quadrant === 2;
    if (gateLabel(g)) html += label(g, right ? geo.right - 5 : geo.left + 5, upper ? geo.top + fontSize + 2 : geo.bottom - 8, right ? "end" : "start");
  }
  if (preview) drawGate(preview, true);
  if (polygon.length)
    html += `<polyline pointer-events="none" points="${line(polygon)}" fill="none" stroke="#e46614" stroke-width="2"/>`;
  const clipId = `plot-clip-${stage.closest<HTMLElement>("[data-card]")?.dataset.card ?? "stage"}`;
  svg.innerHTML = `<defs><clipPath id="${clipId}"><rect x="${geo.left}" y="${geo.top}" width="${geo.right - geo.left}" height="${geo.bottom - geo.top}"/></clipPath></defs><g clip-path="url(#${clipId})">${html}</g>`;
  for (const text of svg.querySelectorAll<SVGTextElement>("[data-gate-label]")) {
    const box = text.getBBox();
    const dx = box.x < geo.left ? geo.left - box.x : Math.min(0, geo.right - box.x - box.width);
    const dy = box.y < geo.top ? geo.top - box.y : Math.min(0, geo.bottom - box.y - box.height);
    text.setAttribute("x", String(Number(text.getAttribute("x")) + dx));
    text.setAttribute("y", String(Number(text.getAttribute("y")) + dy));
  }
}
export interface PlotActions {
  project: () => Project;
  selected: () => string;
  tool: () => string;
  select: (id: string) => void;
  gesture: (active: boolean) => void;
  drill: (gate: Gate) => void;
  context: (event: MouseEvent, gates: Gate[]) => void;
  statistics: () => Statistic[];
  moveLabel: (plot: WorksheetPlot, id: string, position: { x: number; y: number }) => void;
  commit: (
    plot: WorksheetPlot,
    d: WorksheetData,
    shape: Partial<Gate>,
    existing?: Gate,
  ) => void;
}
export function gestures(
  stage: HTMLElement,
  card: WorksheetPlot,
  d: WorksheetData,
  a: PlotActions,
) {
  let start: number[] | undefined,
    original: Gate | undefined,
    preview: Gate | undefined,
    handle: number | undefined,
    polygon: number[][] = [];
  let labelDrag: { id: string; start: number[]; initial: { x: number; y: number }; position: { x: number; y: number } } | undefined;
  let ignoreLabelClickUntil = 0;
  const redraw = () =>
    overlay(
      stage,
      d,
      a.project().gates,
      a.selected(),
      preview,
      polygon,
      a.statistics(),
      card,
      labelDrag && { id: labelDrag.id, position: labelDrag.position },
    );
  const clipToPlot = (gate: Gate): Gate => {
    const low = projectGatePoint(gate, d, [d.xRange[0], d.yRange[0]], true);
    const high = projectGatePoint(gate, d, [d.xRange[1], d.yRange[1]], true);
    const xRange: [number, number] = [low[0], high[0]], yRange: [number, number] = [low[1], high[1]];
    const clip = (value: number, range: [number, number]) =>
      Math.max(range[0], Math.min(range[1], value));
    if (gate.bounds) {
      gate.bounds = gate.type === "range"
        ? [clip(gate.bounds[0], xRange), clip(gate.bounds[1], xRange)]
        : [
            clip(gate.bounds[0], xRange),
            clip(gate.bounds[1], xRange),
            clip(gate.bounds[2], yRange),
            clip(gate.bounds[3], yRange),
          ];
    }
    if (gate.vertices)
      gate.vertices = gate.vertices.map(([x, y]) => [clip(x, xRange), clip(y, yRange)]);
    if (gate.center)
      gate.center = [clip(gate.center[0], xRange), clip(gate.center[1], yRange)];
    return gate;
  };
  const cancel = () => {
    labelDrag = undefined;
    start = undefined;
    original = undefined;
    preview = undefined;
    polygon = [];
    a.gesture(false);
    redraw();
  };
  stage.onpointerdown = (e) => {
    if (e.button !== 0 || (e.target as Element).closest("button")) return;
    const geo = geometry(stage, d);
    if (!geo.contains(e)) return;
    const label = (e.target as Element).closest<SVGTextElement>("[data-gate-label]");
    if (label) {
      const position = {
        x: (Number(label.getAttribute("x")) - geo.left) / (geo.right - geo.left),
        y: (Number(label.getAttribute("y")) - geo.top) / (geo.bottom - geo.top),
      };
      labelDrag = { id: label.dataset.gateLabel!, start: geo.point(e), initial: position, position };
      ignoreLabelClickUntil = performance.now() + 500;
      stage.focus({ preventScroll: true });
      a.gesture(true);
      stage.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const tool = a.tool(),
      pt = geo.point(e);
    if (oneDimensional(d) && !["select", "range"].includes(tool)) return;
    if (!oneDimensional(d) && tool === "range") return;
    const el = (e.target as Element).closest<SVGElement>("[data-shape]");
    if (tool === "select") {
      if (!el) {
        const hit = hits(e)[0];
        if (hit) {
          a.select(hit.id);
          redraw();
        }
        return;
      }
      const gate = a.project().gates.find((g) => g.id === el.dataset.shape);
      if (!gate) return;
      original = structuredClone(gate);
      preview = structuredClone(gate);
      handle =
        el.dataset.handle === undefined ? undefined : Number(el.dataset.handle);
      a.select(gate.id);
      start = projectGatePoint(gate, d, pt, true);
      a.gesture(true);
      stage.setPointerCapture(e.pointerId);
      redraw();
    } else if (tool === "polygon") {
      return;
    } else if (tool === "quadrant")
      a.commit(card, d, { type: "quadrant", center: pt });
    else if (["rectangle", "ellipse", "range"].includes(tool)) {
      start = pt;
      a.gesture(true);
      stage.setPointerCapture(e.pointerId);
    }
    e.preventDefault();
  };
  stage.onpointermove = (e) => {
    if (labelDrag) {
      const pt = geometry(stage, d).point(e);
      labelDrag.position = {
        x: Math.max(0, Math.min(1, labelDrag.initial.x + (pt[0] - labelDrag.start[0]) / (d.xRange[1] - d.xRange[0] || 1))),
        y: Math.max(0, Math.min(1, labelDrag.initial.y - (pt[1] - labelDrag.start[1]) / (d.yRange[1] - d.yRange[0] || 1))),
      };
      redraw();
      return;
    }
    if (!start) return;
    const displayPoint = geometry(stage, d).point(e),
      pt = original ? projectGatePoint(original, d, displayPoint, true) : displayPoint,
      dx = pt[0] - start[0],
      dy = pt[1] - start[1];
    if (original) {
      preview = structuredClone(original);
      if (original.type === "rectangle" || original.type === "ellipse") {
        const b = original.bounds!;
        if (handle === undefined)
          preview.bounds = [b[0] + dx, b[1] + dx, b[2] + dy, b[3] + dy];
        else {
          const x = handle === 0 || handle === 3 ? b[1] : b[0],
            y = handle < 2 ? b[2] : b[3];
          preview.bounds = [
            Math.min(pt[0], x),
            Math.max(pt[0], x),
            Math.min(pt[1], y),
            Math.max(pt[1], y),
          ];
        }
      }
      if (original.type === "range") {
        const b = original.bounds!;
        preview.bounds =
          handle === undefined
            ? [b[0] + dx, b[1] + dx]
            : [Math.min(pt[0], b[1 - handle]), Math.max(pt[0], b[1 - handle])];
      }
      if (original.type === "polygon")
        preview.vertices = original.vertices!.map((v, i) =>
          handle === undefined ? [v[0] + dx, v[1] + dy] : i === handle ? pt : v,
        );
      if (original.type === "quadrant")
        preview.center = [original.center![0] + dx, original.center![1] + dy];
    } else
      preview = {
        id: "preview",
        name: "New gate",
        sampleId: d.sampleId,
        parent: d.gateId,
        type: a.tool() as Gate["type"],
        x: d.x,
        y: d.y,
        bounds:
          a.tool() === "range"
            ? [Math.min(start[0], pt[0]), Math.max(start[0], pt[0])]
            : [
                Math.min(start[0], pt[0]),
                Math.max(start[0], pt[0]),
                Math.min(start[1], pt[1]),
                Math.max(start[1], pt[1]),
              ],
      };
    if (preview) preview = clipToPlot(preview);
    redraw();
  };
  stage.onpointerup = (e) => {
    if (labelDrag) {
      const drag = labelDrag;
      ignoreLabelClickUntil = performance.now() + 500;
      const geo = geometry(stage, d);
      const label = [...stage.querySelectorAll<SVGTextElement>("[data-gate-label]")].find((item) => item.dataset.gateLabel === drag.id);
      const position = label ? {
        x: (Number(label.getAttribute("x")) - geo.left) / (geo.right - geo.left),
        y: (Number(label.getAttribute("y")) - geo.top) / (geo.bottom - geo.top),
      } : drag.position;
      labelDrag = undefined;
      a.gesture(false);
      if (Math.abs(position.x - drag.initial.x) * (geo.right - geo.left) > 2 || Math.abs(position.y - drag.initial.y) * (geo.bottom - geo.top) > 2)
        a.moveLabel(card, drag.id, position);
      else redraw();
      return;
    }
    if (!start) return;
    const end = geometry(stage, d).point(e),
      geo = geometry(stage, d);
    const displayStart = original ? projectGatePoint(original, d, start) : start;
    const changed =
      preview &&
      (Math.abs(geo.px(end[0]) - geo.px(displayStart[0])) > 2 ||
        Math.abs(geo.py(end[1]) - geo.py(displayStart[1])) > 2);
    const edited = preview,
      old = original;
    start = undefined;
    original = undefined;
    preview = undefined;
    a.gesture(false);
    if (
      changed &&
      edited &&
      (!edited.bounds ||
        (edited.bounds[0] < edited.bounds[1] &&
          (edited.type === "range" || edited.bounds[2] < edited.bounds[3])))
    )
      a.commit(card, d, edited, old);
    else redraw();
  };
  stage.onclick = (e) => {
    if (performance.now() < ignoreLabelClickUntil) return;
    if ((e.target as Element).closest("button,[data-gate-label]")) return;
    if (a.tool() === "polygon" && !oneDimensional(d) && e.detail < 2) {
      const geo = geometry(stage, d);
      if (!geo.contains(e)) return;
      polygon.push(geo.point(e));
      a.gesture(true);
      redraw();
    }
  };
  const hits = (e: MouseEvent) => {
    const geo = geometry(stage, d);
    if (!geo.contains(e)) return [];
    const gates = a.project().gates;
    const visibleIds = new Set(
      card.displayGates ??
        gates
          .filter((g) => g.parent === d.gateId && compatible(g, d))
          .map((g) => g.id),
    );
    const children = gates.filter(
      (g) => visibleIds.has(g.id) && compatible(g, d),
    );
    const direct = (e.target as Element).closest<SVGElement>("[data-shape]")
      ?.dataset.shape;
    const inside = children
      .filter((g) => gateContains(g, projectGatePoint(g, d, geo.point(e), true)))
      .reverse();
    if (direct) {
      const g = children.find((g) => g.id === direct);
      if (g && g.type !== "quadrant")
        return [g, ...inside.filter((h) => h.id !== g.id)];
    }
    return inside;
  };
  stage.oncontextmenu = (e) => {
    if ((e.target as Element).closest("button")) return;
    e.preventDefault();
    e.stopPropagation();
    a.context(e, hits(e));
  };
  stage.ondblclick = (e) => {
    if (performance.now() < ignoreLabelClickUntil) return;
    if ((e.target as Element).closest("button,[data-gate-label]")) return;
    if (a.tool() === "polygon" && polygon.length >= 3) {
      e.preventDefault();
      const vertices = polygon;
      polygon = [];
      a.gesture(false);
      a.commit(card, d, { type: "polygon", vertices });
    } else if (a.tool() === "select") {
      const hit = hits(e)[0];
      if (hit) {
        e.preventDefault();
        a.drill(hit);
      }
    }
  };
  stage.onpointercancel = cancel;
  stage.onkeydown = (e) => {
    if (e.key === "Escape") cancel();
  };
  stage.tabIndex = 0;
}
