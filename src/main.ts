import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save, confirm } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  Axis,
  Gate,
  Project,
  Sample,
  WorksheetPlot,
  WorksheetData,
  WorksheetResult,
  WorksheetMode,
  Worksheet,
  WorksheetWidget,
  StatisticsWidget,
  CompensationWidget,
  DivaCompensation,
  Compensation,
  PrintPage,
} from "./types";
import {
  uid,
  axis,
  axisKey,
  gateAppliesToSample,
  gateScope,
  pathFor,
  resolveGate,
  newPlot,
  migrate,
  deleteBranch,
  oneDimensional,
  plotModes,
  scaleLabel,
  populationPalette,
  worksheetGrid,
  a4Page,
  newStatisticsWidget,
  newCompensationWidget,
} from "./model";
import { LatestJob } from "./jobs";
import { draw, overlay, gestures } from "./plot";
import {
  axisLabels,
  chooseParameter,
  editAxis,
  closeAxisUI,
  type AxisSide,
} from "./axis-ui";
import { contextMenu, closeMenu, type MenuAction } from "./context-menu";
import { editPlotOptions } from "./plot-options";
import "./style.css";
const app = document.querySelector<HTMLDivElement>("#app")!;
let project: Project = migrate({
  schema: "flowdesk-r/1",
  name: "Untitled experiment",
  samples: [],
  gates: [],
  selectedGate: "root",
  notes: "",
  importWarnings: [],
});
let sampleId = "",
  activeCard = "",
  selectedGate = "",
  tool = "select",
  dirty = false,
  pending = false,
  gesture = false,
  operation = false;
let gateScopeMode: "global" | "sample" = "global";
let gateFilter: "all" | "global" | "sample" = "all";
let focusedCard = "";
let leftSidebarVisible = true;
const selectedCards = new Set<string>();
const selectedWidgets = new Set<string>();
const printPageSize = (page: Pick<PrintPage, "orientation" | "scale">) => {
  const scale = page.scale ?? 1;
  return page.orientation === "portrait"
    ? { width: a4Page.short * scale, height: a4Page.long * scale }
    : { width: a4Page.long * scale, height: a4Page.short * scale };
};
function printPageMarkup(page: PrintPage, index: number) {
  const { width, height } = printPageSize(page);
  const label = page.orientation === "portrait" ? "縦" : "横";
  const scale = page.scale ?? 1;
  const percent = Math.round(scale * 100);
  return `<div class="print-page" data-print-page="${esc(page.id)}" style="left:${page.left}px;top:${page.top}px;width:${width}px;height:${height}px;--print-safe-margin:${16 * scale}px"><div class="print-page-toolbar" data-print-move="${esc(page.id)}" title="ドラッグで印刷範囲を移動"><button type="button" class="print-page-orientation" data-print-orientation="${esc(page.id)}" aria-label="印刷ページの縦横を切り替え" title="クリックして縦・横を切り替え">↻</button><span class="print-page-grip">⠿</span><strong>A4 · ${index + 1}ページ · ${label} · ${percent}%</strong><button type="button" data-print-remove="${esc(page.id)}" title="この印刷ページを削除" ${index === 0 && (sheet().printPages?.length ?? 0) === 1 ? "disabled" : ""}>×</button></div><span class="print-page-corner" data-print-resize="${esc(page.id)}" title="ドラッグで印刷範囲を拡大・縮小">◢</span></div>`;
}
function wirePrintPages(board: HTMLElement) {
  const pages = () => sheet().printPages ?? [];
  const findPage = (id: string) => pages().find((page) => page.id === id);
  document.querySelector<HTMLButtonElement>("#add-print-page")!.onclick = () => {
    const last = pages().at(-1);
    const orientation = last?.orientation ?? "landscape";
    const left = last ? last.left + printPageSize(last).width + a4Page.gap : 0;
    remember();
    sheet().printPages ??= [];
    sheet().printPages!.push({ id: uid(), left, top: last?.top ?? 0, orientation, scale: last?.scale ?? 1 });
    changed(false);
  };
  document.querySelectorAll<HTMLButtonElement>("[data-print-orientation]").forEach((button) => {
    button.onclick = () => {
      const page = findPage(button.dataset.printOrientation!);
      if (!page) return;
      remember();
      page.orientation = page.orientation === "portrait" ? "landscape" : "portrait";
      changed(false);
    };
  });
  document.querySelectorAll<HTMLButtonElement>("[data-print-remove]").forEach((button) => {
    button.onclick = () => {
      if (pages().length <= 1) return;
      remember();
      sheet().printPages = pages().filter((page) => page.id !== button.dataset.printRemove);
      changed(false);
    };
  });
  const startDrag = (event: PointerEvent, id: string, kind: "move" | "resize") => {
    if (event.button !== 0 || (event.target as Element).closest("button")) return;
    const page = findPage(id);
    const element = document.querySelector<HTMLElement>(`[data-print-page="${CSS.escape(id)}"]`);
    if (!page || !element) return;
    event.preventDefault();
    event.stopPropagation();
    const initial = { left: page.left, top: page.top, orientation: page.orientation, scale: page.scale ?? 1 };
    let next = { ...initial };
    const x = event.clientX, y = event.clientY;
    const zoom = board.getBoundingClientRect().width / board.offsetWidth || 1;
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== event.pointerId) return;
      if (kind === "move") {
        next.left = Math.max(0, Math.round(initial.left + (pointer.clientX - x) / zoom));
        next.top = Math.max(0, Math.round(initial.top + (pointer.clientY - y) / zoom));
        element.style.left = `${next.left}px`;
        element.style.top = `${next.top}px`;
      } else {
        const baseSize = printPageSize(initial);
        const dx = (pointer.clientX - x) / zoom;
        const dy = (pointer.clientY - y) / zoom;
        const scaleDelta = (dx * baseSize.width + dy * baseSize.height) /
          (baseSize.width * baseSize.width + baseSize.height * baseSize.height) * initial.scale;
        next.scale = Math.round(Math.max(0.25, Math.min(3, initial.scale + scaleDelta)) * 1000) / 1000;
        const size = printPageSize(next);
        element.style.width = `${size.width}px`;
        element.style.height = `${size.height}px`;
        element.style.setProperty("--print-safe-margin", `${16 * next.scale}px`);
        element.querySelector("strong")!.textContent = `A4 · ${pages().indexOf(page) + 1}ページ · ${next.orientation === "portrait" ? "縦" : "横"} · ${Math.round(next.scale * 100)}%`;
      }
    };
    const finish = (pointer: PointerEvent) => {
      if (pointer.pointerId !== event.pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      if (next.left === initial.left && next.top === initial.top && next.orientation === initial.orientation && next.scale === initial.scale) return;
      remember();
      Object.assign(page, next);
      changed(false);
    };
    const cancel = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      element.style.left = `${initial.left}px`;
      element.style.top = `${initial.top}px`;
      const size = printPageSize(initial);
      element.style.width = `${size.width}px`;
      element.style.height = `${size.height}px`;
      element.style.setProperty("--print-safe-margin", `${16 * initial.scale}px`);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
  };
  document.querySelectorAll<HTMLElement>("[data-print-move]").forEach((bar) => {
    bar.onpointerdown = (event) => startDrag(event, bar.dataset.printMove!, "move");
  });
  document.querySelectorAll<HTMLElement>("[data-print-resize]").forEach((corner) => {
    corner.onpointerdown = (event) => startDrag(event, corner.dataset.printResize!, "resize");
  });
}
let projectPath: string | null = null,
  status = "R / flowCore に接続中…",
  failed = false;
let data: WorksheetResult = { plots: {}, stats: {}, errors: {}, workerPid: 0 };
let history: Project[] = [],
  future: Project[] = [];
const sheet = () =>
  project.worksheets!.find((s) => s.id === project.activeWorksheet)!;
const sample = (id = sampleId) => project.samples.find((s) => s.id === id);
const card = () => sheet().plots.find((p) => p.id === activeCard);
const worksheetMode = (): WorksheetMode => sheet().mode ?? "global";
const selectedPlots = () => {
  const current = sheet().plots.filter((p) => selectedCards.has(p.id));
  if (current.length) return current;
  const active = card();
  return active ? [active] : [];
};
const selectedWorksheetItems = () => [
  ...sheet().plots.filter((plot) => selectedCards.has(plot.id)),
  ...(sheet().widgets ?? []).filter((widget) => selectedWidgets.has(widget.id)),
];
const cardSample = (c: WorksheetPlot) =>
  sample(c.sampleId === "active" ? sampleId : c.sampleId);
function axisForSample(s: Sample, channel: string) {
  const fromStoredDefaults = project.divaAxisDefaults?.find(
    (item) => item.channel === channel,
  );
  const importedSheets = [...(project.worksheets ?? [])]
    .filter((worksheet) => !!worksheet.divaSourceId)
    .sort(
      (a, b) => Number(b.id === project.activeWorksheet) - Number(a.id === project.activeWorksheet),
    );
  const fromWorksheets = importedSheets
    .flatMap((worksheet) => worksheet.plots.flatMap((plot) => [plot.x, plot.y]))
    .find((item) => item.channel === channel);
  const fromGates = project.gates
    .filter((gate) => !!gate.divaSourceId && gateAppliesToSample(gate, s.id))
    .flatMap((gate) => [gate.x, gate.y])
    .find((item) => item.channel === channel);
  return structuredClone(
    fromStoredDefaults ?? fromWorksheets ?? fromGates ??
      axis(channel),
  );
}
function freePlotPosition(width: number, height: number, additional: WorksheetPlot[] = []) {
  const occupied = [
    ...sheet().plots.concat(additional).map((item) => ({ left: item.left, top: item.top, width: item.width, height: item.height })),
    ...(sheet().widgets ?? []).map((item) => ({ left: item.left, top: item.top, width: item.width, height: item.height })),
  ];
  for (let row = 0; row < 100; row++) {
    for (let column = 0; column < 100; column++) {
      const left = worksheetGrid.originX + column * worksheetGrid.columnStep;
      const top = worksheetGrid.originY + row * worksheetGrid.rowStep;
      if (!occupied.some((box) => left < box.left + box.width && left + width > box.left && top < box.top + box.height && top + height > box.top)) return { left, top };
    }
  }
  return { left: worksheetGrid.originX, top: worksheetGrid.originY };
}
function freePlotPositionNear(width: number, height: number, desired: number[]) {
  const occupied = [
    ...sheet().plots.map((item) => ({ left: item.left, top: item.top, width: item.width, height: item.height })),
    ...(sheet().widgets ?? []).map((item) => ({ left: item.left, top: item.top, width: item.width, height: item.height })),
  ];
  const overlaps = (left: number, top: number) => occupied.some((item) =>
    left < item.left + item.width && left + width > item.left && top < item.top + item.height && top + height > item.top,
  );
  if (!overlaps(Math.max(0, desired[0]), Math.max(0, desired[1])))
    return { left: Math.max(0, desired[0]), top: Math.max(0, desired[1]) };
  const candidates = Array.from({ length: 64 * 64 }, (_, index) => {
    const column = index % 64, row = Math.floor(index / 64);
    const left = worksheetGrid.originX + column * worksheetGrid.columnStep;
    const top = worksheetGrid.originY + row * worksheetGrid.rowStep;
    return { left, top, distance: (left - desired[0]) ** 2 + (top - desired[1]) ** 2 };
  }).sort((a, b) => a.distance - b.distance);
  const position = candidates.find((candidate) => !overlaps(candidate.left, candidate.top));
  return position ? { left: position.left, top: position.top } : freePlotPosition(width, height);
}
function newSamplePlot(s: Sample, index: number, population: string[] = []) {
  const plot = newPlot(s, index, population);
  plot.x = axisForSample(s, plot.x.channel);
  plot.y = axisForSample(s, plot.y.channel);
  Object.assign(plot, freePlotPosition(plot.width, plot.height));
  return plot;
}
function updatePlotSelectionControls() {
  const plots = sheet().plots;
  const allSelected = plots.length > 0 && plots.every((plot) => selectedCards.has(plot.id));
  const button = document.querySelector<HTMLButtonElement>("#select-all-plots");
  if (button) {
    button.textContent = allSelected ? "選択解除" : "全プロット選択";
    button.setAttribute("aria-pressed", String(allSelected));
  }
  const info = document.querySelector<HTMLElement>("#selection-info");
  if (info) info.textContent = `選択: ${selectedCards.size + selectedWidgets.size || (card() ? 1 : 0)}`;
  const alignmentMenu = document.querySelector<HTMLDetailsElement>("#align-items-menu");
  const alignmentSummary = alignmentMenu?.querySelector<HTMLElement>("summary");
  const alignable = selectedWorksheetItems().length >= 2;
  alignmentMenu?.classList.toggle("disabled", !alignable);
  if (alignmentSummary) {
    alignmentSummary.setAttribute("aria-disabled", String(!alignable));
    alignmentSummary.title = alignable ? "選択したプロットとウィジェットの位置を揃える" : "位置を揃えるには2個以上を選択してください";
  }
  alignmentMenu?.querySelectorAll<HTMLButtonElement>("[data-align-items]").forEach((button) => {
    button.disabled = !alignable;
  });
}
function syncWorksheetSelection() {
  document.querySelectorAll<HTMLInputElement>("[data-select-card]").forEach((input) => {
    const selected = selectedCards.has(input.dataset.selectCard ?? "");
    input.checked = selected;
    input.closest(".plot-card")?.classList.toggle("selected-card", selected);
  });
  document.querySelectorAll<HTMLInputElement>("[data-select-widget]").forEach((input) => {
    const selected = selectedWidgets.has(input.dataset.selectWidget ?? "");
    input.checked = selected;
    input.closest(".statistics-widget,.compensation-widget")?.classList.toggle("selected-widget", selected);
  });
  updatePlotSelectionControls();
}
function wireSelectionMarquee(board: HTMLElement) {
  board.addEventListener("pointerdown", (event) => {
    const target = event.target as Element;
    if (event.button !== 0 || (target !== board && !target.closest(".empty"))) return;
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    const originalCards = new Set(selectedCards);
    const originalWidgets = new Set(selectedWidgets);
    const initialCards = additive ? new Set(originalCards) : new Set<string>();
    const initialWidgets = additive ? new Set(originalWidgets) : new Set<string>();
    if (!additive) {
      selectedCards.clear();
      selectedWidgets.clear();
      syncWorksheetSelection();
    }
    const rect = board.getBoundingClientRect();
    const zoom = rect.width / Math.max(1, board.offsetWidth) || 1;
    const startX = (event.clientX - rect.left) / zoom;
    const startY = (event.clientY - rect.top) / zoom;
    const marquee = document.createElement("div");
    marquee.className = "selection-marquee";
    board.append(marquee);
    board.setPointerCapture(event.pointerId);
    let moved = false;
    const update = (pointer: PointerEvent) => {
      const currentX = (pointer.clientX - rect.left) / zoom;
      const currentY = (pointer.clientY - rect.top) / zoom;
      if (!moved && Math.hypot(currentX - startX, currentY - startY) < 5) return;
      moved = true;
      const left = Math.min(startX, currentX), right = Math.max(startX, currentX);
      const top = Math.min(startY, currentY), bottom = Math.max(startY, currentY);
      Object.assign(marquee.style, {
        left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px`,
      });
      selectedCards.clear();
      initialCards.forEach((id) => selectedCards.add(id));
      selectedWidgets.clear();
      initialWidgets.forEach((id) => selectedWidgets.add(id));
      for (const plot of sheet().plots) {
        if (plot.left <= right && plot.left + plot.width >= left && plot.top <= bottom && plot.top + plot.height >= top)
          selectedCards.add(plot.id);
      }
      for (const widget of sheet().widgets ?? []) {
        if (widget.left <= right && widget.left + widget.width >= left && widget.top <= bottom && widget.top + widget.height >= top)
          selectedWidgets.add(widget.id);
      }
      syncWorksheetSelection();
    };
    const finish = (pointer: PointerEvent) => {
      if (pointer.pointerId !== event.pointerId) return;
      update(pointer);
      if (!moved && !additive) {
        selectedCards.clear();
        selectedWidgets.clear();
        syncWorksheetSelection();
      }
      board.removeEventListener("pointermove", update);
      board.removeEventListener("pointerup", finish);
      board.removeEventListener("pointercancel", cancel);
      marquee.remove();
      if (board.hasPointerCapture(pointer.pointerId)) board.releasePointerCapture(pointer.pointerId);
    };
    const cancel = (pointer: PointerEvent) => {
      if (pointer.pointerId !== event.pointerId) return;
      board.removeEventListener("pointermove", update);
      board.removeEventListener("pointerup", finish);
      board.removeEventListener("pointercancel", cancel);
      marquee.remove();
      selectedCards.clear();
      originalCards.forEach((id) => selectedCards.add(id));
      selectedWidgets.clear();
      originalWidgets.forEach((id) => selectedWidgets.add(id));
      syncWorksheetSelection();
      if (board.hasPointerCapture(pointer.pointerId)) board.releasePointerCapture(pointer.pointerId);
    };
    board.addEventListener("pointermove", update);
    board.addEventListener("pointerup", finish);
    board.addEventListener("pointercancel", cancel);
    event.preventDefault();
  });
}
function alignSelectedWorksheetItems(alignment: "left" | "center-x" | "right" | "top" | "center-y" | "bottom") {
  const items = selectedWorksheetItems();
  if (items.length < 2) return;
  const left = Math.min(...items.map((item) => item.left));
  const right = Math.max(...items.map((item) => item.left + item.width));
  const top = Math.min(...items.map((item) => item.top));
  const bottom = Math.max(...items.map((item) => item.top + item.height));
  remember();
  for (const item of items) {
    if (alignment === "left") item.left = left;
    else if (alignment === "center-x") item.left = (left + right - item.width) / 2;
    else if (alignment === "right") item.left = right - item.width;
    else if (alignment === "top") item.top = top;
    else if (alignment === "center-y") item.top = (top + bottom - item.height) / 2;
    else item.top = bottom - item.height;
  }
  changed(false);
  message(`${items.length}個の選択項目の位置を揃えました。`);
}
function updateSidebarVisibility() {
  const shell = document.querySelector<HTMLElement>(".shell");
  shell?.classList.toggle("sidebar-left-hidden", !leftSidebarVisible);
  const leftButton = document.querySelector<HTMLButtonElement>("#toggle-left-sidebar");
  if (leftButton) {
    leftButton.textContent = leftSidebarVisible ? "サンプル欄を隠す" : "サンプル欄を表示";
    leftButton.setAttribute("aria-pressed", String(!leftSidebarVisible));
  }
}
function normalizeWorksheetPlots(ws = sheet()) {
  const mode = ws.mode ?? "global";
  ws.mode = mode;
  const fallback = sampleId || project.samples[0]?.id || "";
  if (mode === "global") {
    // A Global worksheet always follows exactly one selected sample.
    for (const p of ws.plots) p.sampleId = "active";
    for (const widget of ws.widgets ?? []) {
      if (isStatisticsWidget(widget)) widget.sampleId = "active";
    }
  } else {
    // A Normal worksheet stores a concrete sample on every plot.
    for (const p of ws.plots) {
      if (p.sampleId === "active" || !project.samples.some((s) => s.id === p.sampleId))
        p.sampleId = fallback;
    }
    for (const widget of ws.widgets ?? []) {
      if (isStatisticsWidget(widget) &&
          (widget.sampleId === "active" || !project.samples.some((s) => s.id === widget.sampleId)))
        widget.sampleId = fallback;
    }
  }
}
type DisplayRange = [number, number];
function displayRange(value: unknown): DisplayRange | undefined {
  if (!Array.isArray(value) || value.length !== 2) return;
  const lo = Number(value[0]), hi = Number(value[1]);
  return Number.isFinite(lo) && Number.isFinite(hi) && lo < hi
    ? [lo, hi]
    : undefined;
}
function sameDisplayRange(a: DisplayRange | undefined, b: DisplayRange) {
  return !!a && a[0] === b[0] && a[1] === b[1];
}
function axisIsAuto(a: WorksheetPlot["x"]) {
  return a.autoRange === true || (a.min === undefined && a.max === undefined);
}
type RangeEntry = { plot: WorksheetPlot; result: WorksheetData };
function synchronizeAxisRanges(result: WorksheetResult) {
  let needsAnalyze = false;
  const setRange = (a: WorksheetPlot["x"], range: DisplayRange, expandAuto = false) => {
    const hasRange = a.min !== undefined && a.max !== undefined;
    if (a.autoRange !== true && (a.min !== undefined || a.max !== undefined)) return;
    if (a.autoRange === true && hasRange && (!expandAuto || (range[0] >= a.min! && range[1] <= a.max!))) return;
    a.autoRange = true;
    a.min = range[0];
    a.max = range[1];
  };
  const plots = sheet().plots;
  if (worksheetMode() === "global") {
    for (const plot of plots) {
      const d = result.plots[plot.id];
      if (!d) continue;
      for (const side of ["x", "y"] as const) {
        if (side === "y" && oneDimensional(plot)) continue;
        const range = displayRange(side === "x" ? d.xRange : d.yRange);
        if (!range) continue;
        setRange(plot[side], range);
        // The first result already uses this exact range, so no second R job is needed.
        d[side].min = range[0];
        d[side].max = range[1];
      }
    }
    return false;
  }
  if (worksheetMode() !== "normal") return false;
  const groups = new Map<string, RangeEntry[]>();
  for (const plot of plots) {
    const d = result.plots[plot.id];
    if (!d) continue;
    const key = JSON.stringify([
      plot.population,
      plot.mode,
      axisKey(plot.x),
      oneDimensional(plot) ? "count" : axisKey(plot.y),
    ]);
    const entries = groups.get(key) ?? [];
    entries.push({ plot, result: d });
    groups.set(key, entries);
  }
  const targetRange = (entries: RangeEntry[], side: AxisSide): DisplayRange | undefined => {
    const explicit = entries
      .map(({ plot }) => plot[side])
      .find((a) => a.autoRange !== true && a.min !== undefined && a.max !== undefined);
    if (explicit) return [explicit.min!, explicit.max!];
    const ranges = entries
      .map(({ result: d }) => displayRange(side === "x" ? d.xRange : d.yRange))
      .filter((range): range is DisplayRange => !!range);
    if (!ranges.length) return;
    const lo = Math.min(...ranges.map((range) => range[0]));
    const hi = Math.max(...ranges.map((range) => range[1]));
    return lo < hi ? [lo, hi] : undefined;
  };
  for (const entries of groups.values()) {
    for (const side of ["x", "y"] as const) {
      if (side === "y" && oneDimensional(entries[0].plot)) continue;
      const range = targetRange(entries, side);
      if (!range) continue;
      entries.forEach(({ plot, result: d }) => {
        const actual = displayRange(side === "x" ? d.xRange : d.yRange);
        const axisValue = plot[side];
        if (axisIsAuto(axisValue)) {
          if (!sameDisplayRange(actual, range)) needsAnalyze = true;
          else {
            d[side].min = range[0];
            d[side].max = range[1];
          }
        }
        setRange(axisValue, range, true);
      });
    }
  }
  return needsAnalyze;
}
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const fmt = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const rpc = <T>(
  action: string,
  args: Record<string, unknown> = {},
): Promise<T> => invoke("request", { payload: { action, ...args } });
const clone = () => structuredClone(project);
const compKey = (c: Sample["compensation"] | undefined) =>
  c
    ? JSON.stringify([
        c.enabled,
        c.channels,
        c.values.map((row) => row.map((v) => +v.toPrecision(10))),
      ])
    : "";
function remember() {
  history.push(clone());
  if (history.length > 40) history.shift();
  future = [];
  dirty = true;
}
function message(text: string, error = false) {
  status = text;
  failed = error;
  statusBar();
}
function statusBar() {
  const f = document.querySelector("footer");
  if (f) {
    f.className = `status ${pending ? "pending" : ""} ${failed ? "error" : ""}`;
    f.innerHTML = `<span class="led"></span><span>${esc(status)}</span><span class="spacer"></span><span>${dirty ? "未保存 · " : ""}${pending ? "再計算中 · 操作を続けられます" : "Ready"}${data.workerPid ? ` · R ${data.workerPid}` : ""}</span>`;
  }
  document.querySelector("#save")?.classList.toggle("dirty", dirty);
}
const jobs = new LatestJob<Record<string, unknown>, WorksheetResult>(
  (args) => rpc("worksheet", args),
  (result) => {
    data = result;
    failed = Object.keys(result.errors).length > 0;
    const synchronized = synchronizeAxisRanges(result);
    if (synchronized) {
      status = "サンプル間の表示範囲を揃えています…";
      analyze();
      return;
    }
    if (!operation)
      status = failed
        ? "一部のプロットを表示できません。各カードのエラーを確認してください。"
        : "更新完了 · 統計は全イベント / scatter表示は最大12,000";
  },
  (error) => {
    message(String(error), true);
    data = { ...data, plots: {}, stats: {} };
    if (!gesture) paint();
  },
  (value) => {
    pending = value;
    statusBar();
    document.querySelector(".board")?.classList.toggle("calculating", value);
    document.querySelectorAll(".statistics-widget, .compensation-widget").forEach((widget) => widget.classList.toggle("stale", value));
    if (!value && !gesture) paint();
  },
);
function analyze() {
  if (!sampleId) return;
  jobs.submit({
    project: clone(),
    sampleId,
    plots: structuredClone(sheet().plots),
    widgets: structuredClone((sheet().widgets ?? []).filter(isStatisticsWidget)),
  });
}
function changed(calculate = true) {
  render();
  if (calculate) analyze();
  else statusBar();
}
function statisticsWidgetSampleId(widget: StatisticsWidget) {
  if (worksheetMode() === "global") return sampleId;
  return widget.sampleId && widget.sampleId !== "active" && project.samples.some((item) => item.id === widget.sampleId)
    ? widget.sampleId
    : sampleId;
}
function statisticsWidgetContents(widget: StatisticsWidget) {
  const targetSampleId = statisticsWidgetSampleId(widget);
  const hidden = new Set(widget.hiddenPopulationPaths ?? []);
  const stats = (data.stats[targetSampleId] ?? []).filter((row) =>
    !hidden.has(JSON.stringify(row.id === "root" ? [] : pathFor(project, row.id, targetSampleId))));
  const columns = [
    ...(widget.showEvents !== false ? [{ key: "events", label: "Events" }] : []),
    ...(widget.showPercentParent !== false ? [{ key: "parent", label: "% Parent" }] : []),
    ...(widget.showPercentTotal !== false ? [{ key: "total", label: "% Total" }] : []),
    ...(widget.mfiChannels ?? []).map((channel) => ({ key: `mfi:${channel}`, label: `MFI · ${channel}` })),
  ];
  const rows = stats.map((s) => {
    const gate = s.id === "root" ? undefined : project.gates.find((g) => g.id === s.id && gateAppliesToSample(g, targetSampleId));
    const color = gate?.color ?? "#17699b";
    const values = columns.map((column) => {
      if (column.key === "events") return fmt(s.count);
      if (column.key === "parent") return fmt(s.percentParent);
      if (column.key === "total") return fmt(s.percentTotal);
      return fmt(s.medians[column.key.slice(4)] ?? null);
    });
    return `<tr data-pop="${esc(s.id)}" data-sample="${esc(targetSampleId)}"><td class="population-cell">${gate ? `<button type="button" class="gate-color-swatch" data-gate-color="${esc(gate.id)}" style="--swatch-color:${esc(color)}" title="${esc(gate.name)}の色を変更" aria-label="${esc(gate.name)}の色を変更"></button>` : '<span class="population-color-placeholder" aria-hidden="true"></span>'}<span>${esc(s.name)}</span>${gate ? `<button type="button" class="rename-pop" data-rename-pop="${esc(gate.id)}" title="${esc(gate.name)}の名前を変更" aria-label="${esc(gate.name)}の名前を変更">✎</button>` : ""}</td>${values.map((value) => `<td>${value}</td>`).join("")}</tr>`;
  }).join("");
  return `<div class="statistics-table-wrap"><table><thead><tr><th>Population</th>${columns.map((column) => `<th>${esc(column.label)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
function isStatisticsWidget(widget: WorksheetWidget): widget is StatisticsWidget {
  return widget.type !== "compensation";
}
function compensationWidgetSample(widget: CompensationWidget) {
  if (worksheetMode() === "global") return sample();
  if (widget.sampleId && widget.sampleId !== "active") return sample(widget.sampleId);
  return card() ? cardSample(card()!) : sample();
}
function compensationWidget(widget: CompensationWidget) {
  const source = compensationWidgetSample(widget);
  const comp = source?.compensation;
  const targets = widget.targetSampleIds ?? (source ? [source.id] : []);
  const visibleChannels = comp?.channels.filter((channel) => widget.visibleChannels === undefined || widget.visibleChannels.includes(channel)) ?? [];
  const visibleIndices = visibleChannels.map((channel) => comp!.channels.indexOf(channel));
  const matrix = comp && comp.channels.length && visibleIndices.length
    ? `<div class="matrix-wrap comp-widget-matrix"><table><thead><tr><th>Source ↓ / detector →</th>${visibleIndices.map((index) => `<th>${esc(comp.channels[index])}</th>`).join("")}</tr></thead><tbody>${visibleIndices.map((i) => `<tr><th>${esc(comp.channels[i] ?? "")}</th>${visibleIndices.map((j) => { const value = comp.values[i]?.[j] ?? 0; return `<td><input data-comp-matrix="${esc(widget.id)}" data-row="${i}" data-column="${j}" type="number" step="0.1" value="${+(value * 100).toFixed(6)}" ${i === j ? "disabled" : ""} aria-label="${esc(comp.channels[i] ?? "")} to ${esc(comp.channels[j] ?? "")} compensation percent"></td>`; }).join("")}</tr>`).join("")}</tbody></table></div>`
    : comp && comp.channels.length
      ? '<p class="hint">表示する蛍光が選択されていません。</p>'
    : '<p class="hint">編集できる補償チャンネルがありません。</p>';
  const channelVisibility = comp?.channels.length
    ? `<details class="comp-channel-visibility"><summary>表示する蛍光 · ${visibleChannels.length}/${comp.channels.length}</summary><div class="comp-channel-visibility-list">${comp.channels.map((channel) => `<label><input type="checkbox" data-comp-visible-channel="${esc(widget.id)}" value="${esc(channel)}" ${widget.visibleChannels === undefined || widget.visibleChannels.includes(channel) ? "checked" : ""}><span>${esc(channel)}</span></label>`).join("")}</div></details>`
    : "";
  const sourceOptions = worksheetMode() === "global"
    ? [{ value: "active", label: `選択中 · ${sample()?.name ?? "サンプルなし"}` }, ...project.samples.map((item) => ({ value: item.id, label: item.name }))]
    : project.samples.map((item) => ({ value: item.id, label: item.name }));
  const selectedSource = worksheetMode() === "global" ? "active" : widget.sampleId ?? (card() ? cardSample(card()!)?.id : sampleId) ?? "";
  const destinations = project.samples.map((target) => {
    const compatible = !!comp?.channels.length && comp.channels.every((channel) => target.channels.some((item) => item.id === channel));
    const checked = targets.includes(target.id) || (widget.targetSampleIds === undefined && target.id === source?.id);
    return `<label class="comp-target ${compatible ? "" : "incompatible"}" title="${compatible ? "" : "補償チャンネルが不足しています"}"><input type="checkbox" data-comp-target="${esc(widget.id)}" data-sample="${esc(target.id)}" ${checked ? "checked" : ""} ${compatible ? "" : "disabled"}><span>${esc(target.name)}</span>${target.id === source?.id ? '<small>編集中</small>' : ""}</label>`;
  }).join("");
  const presets = project.divaCompensations ?? [];
  const preset = presets.find((item) => item.active) ?? presets[0];
  const divaPresetControl = presets.length
    ? `<details class="comp-diva-presets"><summary>DIVA compensation preset · ${presets.length}</summary><label>DIVA行列<select data-diva-comp-preset="${esc(widget.id)}">${presets.map((item) => `<option value="${esc(item.id)}" ${item.id === preset?.id ? "selected" : ""}>${esc(item.name)} · ${esc(item.file)}</option>`).join("")}</select></label><button type="button" data-apply-diva-comp="${esc(widget.id)}">選択サンプルへ適用</button></details>`
    : "";
  return `<section class="compensation-widget ${pending ? "stale" : ""} ${selectedWidgets.has(widget.id) ? "selected-widget" : ""}" data-compensation-widget="${esc(widget.id)}" style="left:${widget.left}px;top:${widget.top}px;width:${widget.width}px;height:${widget.height}px"><header class="statistics-widget-head" data-move="widget:${esc(widget.id)}"><label class="plot-select" title="一括操作の対象"><input type="checkbox" data-select-widget="${esc(widget.id)}" ${selectedWidgets.has(widget.id) ? "checked" : ""} aria-label="ウィジェットを一括操作の対象にする"></label><span class="grip">⠿</span><strong>Compensation</strong><span class="widget-sample">${esc(source?.name ?? "サンプルなし")}</span><button type="button" data-remove-widget="${esc(widget.id)}" title="Compensationウィジェットを削除" aria-label="Compensationウィジェットを削除">×</button></header><div class="compensation-widget-content"><div class="comp-widget-controls"><label>編集中<select data-comp-source="${esc(widget.id)}" ${sourceOptions.length ? "" : "disabled"}>${selectOptions(sourceOptions, selectedSource)}</select></label><label class="check"><input type="checkbox" data-comp-enabled="${esc(widget.id)}" ${comp?.enabled ? "checked" : ""}> 補正 ON</label></div>${channelVisibility}${matrix}<fieldset class="comp-target-list"><legend>適用先（チェックしたサンプル）</legend><div>${destinations || '<p class="hint">サンプルがありません。</p>'}</div></fieldset><button type="button" class="primary" data-apply-comp-widget="${esc(widget.id)}" ${source && comp?.channels.length ? "" : "disabled"}>編集行列を適用</button>${divaPresetControl}</div><div class="resize-grip" data-resize="widget:${esc(widget.id)}" title="サイズを変更">◢</div></section>`;
}
function statisticsWidget(widget: StatisticsWidget) {
  const targetSampleId = statisticsWidgetSampleId(widget);
  const sampleLabel = sample(targetSampleId)?.name ?? "選択サンプル";
  const sampleControl = worksheetMode() === "normal"
    ? `<label class="statistics-widget-sample-control"><span>Sample</span><select data-statistics-sample="${esc(widget.id)}" aria-label="統計ウィジェットのサンプル" ${project.samples.length ? "" : "disabled"}>${selectOptions(project.samples.map((item) => ({ value: item.id, label: item.name })), targetSampleId)}</select></label>`
    : `<span class="widget-sample" data-global-statistics-sample="${esc(widget.id)}">Global · ${esc(sampleLabel)}</span>`;
  return `<section class="statistics statistics-widget ${pending ? "stale" : ""} ${selectedWidgets.has(widget.id) ? "selected-widget" : ""}" data-statistics-widget="${esc(widget.id)}" style="left:${widget.left}px;top:${widget.top}px;width:${widget.width}px;height:${widget.height}px"><header class="statistics-widget-head" data-move="widget:${esc(widget.id)}"><label class="plot-select" title="一括操作の対象"><input type="checkbox" data-select-widget="${esc(widget.id)}" ${selectedWidgets.has(widget.id) ? "checked" : ""} aria-label="ウィジェットを一括操作の対象にする"></label><span class="grip">⠿</span><strong>Population statistics</strong>${sampleControl}<button type="button" data-statistics-options="${esc(widget.id)}" title="表示項目を設定" aria-label="統計ウィジェットの表示項目を設定">⚙</button><button type="button" data-remove-widget="${esc(widget.id)}" title="統計ウィジェットを削除" aria-label="統計ウィジェットを削除">×</button></header><div class="statistics-widget-content" data-statistics-widget-body="${esc(widget.id)}">${statisticsWidgetContents(widget)}</div><div class="resize-grip" data-resize="widget:${esc(widget.id)}" title="統計ウィジェットのサイズを変更">◢</div></section>`;
}
function editStatisticsWidget(widget: StatisticsWidget) {
  const dialog = document.createElement("dialog");
  dialog.className = "axis-dialog statistics-settings-dialog";
  dialog.setAttribute("aria-label", "統計ウィジェットの表示項目");
  const channels = [...new Set(project.samples.flatMap((item) => item.channels.map((channel) => channel.id)))];
  const selected = new Set(widget.mfiChannels ?? []);
  const targetSampleId = statisticsWidgetSampleId(widget);
  const populationChoices = new Map<string, string>();
  populationChoices.set(JSON.stringify([]), "All events");
  for (const gate of project.gates.filter((item) => gateAppliesToSample(item, targetSampleId))) {
    const path = pathFor(project, gate.id, targetSampleId);
    populationChoices.set(JSON.stringify(path), ["All events", ...path].join(" / "));
  }
  const hidden = new Set(widget.hiddenPopulationPaths ?? []);
  dialog.innerHTML = `<form><div class="axis-dialog-heading"><h2>統計ウィジェットの表示項目</h2><button type="button" data-close aria-label="閉じる">×</button></div><p class="hint">表示する集団と統計列を選択します。初期状態では全集団を表示します。</p><fieldset><legend>表示する細胞集団</legend><div class="statistics-population-actions"><button type="button" data-populations-all>すべて表示</button><button type="button" data-populations-none>すべて非表示</button></div><div class="gate-display-list statistics-population-list">${[...populationChoices].map(([key, label]) => `<label><input type="checkbox" name="visiblePopulationPath" value="${esc(key)}" ${hidden.has(key) ? "" : "checked"}><span>${esc(label)}</span></label>`).join("")}</div></fieldset><fieldset><legend>基本統計</legend><div class="statistics-field-options"><label class="check"><input name="showEvents" type="checkbox" ${widget.showEvents !== false ? "checked" : ""}> Events</label><label class="check"><input name="showPercentParent" type="checkbox" ${widget.showPercentParent !== false ? "checked" : ""}> % Parent</label><label class="check"><input name="showPercentTotal" type="checkbox" ${widget.showPercentTotal !== false ? "checked" : ""}> % Total</label></div></fieldset><fieldset><legend>Median fluorescence intensity (MFI)</legend><div class="gate-display-list">${channels.map((channel) => `<label><input type="checkbox" name="mfiChannel" value="${esc(channel)}" ${selected.has(channel) ? "checked" : ""}><span></span><span>${esc(channel)}</span></label>`).join("")}</div></fieldset><div class="axis-dialog-actions"><button type="button" data-cancel>キャンセル</button><button type="submit" class="primary">適用</button></div></form>`;
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelector<HTMLButtonElement>("[data-close]")!.onclick = () => dialog.close();
  dialog.querySelector<HTMLButtonElement>("[data-cancel]")!.onclick = () => dialog.close();
  dialog.querySelector<HTMLButtonElement>("[data-populations-all]")!.onclick = () => dialog.querySelectorAll<HTMLInputElement>('[name="visiblePopulationPath"]').forEach((input) => { input.checked = true; });
  dialog.querySelector<HTMLButtonElement>("[data-populations-none]")!.onclick = () => dialog.querySelectorAll<HTMLInputElement>('[name="visiblePopulationPath"]').forEach((input) => { input.checked = false; });
  dialog.querySelector("form")!.onsubmit = (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    remember();
    widget.showEvents = form.has("showEvents");
    widget.showPercentParent = form.has("showPercentParent");
    widget.showPercentTotal = form.has("showPercentTotal");
    widget.mfiChannels = form.getAll("mfiChannel").map(String);
    const visible = new Set(form.getAll("visiblePopulationPath").map(String));
    widget.hiddenPopulationPaths = [...new Set([...(widget.hiddenPopulationPaths ?? []).filter((key) => !populationChoices.has(key)), ...[...populationChoices.keys()].filter((key) => !visible.has(key))])];
    dialog.close();
    changed(false);
  };
  dialog.showModal();
}
function tree() {
  return project.samples
    .map((s) => {
      const gateVisible = (g: Gate) =>
        gateFilter === "all" || gateScope(g) === gateFilter;
      const nodes = (id: string, depth: number): string => {
        const g = project.gates.find(
            (g) => g.id === id && gateAppliesToSample(g, s.id),
          ),
          stat = data.stats[s.id]?.find((st) => st.id === id);
        return (
          `<div class="population ${sampleId === s.id && project.selectedGate === id ? "selected" : ""}" draggable="true" data-pop="${esc(id)}" data-sample="${esc(s.id)}" style="padding-left:${12 + depth * 16}px"><span>◇ ${esc(g?.name ?? "All events")}</span>${g && gateScope(g) === "global" ? '<i class="scope-badge">全体</i>' : ""}<small>${pending ? "…" : fmt(stat?.count)}</small></div>` +
          project.gates
            .filter(
              (g) =>
                gateAppliesToSample(g, s.id) &&
                g.parent === id &&
                gateVisible(g),
            )
            .map((g) => nodes(g.id, depth + 1))
            .join("")
        );
      };
      return `<div class="sample-group"><button class="sample ${s.id === sampleId ? "selected" : ""}" type="button" data-sample="${esc(s.id)}" title="クリックで選択、↑↓キーで移動、ドラッグで並び替え"><span class="sample-drag-handle" aria-hidden="true">⠿</span> ${esc(s.name)}<small>${fmt(s.events)} events · ${s.compensation.enabled ? "Comp ON" : "Comp OFF"}</small></button>${s.id === sampleId ? nodes("root", 0) : ""}</div>`;
    })
    .join("");
}
function selectOptions(
  items: { value: string; label: string }[],
  value: string,
) {
  return items
    .map(
      (i) =>
        `<option value="${esc(i.value)}" ${i.value === value ? "selected" : ""}>${esc(i.label)}</option>`,
    )
    .join("");
}
function sortSamples(mode: "import" | "name" | "manual") {
  project.sampleSort = mode;
  if (mode === "import") project.samples.sort((a, b) => (a.importOrder ?? 0) - (b.importOrder ?? 0));
  if (mode === "name") project.samples.sort((a, b) => a.name.localeCompare(b.name, "ja", { numeric: true }) || (a.importOrder ?? 0) - (b.importOrder ?? 0));
}
function nextSampleImportOrder() {
  return Math.max(-1, ...project.samples.map((item) => item.importOrder ?? -1)) + 1;
}
function populationOptions(c: WorksheetPlot) {
  const s = cardSample(c);
  const paths = s
    ? [
        [],
        ...project.gates
          .filter((g) => gateAppliesToSample(g, s.id))
          .map((g) => pathFor(project, g.id, s.id)),
      ]
    : [[]];
  if (!paths.some((p) => JSON.stringify(p) === JSON.stringify(c.population)))
    paths.push(c.population);
  return selectOptions(
    paths.map((path) => ({
      value: JSON.stringify(path),
      label: ["All events", ...path].join(" / "),
    })),
    JSON.stringify(c.population),
  );
}
function plotCard(c: WorksheetPlot) {
  const channels = cardSample(c)?.channels ?? [];
  const binding =
    worksheetMode() === "global"
      ? `<span class="global-plot-sample" title="Global worksheetでは左のサンプル選択が全プロットに適用されます">Global · ${esc(sample()?.name ?? "選択サンプル")}</span>`
      : `<select data-binding="${c.id}" title="Normal sheet: プロットごとの固定サンプル">${selectOptions(
          project.samples.map((s) => ({
            value: s.id,
            label: `📌 ${s.name}`,
          })),
          c.sampleId,
        )}</select>`;
  return `<section class="plot-card ${activeCard === c.id ? "active" : ""} ${focusedCard === c.id ? "focused" : ""} ${selectedCards.has(c.id) ? "selected-card" : ""}" data-card="${c.id}" style="left:${c.left}px;top:${c.top}px;width:${c.width}px;height:${c.height}px"><div class="plot-head" data-move="${c.id}"><label class="plot-select" title="一括操作の対象"><input type="checkbox" data-select-card="${c.id}" ${selectedCards.has(c.id) ? "checked" : ""} aria-label="プロットを一括操作の対象にする"></label><span class="grip">⠿</span>${binding}<button data-swap="${c.id}" title="X / Y 軸を入れ替え" aria-label="X / Y 軸を入れ替え" ${oneDimensional(c) ? "disabled" : ""}>⇄</button><button data-focus="${c.id}" title="${focusedCard === c.id ? "ワークシートに戻る (Esc)" : "拡大して編集"}" aria-label="${focusedCard === c.id ? "ワークシートに戻る" : "拡大して編集"}">${focusedCard === c.id ? "↙" : "⛶"}</button><button data-duplicate="${c.id}" title="プロットを複製">⧉</button><button data-plot-options="${c.id}" title="プロット表示設定" aria-label="プロット表示設定">⚙</button><button data-remove="${c.id}" title="プロットを削除">×</button></div><div class="plot-pop"><button data-parent="${c.id}" aria-label="親集団に戻る" title="親集団に戻る" ${c.population.length ? "" : "disabled"}>↑</button><select data-population="${c.id}" aria-label="表示する集団">${populationOptions(c)}</select><button type="button" data-gate-display="${c.id}" title="軸が一致するゲートの表示・非表示を選択" aria-label="表示するゲートを選択">◇</button><select data-mode="${c.id}" title="グラフ形式">${selectOptions(plotModes, c.mode)}</select></div><div class="plot-stage ${c.showXAxis === false ? "hide-x-axis" : ""}" data-stage="${c.id}"><canvas></canvas><svg xmlns="http://www.w3.org/2000/svg"></svg><div class="plot-error"></div>${axisLabels(c, channels)}</div><div class="resize-grip" data-resize="${c.id}" title="サイズを変更">◢</div></section>`;
}
function inspector() {
  const c = card();
  const g = project.gates.find((g) => g.id === selectedGate);
  return `<h2>Graph properties</h2>${
    c
      ? `<div class="axis-summary"><p class="hint">軸名をクリックしてチャンネルを選択。右クリック、または T でスケールを調整。</p>${(["x", "y"] as const).map((k) => `<button data-inspect-axis="${k}" ${k === "y" && oneDimensional(c) ? "disabled" : ""}><strong>${k.toUpperCase()} · ${k === "y" && oneDimensional(c) ? "Count" : esc(c[k].channel)}</strong><small>${k === "y" && oneDimensional(c) ? "イベント数" : `${scaleLabel(c[k].scale)} · ${c[k].min === undefined ? "Auto range" : `${c[k].min} ～ ${c[k].max}`}`}</small><span>詳細…</span></button>`).join("")}</div>`
      : '<p class="hint">プロットを選択して軸を調整します。</p>'
  }
 ${g ? `<h2>Gate editor</h2><label>集団名<input id="gate-name" value="${esc(g.name)}"></label><label>適用範囲<select id="gate-scope"><option value="sample" ${gateScope(g) === "sample" ? "selected" : ""}>個別適用（${esc(g.sampleId)}）</option><option value="global" ${gateScope(g) === "global" ? "selected" : ""}>全体適用（全サンプル）</option></select></label><div class="hint">線をドラッグして移動。白い点をドラッグして形を変更。四分割の中心は4集団まとめて移動します。</div><button id="gate-parent">親集団で編集</button><button id="gate-child">子集団のプロットを開く</button><button id="delete-gate" class="danger">ゲートと子集団を削除</button>` : ""}
  <p class="hint">Compensationはワークシート上の「Compensation調整」ウィジェットで、プロットを見ながら編集・適用できます。</p>
  <details><summary>実験ノート / import情報</summary><textarea id="notes">${esc(project.notes)}</textarea><p class="hint">${esc(project.importWarnings.join("\n"))}</p></details>`;
}
function render() {
  normalizeWorksheetPlots();
  const currentWidgetIds = new Set((sheet().widgets ?? []).map((widget) => widget.id));
  for (const id of selectedWidgets) if (!currentWidgetIds.has(id)) selectedWidgets.delete(id);
  // An async load/analyze can finish just after a user opens the axis dialog.
  // Keep that dialog stable until the user closes it instead of destroying it
  // during the intermediate render.
  if (!operation || !document.querySelector("dialog.axis-dialog[open]"))
    closeAxisUI();
  closeMenu();
  if (!sheet().plots.some((p) => p.id === focusedCard)) focusedCard = "";
  document.body.classList.toggle("plot-focused", !!focusedCard);
  const scroll = document.querySelector(".viewport"),
    sx = scroll?.scrollLeft ?? 0,
    sy = scroll?.scrollTop ?? 0;
  const widgets = sheet().widgets ?? [];
  const statisticsWidgets = widgets.filter(isStatisticsWidget);
  const compensationWidgets = widgets.filter((widget): widget is CompensationWidget => widget.type === "compensation");
  const printPages = sheet().printPages ?? [];
  const boardWidth = Math.max(1120, ...sheet().plots.map((c) => c.left + c.width + 30), ...widgets.map((w) => w.left + w.width + 30), ...printPages.map((page) => page.left + printPageSize(page).width + 30));
  const boardHeight = Math.max(710, ...sheet().plots.map((c) => c.top + c.height + 40), ...widgets.map((w) => w.top + w.height + 40), ...printPages.map((page) => page.top + printPageSize(page).height + 40));
  const gridColumns = Math.min(8, Math.max(1, Math.ceil(Math.sqrt(Math.max(1, sheet().plots.length)))));
  const gridRows = Math.min(20, Math.max(1, Math.ceil(Math.max(1, sheet().plots.length) / gridColumns)));
  app.innerHTML = `<header><strong>FlowDesk <span>WORKSPACE</span></strong><input id="experiment" value="${esc(project.name)}" aria-label="Experiment name"><span class="spacer"></span><span>R / flowCore · 0.4.0</span></header><nav class="toolbar"><button id="import" class="primary">＋ FCS</button><button id="folder">DIVAフォルダ</button><button id="diva">DIVA XML</button><button id="demo">デモ</button><span class="divider"></span><button id="load">開く</button><button id="save">保存</button><button id="undo" ${history.length ? "" : "disabled"} title="Ctrl+Z">↶ 戻す</button><button id="redo" ${future.length ? "" : "disabled"} title="Ctrl+Y">↷ やり直す</button><span class="spacer"></span><button id="batch" title="個別ゲートの階層を他サンプルへコピー">ゲート階層コピー</button><button id="csv" title="全サンプル・全分画の統計をCSVで出力">統計 CSV</button><button id="pdf">Worksheet PDF</button><button id="report">全サンプル report</button><button id="template" title="現在のワークシートとゲート定義だけをテンプレート保存">テンプレート</button><button id="toggle-properties" title="軸・補正・分画の詳細設定">解析設定</button></nav><div class="shell"><aside class="browser"><h2>Samples & populations <span>${project.samples.length}</span></h2><div id="tree">${tree()}</div><div class="hint tree-help">集団をダブルクリック、またはワークシートへドラッグしてプロットを追加。Globalは1サンプル、Normalは複数サンプルを比較します。</div><button id="show-population">選択集団をプロットに追加</button></aside><main><div class="sheet-tabs">${project.worksheets!.map((s) => `<button data-sheet="${s.id}" class="${s.id === sheet().id ? "active" : ""}">${esc(s.name)} <small>${s.mode === "normal" ? "Normal" : "Global"} · ${s.plots.length}</small></button>`).join("")}<button id="new-sheet" title="ワークシートを追加">＋</button><button id="clone-sheet" title="ワークシートを複製">⧉</button></div><div class="workspace-heading"><input id="sheet-name" value="${esc(sheet().name)}" aria-label="Worksheet name"><div class="sheet-mode" aria-label="ワークシートモード"><span>Mode:</span><button type="button" data-sheet-mode="global" class="${worksheetMode() === "global" ? "active" : ""}" title="選択サンプルを全プロットへ一括適用">Global</button><button type="button" data-sheet-mode="normal" class="${worksheetMode() === "normal" ? "active" : ""}" title="サンプルごとに固定したプロットを比較">Normal</button></div><button id="add-plot" class="primary">＋ Plot</button><button id="add-print-page" title="A4の印刷範囲を追加">＋ A4ページ</button><details class="widget-add-menu"><summary title="ワークシートウィジェットを追加">＋ ウィジェット</summary><div><button id="statistics-widget-settings" type="button">Population statistics</button><button id="compensation-widget-add" type="button">Compensation調整</button></div></details><details class="worksheet-actions-menu"><summary>解析操作 ▾</summary><div><button id="standard-expansion" type="button" title="FSC/SSCの定型展開を追加">FSC / SSC 定型展開</button><button id="compensation-expansion" type="button" title="FSC-Aを横軸、選択蛍光を縦軸にしたコンペ調整用プロットを作成">Comp定型解析</button><button id="batch-plots-sheet" type="button" title="選択したプロット・ウィジェットを他サンプルへ展開" ${worksheetMode() === "normal" ? "" : "disabled"}>Normal 選択項目を展開</button></div></details><div class="grid-arrange-control"><button id="arrange" title="各プロットを最も近いグリッドに揃える">グリッド整列</button><details class="grid-arrange-menu"><summary aria-label="グリッド配置の行数と列数を選択" title="行数と列数を指定">▾</summary><form id="grid-arrange-form"><strong>配置グリッド</strong><div class="grid-fields"><label>行<input name="rows" type="number" min="1" max="20" value="${gridRows}"></label><label>列<input name="columns" type="number" min="1" max="20" value="${gridColumns}"></label></div><label>対象<select name="scope"><option value="all">ワークシート全体</option><option value="selected">選択プロット</option></select></label><button class="primary" type="submit">この行 × 列で配置</button></form></details></div><span class="zoom-controls"><button id="zoom-out">−</button><output id="zoom-value">100%</output><button id="zoom-in">＋</button><button id="zoom-reset">1:1</button></span><span id="selection-info" class="selection-info">選択: ${selectedPlots().length}</span><span class="spacer"></span><div class="gate-tools">${[
    ["select", "選択 / 編集"],
    ["rectangle", "矩形"],
    ["polygon", "多角形"],
    ["ellipse", "楕円"],
    ["range", "範囲"],
    ["quadrant", "四分割"],
  ]
    .map(
      ([id, label]) =>
        `<button data-tool="${id}" class="${tool === id ? "active" : ""}">${label}</button>`,
    )
    .join(
      "",
    )}</div><div class="gate-scope" aria-label="分画の適用範囲"><span>新規分画:</span><button type="button" data-gate-scope="sample" class="${gateScopeMode === "sample" ? "active" : ""}" title="選択中のサンプルだけに適用">個別適用</button><button type="button" data-gate-scope="global" class="${gateScopeMode === "global" ? "active" : ""}" title="全サンプルに適用">全体適用</button></div><div class="gate-filter" aria-label="分画表示"><span>分画:</span><button type="button" data-gate-filter="all" class="${gateFilter === "all" ? "active" : ""}">すべて</button><button type="button" data-gate-filter="global" class="${gateFilter === "global" ? "active" : ""}">Global</button><button type="button" data-gate-filter="sample" class="${gateFilter === "sample" ? "active" : ""}">個別</button></div></div><div class="viewport"><div class="board" style="width:${boardWidth}px;height:${boardHeight}px">${printPages.map(printPageMarkup).join("")}${sheet().plots.map(plotCard).join("")}${statisticsWidgets.map(statisticsWidget).join("")}${compensationWidgets.map(compensationWidget).join("")}${!sheet().plots.length && !widgets.length ? '<div class="empty"><h1>' + (worksheetMode() === "normal" ? "Normal sheet" : "Global worksheet") + '</h1><p>' + (worksheetMode() === "normal" ? "複数サンプルの分画プロットを並べて比較できます。" : "選択中の1サンプルを共通軸で解析します。") + '<br>左の集団をドラッグ、または「＋ Plot」で始めます。</p></div>' : ""}</div></div></main></div><footer></footer>`;
  document.querySelector<HTMLElement>(".browser h2")?.insertAdjacentHTML("afterend", `<label class="sample-sort-control">並び順 <select id="sample-sort" aria-label="サンプルの並び順">${selectOptions([{ value: "import", label: "取り込み順" }, { value: "name", label: "名前順" }, { value: "manual", label: "手動" }], project.sampleSort ?? "import")}</select></label>`);
  document.querySelector<HTMLElement>(".toolbar")?.insertAdjacentHTML(
    "beforeend",
    '<button id="toggle-left-sidebar" type="button" aria-label="サンプル欄を切り替え" title="サンプルと集団のサイドバーを表示・非表示">サンプル欄を隠す</button>',
  );
  updateSidebarVisibility();
  document.querySelector<HTMLElement>("#selection-info")?.insertAdjacentHTML(
    "beforebegin",
    '<button id="select-all-plots" class="workspace-batch-control" type="button" title="ワークシートの全プロットを選択">全プロット選択</button><button id="batch-size" class="workspace-batch-control" type="button" title="選択プロットの幅と高さを統一">サイズ統一</button><details id="align-items-menu" class="align-items-menu"><summary aria-disabled="true" title="位置を揃えるには2個以上を選択してください">位置揃え ▾</summary><div role="group" aria-label="選択項目の位置揃え"><button type="button" data-align-items="left" disabled>左揃え</button><button type="button" data-align-items="center-x" disabled>横中央</button><button type="button" data-align-items="right" disabled>右揃え</button><button type="button" data-align-items="top" disabled>上揃え</button><button type="button" data-align-items="center-y" disabled>縦中央</button><button type="button" data-align-items="bottom" disabled>下揃え</button></div></details>',
  );
  updatePlotSelectionControls();
  const board = document.querySelector<HTMLElement>(".board")!;
  board.style.zoom = String(sheet().zoom ?? 1);
  document.querySelector<HTMLOutputElement>("#zoom-value")!.value = String(Math.round((sheet().zoom ?? 1) * 100)) + "%";
  const viewport = document.querySelector(".viewport")!;
  viewport.scrollLeft = sx;
  viewport.scrollTop = sy;
  wire();
  paint();
  statusBar();
}
function decorateSampleOrder() {
  document.querySelectorAll<HTMLButtonElement>(".sample[data-sample]").forEach((sampleButton) => {
    if (sampleButton.parentElement?.querySelector(".sample-order")) return;
    const controls = document.createElement("span");
    controls.className = "sample-order";
    for (const [label, delta] of [["↑", -1], ["↓", 1]] as const) {
      const button = document.createElement("button");
      button.textContent = label;
      button.title = delta < 0 ? "サンプルを上へ" : "サンプルを下へ";
      button.onclick = (event) => {
        event.stopPropagation();
        const index = project.samples.findIndex((item) => item.id === sampleButton.dataset.sample);
        const destination = index + delta;
        if (index < 0 || destination < 0 || destination >= project.samples.length) return;
        remember();
        [project.samples[index], project.samples[destination]] = [project.samples[destination], project.samples[index]];
        sortSamples("manual");
        changed(false);
      };
      controls.append(button);
    }
    sampleButton.parentElement?.append(controls);
  });
}
function paint() {
  if (gesture) return;
  document.querySelectorAll<HTMLElement>("#tree .population[data-pop]").forEach((row) => {
    const stat = data.stats[row.dataset.sample!]?.find((item) => item.id === row.dataset.pop);
    const count = row.querySelector("small");
    if (count) count.textContent = pending ? "…" : fmt(stat?.count);
    row.classList.toggle("selected", row.dataset.sample === sampleId && row.dataset.pop === project.selectedGate);
  });
  document.querySelectorAll<HTMLElement>("[data-statistics-widget-body]").forEach((body) => { const widget = sheet().widgets?.find((item) => item.id === body.dataset.statisticsWidgetBody); if (widget && isStatisticsWidget(widget)) body.innerHTML = statisticsWidgetContents(widget); });
  document.querySelectorAll<HTMLElement>("[data-global-statistics-sample]").forEach((label) => { label.textContent = `Global · ${sample()?.name ?? "選択サンプル"}`; });
  for (const c of sheet().plots) {
    const stage = document.querySelector<HTMLElement>(`[data-stage="${c.id}"]`);
    if (!stage || !stage.clientWidth) continue;
    const result = data.plots[c.id];
    const matching =
      result &&
      result.sampleId === cardSample(c)?.id &&
      result.mode === c.mode &&
      result.gateId === resolveGate(project, c.population, result.sampleId) &&
      (["x", "y"] as const).every(
        (k) =>
          axisKey(c[k]) === axisKey(result[k]) &&
          c[k].min === result[k].min &&
          c[k].max === result[k].max,
      );
    const d = matching ? result : undefined,
      err = data.errors[c.id];
    const error = stage.querySelector<HTMLElement>(".plot-error")!;
    error.textContent = err ?? (!d ? "計算待ち…" : "");
    error.hidden = !!d && !err;
    stage.classList.toggle("invalid", !!err || !d);
    if (d && !err) {
      const displayedGate = d.gateId === "root" ? undefined : project.gates.find((g) => g.id === d.gateId && gateAppliesToSample(g, d.sampleId));
      draw(stage, d, { ...c, color: displayedGate?.color ?? c.color });
      overlay(
        stage,
        d,
        project.gates,
        selectedGate,
        undefined,
        [],
        data.stats[d.sampleId] ?? [],
        c,
      );
      gestures(stage, c, d, {
        project: () => project,
        statistics: () => data.stats[d.sampleId] ?? [],
        selected: () => selectedGate,
        tool: () => tool,
        select: (id) => {
          selectedGate = id;
          refreshInspector();
        },
        gesture: (active) => {
          gesture = active;
        },
        drill: (g) => drillInto(c, g),
        context: (e, hits) => openPlotMenu(c, e, hits),
        commit: commitGate,
      });
    }
  }
  statusBar();
}
function refreshInspector() {
  const dialog = document.querySelector<HTMLDialogElement>("#properties-dialog");
  if (!dialog) return;
  dialog.innerHTML = `<button id="close-properties" type="button">閉じる</button>${inspector()}`;
  dialog.querySelector<HTMLButtonElement>("#close-properties")!.onclick = () => dialog.close();
  wireInspector();
}
function activate(id: string) {
  activeCard = id;
  document
    .querySelectorAll<HTMLElement>("[data-card]")
    .forEach((el) => el.classList.toggle("active", el.dataset.card === id));
  refreshInspector();
}
function chooseSample(id: string) {
  sampleId = id;
  project.selectedGate = "root";
  selectedGate = "";
  data = { plots: {}, stats: {}, errors: {}, workerPid: data.workerPid };
  render();
  analyze();
}
function addPlot(
  population: string[] = [],
  sourceId = sampleId,
  at?: number[],
) {
  const s = sample(sourceId);
  if (!s) {
    message("FCSを取り込むか、デモを開いてください。");
    return;
  }
  remember();
  const c = newSamplePlot(s, sheet().plots.length, population);
  if (worksheetMode() === "normal") c.sampleId = sourceId;
  else c.sampleId = "active";
  if (at) {
    Object.assign(c, freePlotPositionNear(c.width, c.height, at));
  }
  sheet().plots.push(c);
  if (focusedCard) focusedCard = c.id;
  activeCard = c.id;
  changed();
}
function findChannel(s: Sample, preferred: string) {
  const exact = s.channels.find((c) => c.id === preferred);
  if (exact) return exact.id;
  const normalized = preferred.replace("-", "").toLowerCase();
  return s.channels.find(
    (c) => c.id.replace("-", "").toLowerCase() === normalized,
  )?.id;
}
function addStandardExpansion() {
  const current = card();
  const s = (current ? cardSample(current) : undefined) ?? sample();
  if (!s) {
    message("FCSを取り込むか、デモを開いてください。", true);
    return;
  }
  const population = current?.population ?? [];
  const definitions = [
    ["FSC-A", "SSC-A", "FSC-A vs SSC-A"],
    ["FSC-A", "FSC-H", "FSC-H vs FSC-A"],
    ["SSC-A", "SSC-H", "SSC-H vs SSC-A"],
  ] as const;
  const available = definitions.filter(
    ([x, y]) => findChannel(s, x) && findChannel(s, y),
  );
  if (!available.length) {
    message("FSC/SSCの定型チャンネル（A/H）が見つかりません。", true);
    return;
  }
  remember();
  const baseIndex = sheet().plots.length;
  available.forEach(([xName, yName], i) => {
    const p = newSamplePlot(s, baseIndex + i, population);
    p.x = axisForSample(s, findChannel(s, xName)!);
    p.y = axisForSample(s, findChannel(s, yName)!);
    p.sampleId = worksheetMode() === "normal"
      ? current?.sampleId ?? s.id
      : "active";
    sheet().plots.push(p);
  });
  activeCard = sheet().plots.at(-1)?.id ?? activeCard;
  changed();
  message(
    `${available.map(([, , label]) => label).join("・")} を追加しました。`,
  );
}
async function setSheetMode(mode: WorksheetMode) {
  if (worksheetMode() === mode) return;
  if (mode === "global") {
    const proceed = isTauri()
      ? await confirm("Normal worksheetの全プロットを選択中の1サンプルへ切り替えます。各プロットのサンプル指定は保持されません。Global worksheetへ変更しますか？", { title: "ワークシートモードの変更" })
      : window.confirm("Normal worksheetの全プロットを選択中の1サンプルへ切り替えます。Global worksheetへ変更しますか？");
    if (!proceed) return;
  }
  remember();
  sheet().mode = mode;
  if (mode === "normal") {
    for (const widget of sheet().widgets ?? []) {
      if (isStatisticsWidget(widget)) widget.sampleId = sampleId;
    }
  }
  normalizeWorksheetPlots();
  selectedCards.clear();
  changed();
  message(
    mode === "global"
      ? "Global worksheet: 1サンプルだけを全プロットへ表示します。"
      : "Normal sheet: プロットごとにサンプルと分画を固定して比較します。",
  );
}
function chooseCompensationChannels(channels: string[]): Promise<string[] | null> {
  const dialog = document.createElement("dialog");
  dialog.className = "axis-dialog";
  dialog.setAttribute("aria-label", "Compensation解析の蛍光Y軸を選択");
  dialog.innerHTML = `<form><div class="axis-dialog-heading"><h2>Compensation解析のY軸</h2><button type="button" data-close aria-label="閉じる">×</button></div><p class="hint">作成する蛍光チャンネルを選んでください。横軸はFSC-Aです。</p><div class="axis-dialog-actions"><button type="button" data-select-all>すべて選択</button><button type="button" data-select-none>すべて解除</button></div><div class="gate-display-list">${channels.map((channel) => `<label><input type="checkbox" name="channel" value="${esc(channel)}" checked><span></span><span>${esc(channel)}</span></label>`).join("")}</div><div class="axis-dialog-actions"><button type="button" data-cancel>キャンセル</button><button type="submit" class="primary">選択したY軸を追加</button></div></form>`;
  document.body.append(dialog);
  return new Promise((resolve) => {
    const close = (value: string[] | null) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    dialog.querySelectorAll<HTMLButtonElement>("[data-close],[data-cancel]").forEach(
      (button) => (button.onclick = () => close(null)),
    );
    dialog.querySelector<HTMLButtonElement>("[data-select-all]")!.onclick = () =>
      dialog.querySelectorAll<HTMLInputElement>('input[name="channel"]').forEach((input) => (input.checked = true));
    dialog.querySelector<HTMLButtonElement>("[data-select-none]")!.onclick = () =>
      dialog.querySelectorAll<HTMLInputElement>('input[name="channel"]').forEach((input) => (input.checked = false));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close(null);
    });
    dialog.querySelector("form")!.addEventListener("submit", (event) => {
      event.preventDefault();
      close([...dialog.querySelectorAll<HTMLInputElement>('input[name="channel"]:checked')].map((input) => input.value));
    });
    dialog.showModal();
  });
}
async function addCompensationAnalysis() {
  const activeCardObject = card();
  const s = (activeCardObject ? cardSample(activeCardObject) : undefined) ?? sample();
  if (!s) {
    message("FCSを取り込むか、デモを開いてください。", true);
    return;
  }
  const xId =
    findChannel(s, "FSC-A") ??
    findChannel(s, "FSC") ??
    s.channels.find((c) => /^FSC/i.test(c.id))?.id;
  const fluorescent = s.channels.filter(
    (c) => !/^(FSC|SSC|Time)/i.test(c.id),
  );
  if (!xId || !fluorescent.length) {
    message("FSC-Aまたは蛍光チャンネルが見つかりません。", true);
    return;
  }
  const population = card()?.population ?? [];
  const existing = new Set(
    sheet()
      .plots.filter((p) => p.population.join("|") === population.join("|"))
      .filter((p) => p.x.channel === xId)
      .map((p) => p.y.channel),
  );
  const channels = fluorescent.filter((c) => !existing.has(c.id));
  if (!channels.length) {
    message("この分画のコンペ定型プロットは既に作成されています。");
    return;
  }
  const selectedChannels = await chooseCompensationChannels(channels.map((channel) => channel.id));
  if (selectedChannels === null) return;
  if (!selectedChannels.length) {
    message("Y軸にする蛍光チャンネルを1つ以上選択してください。", true);
    return;
  }
  remember();
  const baseIndex = sheet().plots.length;
  selectedCards.clear();
  selectedChannels.forEach((channel, i) => {
    const ch = s.channels.find((item) => item.id === channel)!;
    const p = newSamplePlot(s, baseIndex + i, population);
    p.x = axisForSample(s, xId);
    p.y = axisForSample(s, ch.id);
    p.sampleId = worksheetMode() === "normal" ? s.id : "active";
    sheet().plots.push(p);
    selectedCards.add(p.id);
  });
  activeCard = sheet().plots[baseIndex]?.id ?? activeCard;
  ensureCompensationWidget(selectedChannels, s.id);
  changed();
  message(
    "コンペ調整用に" + selectedChannels.length + "プロットを追加しました。横軸は「一括変更」から変更できます。",
  );
}
function bulkPlotGateCandidates(sampleId: string) {
  const applicable = project.gates.filter((gate) => gateAppliesToSample(gate, sampleId));
  const result: { key: string; ids: string[]; label: string; color: string }[] = [];
  const seenQuadrants = new Set<string>();
  for (const gate of applicable) {
    let gates = [gate];
    let label = gate.name;
    if (gate.type === "quadrant" && gate.groupId) {
      if (seenQuadrants.has(gate.groupId)) continue;
      seenQuadrants.add(gate.groupId);
      gates = applicable.filter((peer) => peer.groupId === gate.groupId);
      label = `${gate.name.replace(/ Q[1-4]$/, "")}（四分割ゲート）`;
    }
    const key = JSON.stringify([pathFor(project, gate.parent, sampleId), label]);
    result.push({ key, ids: gates.map((item) => item.id), label, color: gate.color ?? "#303e48" });
  }
  return result;
}
function gateMatchesPlotAxes(gate: Gate, plot: WorksheetPlot) {
  return axisKey(gate.x) === axisKey(plot.x) &&
    (oneDimensional(plot)
      ? gate.type === "range"
      : gate.type !== "range" && axisKey(gate.y) === axisKey(plot.y));
}
function currentlyDisplayedGateIds(plot: WorksheetPlot, sampleId: string) {
  if (plot.displayGates !== undefined) return new Set(plot.displayGates);
  const parent = resolveGate(project, plot.population, sampleId);
  if (!parent) return new Set<string>();
  return new Set(project.gates.filter((gate) =>
    gate.parent === parent &&
    gateAppliesToSample(gate, sampleId) &&
    gateMatchesPlotAxes(gate, plot),
  ).map((gate) => gate.id));
}
function batchPlotSettingsDialog(initialSection: "all" | "gates" = "all") {
  const targets = selectedPlots();
  if (!targets.length) {
    message("変更するプロットを選択してください。");
    return;
  }
  const xChannels = [...new Set(targets.flatMap((plot) => cardSample(plot)?.channels.map((channel) => channel.id) ?? []))];
  const yChannels = [...new Set(targets.filter((plot) => !oneDimensional(plot)).flatMap((plot) => cardSample(plot)?.channels.map((channel) => channel.id) ?? []))];
  const populationChoiceByPath = new Map<string, { path: string[]; plots: Set<string> }>();
  const gateChoices = new Map<string, { key: string; ids: string[]; label: string; color: string; plots: Set<string> }>();
  const gateChoiceByPlot = new Map<string, Map<string, string[]>>();
  const displayedByPlot = new Map<string, Set<string>>();
  const targetById = new Map(targets.map((plot) => [plot.id, plot]));
  for (const plot of targets) {
    const sampleValue = cardSample(plot);
    if (!sampleValue) continue;
    const paths = [[], ...project.gates
      .filter((gate) => gateAppliesToSample(gate, sampleValue.id))
      .map((gate) => pathFor(project, gate.id, sampleValue.id))];
    for (const path of paths) {
      if (resolveGate(project, path, sampleValue.id) === undefined) continue;
      const key = JSON.stringify(path);
      const choice = populationChoiceByPath.get(key) ?? { path, plots: new Set<string>() };
      choice.plots.add(plot.id);
      populationChoiceByPath.set(key, choice);
    }
    displayedByPlot.set(plot.id, currentlyDisplayedGateIds(plot, sampleValue.id));
    const perPlotChoices = new Map<string, string[]>();
    for (const candidate of bulkPlotGateCandidates(sampleValue.id)) {
      const existing = gateChoices.get(candidate.key) ?? {
        key: candidate.key, ids: candidate.ids, label: candidate.label, color: candidate.color, plots: new Set<string>(),
      };
      existing.plots.add(plot.id);
      gateChoices.set(candidate.key, existing);
      perPlotChoices.set(candidate.key, candidate.ids);
    }
    gateChoiceByPlot.set(plot.id, perPlotChoices);
  }
  const choices = [...gateChoices.values()];
  const populationChoices = [...populationChoiceByPath.entries()]
    .sort((a, b) => a[1].path.length - b[1].path.length || a[0].localeCompare(b[0]));
  const sharedPopulation = targets.every((plot) => JSON.stringify(plot.population) === JSON.stringify(targets[0].population))
    ? JSON.stringify(targets[0].population)
    : "";
  const xValue = xChannels.includes(targets[0].x.channel) ? targets[0].x.channel : "";
  const yValue = yChannels.includes(targets[0].y.channel) ? targets[0].y.channel : "";
  const dialog = document.createElement("dialog");
  dialog.className = "axis-dialog batch-plot-settings-dialog";
  dialog.setAttribute("aria-label", "選択プロットの一括変更");
  const gatesInitiallyEnabled = initialSection === "gates";
  const populationMarkup = selectOptions([
    { value: "", label: "分画を選択してください" },
    ...populationChoices.map(([key, choice]) => ({
      value: key,
      label: `${["All events", ...choice.path].join(" / ")} · ${choice.plots.size}/${targets.length}プロットに存在`,
    })),
  ], sharedPopulation);
  const gateMarkup = choices.length ? choices.map((choice) => {
    const defaultChecked = [...choice.plots].every((id) =>
      (gateChoiceByPlot.get(id)?.get(choice.key) ?? []).every((gateId) => displayedByPlot.get(id)?.has(gateId)));
    const compatiblePlots = [...choice.plots].filter((id) => {
      const plot = targetById.get(id);
      return !!plot && (gateChoiceByPlot.get(id)?.get(choice.key) ?? []).some((gateId) => {
        const gate = project.gates.find((item) => item.id === gateId);
        return !!gate && gateMatchesPlotAxes(gate, plot);
      });
    }).length;
    return `<label><input type="checkbox" data-batch-gate-choice="${esc(choice.key)}" ${defaultChecked ? "checked" : ""} ${gatesInitiallyEnabled ? "" : "disabled"}><span class="gate-choice-color" style="--swatch-color:${esc(choice.color)}"></span><span>${esc(choice.label)} <small>· ${choice.plots.size}/${targets.length}に存在 · ${compatiblePlots}/${targets.length}で輪郭表示</small></span></label>`;
  }).join("") : '<p class="hint">ゲートがありません。</p>';
  dialog.innerHTML = `<form>
    <div class="axis-dialog-heading"><h2>選択プロットを一括変更</h2><button type="button" data-close aria-label="閉じる">×</button></div>
    <p class="hint">${targets.length}個の選択プロットが対象です。対象サンプルにないチャンネルや分画はスキップします。</p>
    <fieldset><legend>軸チャンネル</legend><div class="grid-fields">
      <label class="check"><input name="applyX" type="checkbox"> X軸<select name="xChannel" ${xChannels.length ? "" : "disabled"}>${selectOptions([{ value: "", label: "選択してください" }, ...xChannels.map((channel) => ({ value: channel, label: channel }))], xValue)}</select></label>
      <label class="check"><input name="applyY" type="checkbox"> Y軸<select name="yChannel" ${yChannels.length ? "" : "disabled"}>${selectOptions([{ value: "", label: "選択してください" }, ...yChannels.map((channel) => ({ value: channel, label: channel }))], yValue)}</select></label>
    </div></fieldset>
    <fieldset><legend>表示する分画</legend>
      <label class="check"><input name="applyPopulation" type="checkbox"> プロット内の細胞集団<select name="populationPath" aria-label="表示する分画">${populationMarkup}</select></label>
      <p class="hint">選んだ分画の細胞を、対象プロットに描画します。軸が違っていても変更できます。</p>
    </fieldset>
    <fieldset><legend>ゲート輪郭</legend>
      <label class="check"><input name="applyGates" type="checkbox" ${choices.length ? "" : "disabled"} ${gatesInitiallyEnabled ? "checked" : ""}> ゲート輪郭を一括設定</label>
      <p class="hint">表示中の細胞集団に関係なく、ゲート作成時とチャンネル・スケールが一致するプロットに輪郭を表示します。</p>
      <div class="gate-display-list" data-batch-gate-list ${choices.length ? "" : 'aria-disabled="true"'}>${gateMarkup}</div>
    </fieldset>
    <div class="axis-dialog-actions"><button type="button" data-cancel>キャンセル</button><button class="primary" type="submit">選択プロットへ適用</button></div>
  </form>`;
  document.body.append(dialog);
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.querySelectorAll<HTMLButtonElement>("[data-close],[data-cancel]").forEach((button) => (button.onclick = close));
  for (const [selectName, applyName] of [["xChannel", "applyX"], ["yChannel", "applyY"], ["populationPath", "applyPopulation"]] as const) {
    dialog.querySelector<HTMLSelectElement>(`[name="${selectName}"]`)!.onchange = () => {
      dialog.querySelector<HTMLInputElement>(`[name="${applyName}"]`)!.checked = true;
    };
  }
  const gateToggle = dialog.querySelector<HTMLInputElement>('[name="applyGates"]')!;
  gateToggle.onchange = () => dialog.querySelectorAll<HTMLInputElement>("[data-batch-gate-choice]").forEach((input) => (input.disabled = !gateToggle.checked));
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  dialog.querySelector("form")!.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(dialog.querySelector("form")!);
    const changeX = form.has("applyX"), changeY = form.has("applyY");
    const changePopulation = form.has("applyPopulation"), changeGates = form.has("applyGates");
    const xChannel = String(form.get("xChannel") ?? ""), yChannel = String(form.get("yChannel") ?? "");
    const populationValue = String(form.get("populationPath") ?? "");
    const chosenPopulation = populationChoiceByPath.get(populationValue);
    if (!changeX && !changeY && !changePopulation && !changeGates) { message("一括変更する項目を選択してください。"); return; }
    if ((changeX && !xChannel) || (changeY && !yChannel)) return;
    if (changePopulation && !chosenPopulation) { message("表示する分画を選択してください。", true); return; }
    const chosenGateKeys = new Set([...dialog.querySelectorAll<HTMLInputElement>("[data-batch-gate-choice]:checked")].map((input) => input.dataset.batchGateChoice!));
    remember();
    let changedX = 0, changedY = 0, changedPopulation = 0, changedGatesCount = 0;
    targets.forEach((plot) => {
      const target = cardSample(plot);
      if (!target) return;
      if (changeX && target.channels.some((channel) => channel.id === xChannel)) { plot.x = axisForSample(target, xChannel); changedX++; }
      if (changeY && !oneDimensional(plot) && target.channels.some((channel) => channel.id === yChannel)) { plot.y = axisForSample(target, yChannel); changedY++; }
      if (changePopulation && chosenPopulation && resolveGate(project, chosenPopulation.path, target.id) !== undefined) {
        plot.population = [...chosenPopulation.path];
        changedPopulation++;
      }
      if (changeGates) {
        const perPlotChoices = gateChoiceByPlot.get(plot.id) ?? new Map<string, string[]>();
        plot.displayGates = [...chosenGateKeys].flatMap((key) => perPlotChoices.get(key) ?? []);
        changedGatesCount++;
      }
    });
    close();
    changed();
    const details = [
      ...(changeX ? [`X軸 ${changedX}/${targets.length}プロット`] : []),
      ...(changeY ? [`Y軸 ${changedY}/${targets.length}プロット`] : []),
      ...(changePopulation ? [`表示分画 ${changedPopulation}/${targets.length}プロット`] : []),
      ...(changeGates ? [`ゲート輪郭 ${changedGatesCount}/${targets.length}プロット`] : []),
    ];
    message(`一括変更を適用しました: ${details.join("、")}。`);
  });
  dialog.showModal();
  const focusTarget = initialSection === "gates"
    ? dialog.querySelector<HTMLInputElement>('[data-batch-gate-choice]')
    : null;
  focusTarget?.focus();
}
function batchSizeDialog() {
  const targets = selectedPlots();
  if (!targets.length) {
    message("サイズを揃えるプロットを選択してください。", true);
    return;
  }
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-label", "選択プロットのサイズを統一");
  dialog.innerHTML = `<form><h2>選択プロットのサイズを統一</h2><p class="hint">${targets.length}個のプロットに同じ幅と高さを適用します。</p><div class="grid-fields"><label>幅 (px)<input name="width" type="number" min="280" max="2000" step="10" value="${worksheetGrid.columnStep}"></label><label>高さ (px)<input name="height" type="number" min="270" max="1600" step="10" value="${worksheetGrid.rowStep}"></label></div><div class="axis-dialog-actions"><button type="button" data-cancel>キャンセル</button><button type="submit" class="primary">サイズを統一</button></div></form>`;
  document.body.append(dialog);
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.querySelector<HTMLButtonElement>("[data-cancel]")!.onclick = close;
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.querySelector("form")!.addEventListener("submit", (event) => {
    event.preventDefault();
    const width = Number(dialog.querySelector<HTMLInputElement>('[name="width"]')!.value);
    const height = Number(dialog.querySelector<HTMLInputElement>('[name="height"]')!.value);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 280 || width > 2000 || height < 270 || height > 1600) return;
    remember();
    targets.forEach((plot) => {
      plot.width = width;
      plot.height = height;
    });
    close();
    changed(false);
    message(`${targets.length}個のプロットを${width} × ${height} pxに揃えました。`);
  });
  dialog.showModal();
}
function gridPlotPlacements(targets: WorksheetPlot[], rows: number, columns: number) {
  const targetIds = new Set(targets.map((plot) => plot.id));
  const occupied = [
    ...sheet().plots.filter((plot) => !targetIds.has(plot.id)),
    ...(sheet().widgets ?? []),
  ].map(({ left, top, width, height }) => ({ left, top, width, height }));
  const placements: { left: number; top: number; width: number; height: number }[] = [];
  for (let row = 0; row < rows && placements.length < targets.length; row++) {
    for (let column = 0; column < columns && placements.length < targets.length; column++) {
      const plot = targets[placements.length];
      const position = {
        left: worksheetGrid.originX + column * worksheetGrid.columnStep,
        top: worksheetGrid.originY + row * worksheetGrid.rowStep,
        width: plot.width,
        height: plot.height,
      };
      const overlaps = [...occupied, ...placements].some((box) =>
        position.left < box.left + box.width && position.left + position.width > box.left &&
        position.top < box.top + box.height && position.top + position.height > box.top,
      );
      if (!overlaps) placements.push(position);
    }
  }
  if (placements.length !== targets.length) return null;
  return targets.map((plot, index) => ({ plot, left: placements[index].left, top: placements[index].top }));
}
function commitGate(
  c: WorksheetPlot,
  d: WorksheetData,
  shape: Partial<Gate>,
  existing?: Gate,
) {
  const s = cardSample(c);
  if (
    !s ||
    s.id !== d.sampleId ||
    axisKey(c.x) !== axisKey(d.x) ||
    axisKey(c.y) !== axisKey(d.y) ||
    compKey(s.compensation) !== compKey(d.compensation) ||
    resolveGate(project, c.population, s.id) !== d.gateId ||
    c.x.min !== d.x.min ||
    c.x.max !== d.x.max ||
    c.y.min !== d.y.min ||
    c.y.max !== d.y.max
  ) {
    message("プロット更新後にゲートを編集してください。", true);
    paint();
    return;
  }
  remember();
  const geometry = { ...existing, ...shape } as Gate;
  const xCoordinates = geometry.type === "polygon" ? geometry.vertices?.map((v) => v[0]) : geometry.type === "range" ? geometry.bounds?.slice(0, 2) : geometry.bounds?.slice(0, 2);
  const yCoordinates = geometry.type === "polygon" ? geometry.vertices?.map((v) => v[1]) : geometry.type === "range" ? undefined : geometry.bounds?.slice(2, 4);
  const extent: Gate["edgeExtent"] = {};
  const detect = (values: number[] | undefined, range: [number, number], lo: "xMin" | "yMin", hi: "xMax" | "yMax") => {
    if (!values?.length) return;
    const tolerance = Math.abs(range[1] - range[0]) * 0.002;
    if (Math.abs(Math.min(...values) - range[0]) <= tolerance) extent[lo] = Math.min(...values);
    if (Math.abs(Math.max(...values) - range[1]) <= tolerance) extent[hi] = Math.max(...values);
  };
  detect(xCoordinates, d.xRange, "xMin", "xMax");
  detect(yCoordinates, d.yRange, "yMin", "yMax");
  if (existing) {
    const g = project.gates.find((g) => g.id === existing.id)!;
    Object.assign(g, shape);
    g.edgeExtent = extent;
    if (g.type === "quadrant" && g.groupId)
      project.gates
        .filter(
          (other) =>
            other.groupId === g.groupId && other.sampleId === g.sampleId,
        )
        .forEach((other) => (other.center = structuredClone(g.center)));
    selectedGate = g.id;
  } else {
    if (
      gateScopeMode === "global" &&
      d.gateId !== "root" &&
      project.gates.some(
        (parent) =>
          parent.id === d.gateId &&
          parent.sampleId === s.id &&
          gateScope(parent) !== "global",
      )
    ) {
      message(
        "全体適用の分画は、全体適用の親またはAll eventsから作成してください。",
        true,
      );
      paint();
      return;
    }
    let n = 1;
    while (
      project.gates.some(
        (g) =>
          (g.sampleId === s.id ||
            (gateScopeMode === "global" && gateScope(g) === "global")) &&
          (g.name === `P${n}` || g.name.startsWith(`P${n} Q`)),
      )
    )
      n++;
    const base: Gate = {
      ...shape,
      id: uid(),
      name: `P${n}`,
      sampleId: s.id,
      parent: d.gateId,
      type: shape.type ?? "rectangle",
      x: structuredClone(c.x),
      y: structuredClone(c.y),
      scope: gateScopeMode,
      color: populationPalette[project.gates.length % populationPalette.length],
      edgeExtent: extent,
    };
    delete base.x.min;
    delete base.x.max;
    delete base.y.min;
    delete base.y.max;
    if (base.type === "quadrant") {
      const groupId = uid();
      for (let q = 1; q <= 4; q++)
        project.gates.push({
          ...base,
          id: uid(),
          groupId,
          name: `P${n} Q${q}`,
          quadrant: q,
          color: base.color,
        });
      selectedGate = project.gates[project.gates.length - 4].id;
    } else {
      base.id = uid();
      project.gates.push(base);
      selectedGate = base.id;
    }
  }
  tool = "select";
  changed();
}
function drillInto(c: WorksheetPlot, g: Gate) {
  const targetSample = cardSample(c);
  if (!targetSample || !gateAppliesToSample(g, targetSample.id)) return;
  remember();
  // Keep the parent card fixed at its original position. Drilling down always
  // creates a new sibling card for the child population.
  const child = structuredClone(c);
  child.id = uid();
  child.left += c.width + 16;
  while (
    sheet().plots.some(
      (p) =>
        child.left < p.left + p.width &&
        child.left + child.width > p.left &&
        child.top < p.top + p.height &&
        child.top + child.height > p.top,
    )
  )
    child.left += child.width + 16;
  child.population = pathFor(project, g.id, g.sampleId);
  sheet().plots.push(child);
  project.selectedGate = g.id;
  selectedGate = "";
  activeCard = child.id;
  tool = "select";
  changed();
}
function parentPopulation(c: WorksheetPlot) {
  if (!c.population.length) return;
  remember();
  c.population = c.population.slice(0, -1);
  selectedGate = "";
  changed();
}
function plotOptions(c: WorksheetPlot) {
  activate(c.id);
  editPlotOptions(c, (value) => {
    remember();
    Object.assign(c, value);
    changed();
  });
}
function duplicatePlot(source: WorksheetPlot) {
  remember();
  const c = structuredClone(source);
  c.id = uid();
  c.left += c.width + 16;
  while (
    sheet().plots.some(
      (p) =>
        c.left < p.left + p.width &&
        c.left + c.width > p.left &&
        c.top < p.top + p.height &&
        c.top + c.height > p.top,
    )
  )
    c.left += c.width + 16;
  sheet().plots.push(c);
  activeCard = c.id;
  if (focusedCard) focusedCard = c.id;
  changed();
}
function removePlot(c: WorksheetPlot) {
  remember();
  selectedCards.delete(c.id);
  sheet().plots = sheet().plots.filter((p) => p.id !== c.id);
  if (activeCard === c.id) activeCard = sheet().plots[0]?.id ?? "";
  changed();
}
function renameGate(g: Gate, input: string): boolean {
  const name = input.trim();
  if (
    !name ||
    project.gates.some(
      (other) =>
        other.id !== g.id &&
        (other.sampleId === g.sampleId ||
          gateScope(g) === "global" ||
          gateScope(other) === "global") &&
        other.parent === g.parent &&
        other.name === name,
    )
  ) {
    message("同じ親集団に重複しない名前を入力してください。", true);
    return false;
  }
  if (name === g.name) return true;
  remember();
  const oldPath = pathFor(project, g.id, g.sampleId);
  g.name = name;
  for (const ws of project.worksheets!)
    for (const p of ws.plots)
      if (
        (gateScope(g) === "global" ||
          p.sampleId === "active" ||
          p.sampleId === g.sampleId) &&
        oldPath.every((v, i) => p.population[i] === v)
      )
        p.population[oldPath.length - 1] = name;
  changed();
  return true;
}
function renameGateDialog(g: Gate) {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-label", "集団名を変更");
  dialog.innerHTML = `<form><h2>集団名を変更</h2><label>集団名<input name="name" required></label><p role="alert"></p><div class="axis-dialog-actions"><button type="button">キャンセル</button><button class="primary" type="submit">名前を変更</button></div></form>`;
  const input = dialog.querySelector("input")!;
  input.value = g.name;
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.querySelector<HTMLButtonElement>('[type="button"]')!.onclick = close;
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  dialog.querySelector("form")!.onsubmit = (e) => {
    e.preventDefault();
    if (renameGate(g, input.value)) close();
    else
      dialog.querySelector('[role="alert"]')!.textContent =
        "名前が空欄、または同じ親集団内で重複しています。";
  };
  document.body.append(dialog);
  dialog.showModal();
  input.select();
}
function changeGateColor(g: Gate, color: string) {
  const targets = g.groupId
    ? project.gates.filter(
        (peer) =>
          peer.groupId === g.groupId &&
          (gateScope(g) === "global" || peer.sampleId === g.sampleId),
      )
    : [g];
  if (targets.every((item) => item.color === color)) return;
  remember();
  targets.forEach((item) => (item.color = color));
  changed();
}
function gateColorDialog(g: Gate) {
  const dialog = document.createElement("dialog");
  dialog.className = "gate-color-dialog";
  dialog.setAttribute("aria-label", `${g.name}の色を選択`);
  dialog.innerHTML = `<form method="dialog"><div class="axis-dialog-heading"><h2>分画の色</h2><button type="button" data-close aria-label="閉じる">×</button></div><p>${esc(g.name)}に適用する色を選んでください。</p><div class="swatch-grid">${populationPalette
    .map(
      (color, index) =>
        `<button type="button" class="color-swatch ${g.color === color ? "selected" : ""}" data-swatch="${color}" style="--swatch-color:${color}" aria-label="色 ${index + 1}: ${color}" title="${color}"></button>`,
    )
    .join("")}</div><div class="axis-dialog-actions"><span class="spacer"></span><button type="button" data-cancel>キャンセル</button></div></form>`;
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.querySelectorAll<HTMLButtonElement>("[data-close],[data-cancel]").forEach(
    (button) => (button.onclick = close),
  );
  dialog.querySelectorAll<HTMLButtonElement>("[data-swatch]").forEach(
    (button) =>
      (button.onclick = () => {
        changeGateColor(g, button.dataset.swatch!);
        close();
      }),
  );
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  document.body.append(dialog);
  dialog.showModal();
}
function removeGate(g: Gate) {
  remember();
  const grouped = g.groupId
      ? project.gates.filter((peer) => peer.groupId === g.groupId)
      : [g],
    removedPaths = grouped.map((peer) => pathFor(project, peer.id, peer.sampleId)),
    parent = pathFor(project, g.parent, g.sampleId);
  deleteBranch(project, g);
  const survivingGateIds = new Set(project.gates.map((item) => item.id));
  for (const ws of project.worksheets!)
    for (const p of ws.plots)
      if (
        (gateScope(g) === "global" ||
          p.sampleId === g.sampleId ||
          (p.sampleId === "active" && gateAppliesToSample(g, sampleId))) &&
        removedPaths.some((prefix) => prefix.every((v, i) => p.population[i] === v))
      )
        p.population = [...parent];
  for (const ws of project.worksheets!)
    for (const p of ws.plots)
      if (p.displayGates)
        p.displayGates = p.displayGates.filter((id) => survivingGateIds.has(id));
  selectedGate = "";
  changed();
  message(`「${g.name}」と子分画を削除しました。Ctrl+Zで復元できます。`);
}
function gateBranchForScope(g: Gate, targetSampleId: string) {
  const ids = new Set<string>([g.id]);
  if (g.groupId) {
    for (const peer of project.gates) {
      if (
        peer.groupId === g.groupId &&
        (gateScope(peer) === gateScope(g) || peer.sampleId === targetSampleId)
      )
        ids.add(peer.id);
    }
  }
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const child of project.gates) {
      if (ids.has(child.id) || !ids.has(child.parent)) continue;
      const include =
        gateScope(g) === "global"
          ? gateScope(child) === "global" || child.sampleId === targetSampleId
          : gateScope(child) === "sample" && child.sampleId === g.sampleId;
      if (include) {
        ids.add(child.id);
        expanded = true;
      }
    }
  }
  return project.gates.filter((candidate) => ids.has(candidate.id));
}
function changeGateScope(
  g: Gate,
  next: "global" | "sample",
  targetSampleId: string | undefined,
) {
  const target = targetSampleId ? sample(targetSampleId) : undefined;
  if (!target) {
    message("対象サンプルを選択してください。", true);
    return;
  }
  if (gateScope(g) === next && (next === "global" || g.sampleId === target.id)) {
    message(next === "global" ? "すでに全体ゲートです。" : "すでにこのサンプルの個別ゲートです。");
    return;
  }
  const branch = gateBranchForScope(g, target.id);
  const ids = new Set(branch.map((candidate) => candidate.id));
  if (
    next === "global" &&
    g.parent !== "root" &&
    project.gates.some(
      (parent) =>
        parent.id === g.parent &&
        !ids.has(parent.id) &&
        gateScope(parent) !== "global",
    )
  ) {
    message("個別親の下にある分画は全体ゲートへ変更できません。先に親を変更してください。", true);
    return;
  }
  const requiredChannels = branch.every(
    (candidate) =>
      target.channels.some((channel) => channel.id === candidate.x.channel) &&
      target.channels.some((channel) => channel.id === candidate.y.channel),
  );
  if (next === "sample") {
    if (!requiredChannels) {
      message("対象サンプルにゲートの軸チャンネルがありません。", true);
      return;
    }
  } else {
    const missing = project.samples.find(
      (candidate) =>
        !branch.every(
          (gate) =>
            candidate.channels.some((channel) => channel.id === gate.x.channel) &&
            candidate.channels.some((channel) => channel.id === gate.y.channel),
        ),
    );
    if (missing) {
      message("全サンプルに共通する軸チャンネルがないため変更できません。", true);
      return;
    }
  }
  for (const candidate of branch) {
    const conflict = project.gates.find(
      (other) =>
        !ids.has(other.id) &&
        other.parent === candidate.parent &&
        other.name === candidate.name &&
        (next === "global"
          ? true
          : gateAppliesToSample(other, target.id)),
    );
    if (conflict) {
      message("同じ親集団に同名の分画があるため変更できません。", true);
      return;
    }
  }
  remember();
  for (const candidate of branch) {
    candidate.scope = next;
    candidate.sampleId = next === "sample" ? target.id : target.id;
  }
  selectedGate = g.id;
  changed();
  message(
    next === "sample"
      ? "選択した分画をこのサンプルの個別ゲートへ移動しました。"
      : "選択した分画を全サンプル共通のGlobalゲートへ戻しました。",
  );
}
function preparePlotContextSelection(plot: WorksheetPlot) {
  if (!selectedCards.has(plot.id)) {
    selectedCards.clear();
    selectedWidgets.clear();
    selectedCards.add(plot.id);
  }
  activate(plot.id);
  document.querySelectorAll<HTMLInputElement>("[data-select-card]").forEach((input) => {
    const selected = selectedCards.has(input.dataset.selectCard ?? "");
    input.checked = selected;
    input.closest(".plot-card")?.classList.toggle("selected-card", selected);
  });
  document.querySelectorAll<HTMLInputElement>("[data-select-widget]").forEach((input) => {
    input.checked = selectedWidgets.has(input.dataset.selectWidget ?? "");
    input.closest(".statistics-widget,.compensation-widget")?.classList.toggle("selected-widget", input.checked);
  });
  updatePlotSelectionControls();
}
function prepareWidgetContextSelection(widget: WorksheetWidget) {
  if (!selectedWidgets.has(widget.id)) {
    selectedCards.clear();
    selectedWidgets.clear();
    selectedWidgets.add(widget.id);
  }
  document.querySelectorAll<HTMLInputElement>("[data-select-card]").forEach((input) => {
    input.checked = selectedCards.has(input.dataset.selectCard ?? "");
    input.closest(".plot-card")?.classList.toggle("selected-card", input.checked);
  });
  document.querySelectorAll<HTMLInputElement>("[data-select-widget]").forEach((input) => {
    input.checked = selectedWidgets.has(input.dataset.selectWidget ?? "");
    input.closest(".statistics-widget,.compensation-widget")?.classList.toggle("selected-widget", input.checked);
  });
  updatePlotSelectionControls();
}
function plotSettingsActions(): MenuAction[] {
  const targets = selectedPlots();
  const prefix = targets.length > 1 ? `選択した${targets.length}プロットの` : "";
  const hasGateChoices = targets.some((plot) => {
    const target = cardSample(plot);
    return !!target && bulkPlotGateCandidates(target.id).length > 0;
  });
  return [
    { label: `${prefix}軸・表示分画を変更…`, disabled: targets.every((plot) => !cardSample(plot)), run: () => batchPlotSettingsDialog("all") },
    { label: `${prefix}ゲート輪郭を選択…`, disabled: !hasGateChoices, run: () => batchPlotSettingsDialog("gates") },
    { label: "Normal: 選択項目を他サンプルへ展開…", disabled: worksheetMode() !== "normal", run: () => batchWorksheetItemsToSamples() },
  ];
}
function gateMenu(g: Gate, x: number, y: number, c?: WorksheetPlot, widget?: WorksheetWidget) {
  selectedGate = g.id;
  refreshInspector();
  const targetSampleId = c ? cardSample(c)?.id : sampleId;
  const stat = targetSampleId
    ? data.stats[targetSampleId]?.find((v) => v.id === g.id)
    : undefined;
  const actions: MenuAction[] = [
    {
      label: "この分画へ drill down",
      run: () =>
        c
          ? drillInto(c, g)
          : addPlot(
              pathFor(project, g.id, targetSampleId ?? g.sampleId),
              targetSampleId ?? g.sampleId,
            ),
    },
    {
      label: "この分画を新しいプロットで開く",
      run: () =>
        addPlot(
          pathFor(project, g.id, targetSampleId ?? g.sampleId),
          targetSampleId ?? g.sampleId,
        ),
    },
    // A right-click on a visible gate replaces the plot context menu. Keep
    // plot-level controls reachable there, especially displayed-gate settings.
    ...(c ? plotSettingsActions() : []),
    ...(widget ? [{ label: "Normal: 選択項目を他サンプルへ展開…", disabled: worksheetMode() !== "normal", run: () => batchWorksheetItemsToSamples() }] : []),
    { label: "集団名を変更…", run: () => renameGateDialog(g) },
    gateScope(g) === "global"
      ? {
          label: "このサンプルの個別ゲートへ移動",
          disabled: !targetSampleId,
          run: () => changeGateScope(g, "sample", targetSampleId),
        }
      : {
          label: "全体ゲートへ戻す",
          run: () => changeGateScope(g, "global", targetSampleId),
        },
    {
      label: "このサンプルの統計をCSV出力…",
      run: () => void exportStatistics(targetSampleId ?? g.sampleId),
    },
    { label: "ゲートと子分画を削除", run: () => removeGate(g), danger: true },
  ];
  contextMenu(
    x,
    y,
    `${g.name}${stat ? ` · ${stat.count.toLocaleString()} events` : ""}`,
    actions,
  );
}
function openPlotMenu(c: WorksheetPlot, e: MouseEvent, hits: Gate[]) {
  preparePlotContextSelection(c);
  if (hits.length === 1) {
    gateMenu(hits[0], e.clientX, e.clientY, c);
    return;
  }
  if (hits.length > 1) {
    contextMenu(
      e.clientX,
      e.clientY,
      "操作する分画を選択",
      [
        ...plotSettingsActions(),
        ...hits.map((g) => ({
          label: g.name,
          run: () => gateMenu(g, e.clientX, e.clientY, c),
        })),
      ],
    );
    return;
  }
  contextMenu(e.clientX, e.clientY, selectedPlots().length > 1 ? `${selectedPlots().length}プロットを選択中` : "プロット", [
    ...plotSettingsActions(),
    { label: "プロット表示設定…", run: () => plotOptions(c) },
    {
      label: "親集団に戻る",
      run: () => parentPopulation(c),
      disabled: !c.population.length,
    },
    {
      label: focusedCard ? "ワークシートに戻る" : "拡大して編集",
      run: () => {
        focusedCard = focusedCard ? "" : c.id;
        render();
      },
    },
    {
      label: "X / Y 軸を入れ替え",
      disabled: oneDimensional(c),
      run: () => {
        remember();
        [c.x, c.y] = [c.y, c.x];
        changed();
      },
    },
    { label: "図をPDFで保存…", run: () => void exportPlot(c, "pdf") },
    { label: "図をSVGで保存…", run: () => void exportPlot(c, "svg") },
    { label: "プロットを複製", run: () => duplicatePlot(c) },
    { label: "プロットを削除", run: () => removePlot(c), danger: true },
  ]);
}
async function exportStatistics(id?: string) {
  if (!project.samples.length) {
    message("サンプルを読み込んでください。");
    return;
  }
  const path = await save({
    defaultPath: `${project.name}-statistics.csv`,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!path) return;
  await runOperation("全イベントの統計をCSV出力中…", async () => {
    await rpc("statistics_csv", {
      project: clone(),
      path,
      sampleIds: id ? [id] : undefined,
    });
    message(`統計CSVを保存しました: ${path}`);
  });
}
async function exportPlot(c: WorksheetPlot, format: "pdf" | "svg") {
  const path = await save({
    defaultPath: `${project.name}-${c.x.channel}-${c.y.channel}.${format}`,
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  if (!path) return;
  await runOperation("図を出力中…", async () => {
    await rpc(`plot_${format}`, {
      project: clone(),
      path,
      sampleId,
      plots: [structuredClone(c)],
      worksheetName: sheet().name,
    });
    message(`図を保存しました: ${path}`);
  });
}
function on(id: string, fn: () => void) {
  document.getElementById(id)?.addEventListener("click", fn);
}
async function deleteWorksheet(id: string) {
  const current = project.worksheets!.find((item) => item.id === id);
  if (!current) return;
  const prompt = `「${current.name}」と、そのプロット・ウィジェット・設定をまとめて削除します。続けますか？`;
  const proceed = isTauri()
    ? await confirm(prompt, { title: "ワークシートを削除" })
    : window.confirm(prompt);
  if (!proceed) return;
  remember();
  const activeId = project.activeWorksheet;
  const remaining = project.worksheets!.filter((item) => item.id !== current.id);
  if (remaining.length) {
    project.worksheets = remaining;
    project.activeWorksheet = remaining.some((item) => item.id === activeId)
      ? activeId
      : remaining[0].id;
  } else {
    const fresh: Worksheet = {
      id: uid(),
      name: "Global worksheet",
      plots: [],
      widgets: [newStatisticsWidget([])],
      printPages: [{ id: uid(), left: 0, top: 0, orientation: "landscape" }],
      mode: "global",
    };
    project.worksheets = [fresh];
    project.activeWorksheet = fresh.id;
  }
  selectedCards.clear();
  activeCard = sheet().plots[0]?.id ?? "";
  changed();
  message(remaining.length ? `「${current.name}」を削除しました。` : `「${current.name}」を削除し、空のワークシートを作成しました。`);
}
function wire() {
  const sampleSortSelect = document.querySelector<HTMLSelectElement>("#sample-sort")!;
  sampleSortSelect.onchange = () => {
    remember();
    sortSamples(sampleSortSelect.value as "import" | "name" | "manual");
    changed(false);
  };
  document.querySelectorAll<HTMLButtonElement>("[data-gate-display]").forEach((button) => {
    button.onclick = () => {
      selectedCards.clear();
      activeCard = button.dataset.gateDisplay!;
      batchPlotSettingsDialog("gates");
    };
  });
  on(
    "demo",
    () =>
      void runOperation("デモを読み込み中…", async () => {
        const r = await rpc<{ samples: Sample[] }>("demo");
        remember();
        let s = r.samples[0];
        if (project.samples.some((old) => old.id === s.id)) {
          s = { ...s, id: uid(), name: `Demo ${project.samples.length + 1}` };
        }
        s.importOrder = nextSampleImportOrder();
        project.samples.push(s);
        sortSamples(project.sampleSort ?? "import");
        sampleId = s.id;
        if (!sheet().plots.length) {
        sheet().plots.push(newSamplePlot(s, 0));
          activeCard = sheet().plots[0].id;
        }
        changed();
      }),
  );
  on("import", () => void importData("fcs"));
  on("folder", () => void importData("folder"));
  on("diva", () => void importData("diva"));
  on("load", () => void loadProject());
  on("save", () => void saveProject());
  on("pdf", () => void exportPdf(true));
  on("report", () => void exportPdf(false));
  on("toggle-left-sidebar", () => {
    leftSidebarVisible = !leftSidebarVisible;
    updateSidebarVisibility();
  });
  on("statistics-widget-settings", () => {
    const menu = document.querySelector<HTMLDetailsElement>(".widget-add-menu");
    if (menu) menu.open = false;
    let widget = sheet().widgets?.find(isStatisticsWidget);
    if (!widget) {
      remember();
      widget = newStatisticsWidget(
        sheet().plots,
        worksheetMode() === "normal" ? sampleId : "active",
      );
      sheet().widgets ??= [];
      sheet().widgets!.push(widget);
      changed(false);
    }
    if (widget) editStatisticsWidget(widget);
  });
  on("compensation-widget-add", addCompensationWidget);
  document.querySelectorAll<HTMLButtonElement>("[data-statistics-options]").forEach((button) => {
    button.onclick = () => {
      const widget = sheet().widgets?.find((item) => item.id === button.dataset.statisticsOptions);
      if (widget && isStatisticsWidget(widget)) editStatisticsWidget(widget);
    };
  });
  document.querySelectorAll<HTMLSelectElement>("[data-statistics-sample]").forEach((select) => {
    select.onchange = () => {
      const widget = sheet().widgets?.find((item) => item.id === select.dataset.statisticsSample);
      if (!widget || !isStatisticsWidget(widget)) return;
      remember();
      widget.sampleId = select.value;
      changed();
    };
  });
  document.querySelectorAll<HTMLInputElement>("[data-select-widget]").forEach((input) => {
    input.onchange = () => {
      const id = input.dataset.selectWidget!;
      if (input.checked) selectedWidgets.add(id);
      else selectedWidgets.delete(id);
      input.closest(".statistics-widget,.compensation-widget")?.classList.toggle("selected-widget", input.checked);
      updatePlotSelectionControls();
    };
  });
  document.querySelectorAll<HTMLButtonElement>("[data-remove-widget]").forEach((button) => {
    button.onclick = () => {
      const id = button.dataset.removeWidget;
      if (!id) return;
      remember();
      selectedWidgets.delete(id);
      sheet().widgets = (sheet().widgets ?? []).filter((widget) => widget.id !== id);
      changed(false);
    };
  });
  document.querySelectorAll<HTMLSelectElement>("[data-comp-source]").forEach((select) => {
    select.onchange = () => {
      const widget = sheet().widgets?.find((item): item is CompensationWidget => item.id === select.dataset.compSource && item.type === "compensation");
      if (!widget) return;
      if (worksheetMode() === "global") {
        if (select.value !== "active" && select.value !== sampleId) chooseSample(select.value);
        return;
      }
      remember();
      widget.sampleId = select.value;
      const matchingPlot = sheet().plots.find((plot) => cardSample(plot)?.id === select.value);
      if (matchingPlot) activeCard = matchingPlot.id;
      changed(false);
    };
  });
  document.querySelectorAll<HTMLInputElement>("[data-comp-visible-channel]").forEach((input) => {
    input.onchange = () => {
      const widget = sheet().widgets?.find((item): item is CompensationWidget => item.id === input.dataset.compVisibleChannel && item.type === "compensation");
      if (!widget) return;
      const wasExpanded = input.closest("details")?.open ?? false;
      const viewport = document.querySelector<HTMLElement>(".viewport");
      const scrollLeft = viewport?.scrollLeft ?? 0;
      const scrollTop = viewport?.scrollTop ?? 0;
      remember();
      widget.visibleChannels = [...document.querySelectorAll<HTMLInputElement>(`[data-comp-visible-channel="${CSS.escape(widget.id)}"]:checked`)]
        .map((checkbox) => checkbox.value);
      changed(false);
      const updatedWidget = document.querySelector<HTMLElement>(`[data-compensation-widget="${CSS.escape(widget.id)}"]`);
      const updatedDetails = updatedWidget?.querySelector<HTMLDetailsElement>(".comp-channel-visibility");
      if (updatedDetails) updatedDetails.open = wasExpanded;
      const updatedViewport = document.querySelector<HTMLElement>(".viewport");
      if (updatedViewport) {
        updatedViewport.scrollLeft = scrollLeft;
        updatedViewport.scrollTop = scrollTop;
      }
    };
  });
  document.querySelectorAll<HTMLInputElement>("[data-comp-target]").forEach((input) => {
    input.onchange = () => {
      const widget = sheet().widgets?.find((item): item is CompensationWidget => item.id === input.dataset.compTarget && item.type === "compensation");
      if (!widget) return;
      remember();
      widget.targetSampleIds = [...document.querySelectorAll<HTMLInputElement>(`[data-comp-target="${CSS.escape(widget.id)}"]:checked`)]
        .map((target) => target.dataset.sample)
        .filter((sampleId): sampleId is string => !!sampleId);
      statusBar();
    };
  });
  document.querySelectorAll<HTMLButtonElement>("[data-apply-comp-widget]").forEach((button) => {
    button.onclick = () => applyCompensationWidget(button.dataset.applyCompWidget!);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-apply-diva-comp]").forEach((button) => {
    button.onclick = () => applyDivaCompensationFromWidget(button.dataset.applyDivaComp!);
  });
  on("template", () => void saveWorksheetTemplate());
  on("csv", () => void exportStatistics());
  on("batch", batchGates);
  on("batch-plots-sheet", () => batchWorksheetItemsToSamples());
  on("undo", () => undo(false));
  on("redo", () => undo(true));
  on("add-plot", () => addPlot());
  on("standard-expansion", addStandardExpansion);
  on("compensation-expansion", () => void addCompensationAnalysis());
  on("batch-size", batchSizeDialog);
  document.querySelector<HTMLDetailsElement>("#align-items-menu")?.querySelector("summary")?.addEventListener("click", (event) => {
    if (selectedWorksheetItems().length < 2) event.preventDefault();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-align-items]").forEach((button) => {
    button.onclick = () => {
      const alignment = button.dataset.alignItems as "left" | "center-x" | "right" | "top" | "center-y" | "bottom";
      alignSelectedWorksheetItems(alignment);
    };
  });
  on("select-all-plots", () => {
    const plots = sheet().plots;
    const allSelected = plots.length > 0 && plots.every((plot) => selectedCards.has(plot.id));
    selectedCards.clear();
    if (!allSelected) plots.forEach((plot) => selectedCards.add(plot.id));
    document.querySelectorAll<HTMLInputElement>("[data-select-card]").forEach((input) => {
      input.checked = selectedCards.has(input.dataset.selectCard!);
      input.closest(".plot-card")?.classList.toggle("selected-card", input.checked);
    });
    updatePlotSelectionControls();
  });
  on("show-population", () =>
    addPlot(pathFor(project, project.selectedGate, sampleId)),
  );
  on("new-sheet", () => {
    remember();
    const s = {
      id: uid(),
      name: `Worksheet ${project.worksheets!.length + 1}`,
      plots: [],
      widgets: [newStatisticsWidget([])],
      printPages: [{ id: uid(), left: 0, top: 0, orientation: "landscape" as const }],
      mode: "global" as WorksheetMode,
    };
    project.worksheets!.push(s);
    project.activeWorksheet = s.id;
    activeCard = "";
    selectedCards.clear();
    changed();
  });
  on("clone-sheet", () => {
    remember();
    const s = structuredClone(sheet());
    s.id = uid();
    s.name += " copy";
    s.plots.forEach((p) => (p.id = uid()));
    s.widgets?.forEach((widget) => (widget.id = uid()));
    s.printPages?.forEach((page) => (page.id = uid()));
    project.worksheets!.push(s);
    project.activeWorksheet = s.id;
    selectedCards.clear();
    changed();
  });
  on("arrange", () => {
    remember();
    sheet().plots.forEach((c) => {
      c.left = worksheetGrid.originX + Math.round((c.left - worksheetGrid.originX) / worksheetGrid.columnStep) * worksheetGrid.columnStep;
      c.top = worksheetGrid.originY + Math.round((c.top - worksheetGrid.originY) / worksheetGrid.rowStep) * worksheetGrid.rowStep;
    });
    changed(false);
  });
  document.querySelector<HTMLFormElement>("#grid-arrange-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const rows = Math.min(20, Math.max(1, Number(form.get("rows")) || 1));
    const columns = Math.min(20, Math.max(1, Number(form.get("columns")) || 1));
    const targets = String(form.get("scope")) === "selected"
      ? sheet().plots.filter((plot) => selectedCards.has(plot.id))
      : sheet().plots;
    if (!targets.length) {
      message("配置するプロットがありません。選択プロットを指定した場合は、先にプロットを選択してください。", true);
      return;
    }
    const placements = gridPlotPlacements(targets, rows, columns);
    if (!placements) {
      message(`この${rows}行 × ${columns}列では配置できません。行数または列数を増やしてください。`, true);
      return;
    }
    remember();
    placements.forEach(({ plot, left, top }) => { plot.left = left; plot.top = top; });
    const menu = document.querySelector<HTMLDetailsElement>(".grid-arrange-menu");
    if (menu) menu.open = false;
    changed(false);
    message(`${targets.length}個のプロットを${rows}行 × ${columns}列のグリッドに配置しました。`);
  });
  on("zoom-out", () => { remember(); sheet().zoom = Math.max(0.5, +((sheet().zoom ?? 1) - 0.1).toFixed(2)); render(); });
  on("zoom-in", () => { remember(); sheet().zoom = Math.min(2, +((sheet().zoom ?? 1) + 0.1).toFixed(2)); render(); });
  on("zoom-reset", () => { remember(); sheet().zoom = 1; render(); });
  on("toggle-properties", () => {
    const prior = document.querySelector<HTMLDialogElement>("#properties-dialog");
    if (prior) { prior.close(); return; }
    const dialog = document.createElement("dialog");
    dialog.id = "properties-dialog";
    dialog.className = "properties";
    dialog.addEventListener("close", () => dialog.remove());
    document.body.append(dialog);
    refreshInspector();
    dialog.showModal();
  });
  document.querySelector<HTMLInputElement>("#experiment")!.onchange = (e) => {
    remember();
    project.name = (e.target as HTMLInputElement).value;
    statusBar();
  };
  document.querySelector<HTMLInputElement>("#sheet-name")!.onchange = (e) => {
    remember();
    sheet().name = (e.target as HTMLInputElement).value;
    render();
  };
  document.querySelectorAll<HTMLElement>("[data-sheet]").forEach(
    (el) => {
      (el.onclick = () => {
        project.activeWorksheet = el.dataset.sheet!;
        activeCard = sheet().plots[0]?.id ?? "";
        selectedCards.clear();
        selectedGate = "";
        render();
        analyze();
      });
      el.oncontextmenu = (event) => {
        event.preventDefault();
        const worksheet = project.worksheets!.find((item) => item.id === el.dataset.sheet);
        if (!worksheet) return;
        contextMenu(event.clientX, event.clientY, worksheet.name, [
          { label: "このワークシートを削除…", danger: true, run: () => void deleteWorksheet(worksheet.id) },
        ]);
      };
    },
  );
  document.querySelectorAll<HTMLElement>("[data-tool]").forEach(
    (el) =>
      (el.onclick = () => {
        tool = el.dataset.tool!;
        document
          .querySelectorAll("[data-tool]")
          .forEach((b) =>
            b.classList.toggle(
              "active",
              (b as HTMLElement).dataset.tool === tool,
            ),
          );
        message(
          tool === "select"
            ? "ゲートの線をドラッグで移動、白い頂点で形を編集します。"
            : tool === "polygon"
              ? "クリックで頂点、ダブルクリックで確定、Escで取消。"
              : "プロット上でゲートを作成します。",
        );
      }),
  );
  document.querySelectorAll<HTMLButtonElement>("[data-gate-scope]").forEach(
    (el) =>
      (el.onclick = () => {
        gateScopeMode = el.dataset.gateScope as "global" | "sample";
        document
          .querySelectorAll("[data-gate-scope]")
          .forEach((button) =>
            button.classList.toggle(
              "active",
              (button as HTMLElement).dataset.gateScope === gateScopeMode,
            ),
          );
      }),
  );
  document.querySelectorAll<HTMLButtonElement>("[data-sheet-mode]").forEach(
    (el) =>
      (el.onclick = () =>
        setSheetMode(el.dataset.sheetMode as WorksheetMode)),
  );
  document.querySelectorAll<HTMLButtonElement>("[data-gate-filter]").forEach(
    (el) =>
      (el.onclick = () => {
        gateFilter = el.dataset.gateFilter as "all" | "global" | "sample";
        document
          .querySelectorAll("[data-gate-filter]")
          .forEach((button) =>
            button.classList.toggle(
              "active",
              (button as HTMLElement).dataset.gateFilter === gateFilter,
            ),
          );
        document.querySelector("#tree")!.innerHTML = tree();
  decorateSampleOrder();
      }),
  );
  document.querySelectorAll<HTMLInputElement>("[data-select-card]").forEach(
    (el) =>
      (el.onchange = () => {
        const id = el.dataset.selectCard!;
        if (el.checked) selectedCards.add(id);
        else selectedCards.delete(id);
        document
          .querySelector('[data-card="' + id + '"]')
          ?.classList.toggle("selected-card", el.checked);
        updatePlotSelectionControls();
      }),
  );
  app.onclick = (e) => {
    const color = (e.target as Element).closest<HTMLElement>("[data-gate-color]");
    if (color) {
      const g = project.gates.find((item) => item.id === color.dataset.gateColor);
      if (g) gateColorDialog(g);
      return;
    }
    const rename = (e.target as Element).closest<HTMLElement>("[data-rename-pop]");
    if (rename) { const g = project.gates.find((item) => item.id === rename.dataset.renamePop); if (g) renameGateDialog(g); return; }
    // Limit tree selection to actual population rows and sample buttons.
    // Worksheet controls (notably compensation target checkboxes) also carry
    // data-sample, but must not change the active sample when clicked.
    const el = (e.target as Element).closest<HTMLElement>(
      "[data-pop], button.sample[data-sample]",
    );
    if (!el) return;
    const id = el.dataset.sample ?? sampleId;
    if (el.dataset.pop !== undefined) {
      if (id !== sampleId) chooseSample(id);
      project.selectedGate = el.dataset.pop;
      selectedGate =
        project.selectedGate === "root" ? "" : project.selectedGate;
      document
        .querySelectorAll<HTMLElement>(".population")
        .forEach((node) =>
          node.classList.toggle(
            "selected",
            node.dataset.sample === sampleId &&
              node.dataset.pop === project.selectedGate,
          ),
        );
      refreshInspector();
    } else chooseSample(id);
  };
  document.querySelector<HTMLElement>("#tree")!.ondblclick = (e) => {
    const el = (e.target as Element).closest<HTMLElement>("[data-pop]");
    if (el)
      addPlot(
        pathFor(project, el.dataset.pop!, el.dataset.sample!),
        el.dataset.sample!,
      );
  };
  const populationPayload = (el: HTMLElement) =>
    JSON.stringify({
      sampleId: el.dataset.sample,
      path: pathFor(project, el.dataset.pop!, el.dataset.sample!),
    });
  const treeElement = document.querySelector<HTMLElement>("#tree")!;
  const clearSampleDropMarkers = () => treeElement.querySelectorAll(".sample-group").forEach((group) => group.classList.remove("drop-before", "drop-after"));
  treeElement.addEventListener("keydown", (event) => {
    const keyboard = event as KeyboardEvent;
    const button = (keyboard.target as Element).closest<HTMLButtonElement>("button.sample[data-sample]");
    if (!button || !["ArrowUp", "ArrowDown"].includes(keyboard.key)) return;
    keyboard.preventDefault();
    const index = project.samples.findIndex((item) => item.id === button.dataset.sample);
    const next = project.samples[index + (keyboard.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    chooseSample(next.id);
    [...document.querySelectorAll<HTMLButtonElement>("#tree button.sample[data-sample]")].find((item) => item.dataset.sample === next.id)?.focus();
  });
  // Pointer movement works consistently in WebView2, including when the
  // selected sample's population tree is expanded below its row.
  let suppressSampleClick = false;
  treeElement.addEventListener("click", (event) => {
    if (!suppressSampleClick || !(event.target as Element).closest("button.sample")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressSampleClick = false;
  }, true);
  treeElement.addEventListener("pointerdown", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button.sample[data-sample]");
    if (!button || event.button !== 0) return;
    const sourceId = button.dataset.sample!;
    const startX = event.clientX, startY = event.clientY;
    let dragging = false;
    let destinationId = "";
    let insertAfter = false;
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== event.pointerId) return;
      if (!dragging && Math.hypot(pointer.clientX - startX, pointer.clientY - startY) < 6) return;
      dragging = true;
      pointer.preventDefault();
      button.classList.add("dragging");
      const browser = treeElement.closest<HTMLElement>(".browser");
      if (browser) {
        const bounds = browser.getBoundingClientRect();
        if (pointer.clientY < bounds.top + 24) browser.scrollTop -= 12;
        if (pointer.clientY > bounds.bottom - 24) browser.scrollTop += 12;
      }
      const group = document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest<HTMLElement>(".sample-group");
      clearSampleDropMarkers();
      destinationId = group?.querySelector<HTMLButtonElement>("button.sample")?.dataset.sample ?? "";
      if (!group || destinationId === sourceId) return;
      const target = group.querySelector<HTMLButtonElement>("button.sample")!;
      insertAfter = pointer.clientY >= target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
      group.classList.add(insertAfter ? "drop-after" : "drop-before");
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      clearSampleDropMarkers();
      button.classList.remove("dragging");
    };
    const finish = (pointer: PointerEvent) => {
      if (pointer.pointerId !== event.pointerId) return;
      cleanup();
      if (!dragging) return;
      suppressSampleClick = true;
      window.setTimeout(() => { suppressSampleClick = false; }, 300);
      if (!destinationId || destinationId === sourceId) return;
      const from = project.samples.findIndex((item) => item.id === sourceId);
      if (from < 0) return;
      remember();
      const [moving] = project.samples.splice(from, 1);
      const destination = project.samples.findIndex((item) => item.id === destinationId) + (insertAfter ? 1 : 0);
      project.samples.splice(destination, 0, moving);
      sortSamples("manual");
      changed(false);
    };
    const cancel = () => cleanup();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
  });
  document.querySelector("#tree")!.addEventListener("dragstart", (e) => {
    const ev = e as DragEvent,
      el = (ev.target as Element).closest<HTMLElement>("[data-pop]");
    if (!el || !ev.dataTransfer) return;
    ev.dataTransfer.effectAllowed = "copy";
    const payload = populationPayload(el);
    ev.dataTransfer.setData("application/flowdesk-population", payload);
    ev.dataTransfer.setData("text/plain", payload);
  });
  const board = document.querySelector<HTMLElement>(".board")!;
  wirePrintPages(board);
  wireSelectionMarquee(board);
  const populationDrag = (e: DragEvent) =>
    !e.dataTransfer ||
    e.dataTransfer.types.includes("application/flowdesk-population") ||
    e.dataTransfer.types.includes("text/plain");
  board.ondragenter = (e) => {
    if (!populationDrag(e)) return;
    e.preventDefault();
    board.classList.add("drop-target");
  };
  board.ondragover = (e) => {
    if (!populationDrag(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = "copy";
    board.classList.add("drop-target");
  };
  board.ondragleave = (e) => {
    if (!board.contains(e.relatedTarget as Node | null))
      board.classList.remove("drop-target");
  };
  board.ondrop = (e) => {
    e.preventDefault();
    board.classList.remove("drop-target");
    try {
      const raw =
        e.dataTransfer?.getData("application/flowdesk-population") ||
        e.dataTransfer?.getData("text/plain");
      const v = JSON.parse(raw || "{}");
      const source = sample(v.sampleId);
      if (Array.isArray(v.path) && source) {
        const b = board.getBoundingClientRect();
        addPlot(v.path, source.id, [e.clientX - b.left, e.clientY - b.top]);
        message(`${source.name} · ${v.path.length ? v.path.join(" / ") : "All events"} を配置しました。`);
      }
    } catch {}
  };
  document.querySelectorAll<HTMLElement>("[data-card]").forEach((el) => {
    el.addEventListener("pointerdown", (event) => {
      const id = el.dataset.card!;
      const ev = event as PointerEvent;
      if (ev.shiftKey || ev.ctrlKey || ev.metaKey) {
        if (selectedCards.has(id)) selectedCards.delete(id);
        else selectedCards.add(id);
        render();
        return;
      }
      if (activeCard !== id) activate(id);
    });
    el.addEventListener("contextmenu", (event) => {
      if (event.defaultPrevented) return;
      const target = event.target as Element;
      if (target.closest("button,input,select,textarea,[data-axis-label],[data-axis-details]")) return;
      const plot = sheet().plots.find((item) => item.id === el.dataset.card);
      if (!plot) return;
      event.preventDefault();
      preparePlotContextSelection(plot);
      contextMenu(
        event.clientX,
        event.clientY,
        selectedPlots().length > 1 ? `${selectedPlots().length}プロットを選択中` : "プロット",
        [
          ...plotSettingsActions(),
          { label: "プロット表示設定…", run: () => plotOptions(plot) },
        ],
      );
    });
  });
  document
    .querySelectorAll<HTMLElement>("[data-duplicate]")
    .forEach(
      (el) =>
        (el.onclick = () =>
          duplicatePlot(
            sheet().plots.find((p) => p.id === el.dataset.duplicate)!,
          )),
    );
  document
    .querySelectorAll<HTMLElement>("[data-remove]")
    .forEach(
      (el) =>
        (el.onclick = () =>
          removePlot(sheet().plots.find((p) => p.id === el.dataset.remove)!)),
    );
  document
    .querySelectorAll<HTMLElement>("[data-plot-options]")
    .forEach(
      (el) =>
        (el.onclick = () =>
          plotOptions(
            sheet().plots.find((p) => p.id === el.dataset.plotOptions)!,
          )),
    );
  document
    .querySelectorAll<HTMLElement>("[data-parent]")
    .forEach(
      (el) =>
        (el.onclick = () =>
          parentPopulation(
            sheet().plots.find((p) => p.id === el.dataset.parent)!,
          )),
    );
  app.oncontextmenu = (e) => {
    if ((e.target as Element).closest("[data-gate-color]")) return;
    const el = (e.target as Element).closest<HTMLElement>(
      ".population[data-pop], tr[data-pop]",
    );
    if (el) {
      e.preventDefault();
      const statisticsContainer = el.closest<HTMLElement>("[data-statistics-widget]");
      const sourceWidget = sheet().widgets?.find((item) => item.id === statisticsContainer?.dataset.statisticsWidget);
      if (sourceWidget) prepareWidgetContextSelection(sourceWidget);
      const g = project.gates.find(
        (g) =>
          g.id === el.dataset.pop &&
          gateAppliesToSample(g, el.dataset.sample ?? sampleId),
      );
      if (g) { gateMenu(g, e.clientX, e.clientY, undefined, sourceWidget); return; }
      if (!sourceWidget) return;
    }
    const widgetElement = (e.target as Element).closest<HTMLElement>("[data-statistics-widget],[data-compensation-widget]");
    const widgetId = widgetElement?.dataset.statisticsWidget ?? widgetElement?.dataset.compensationWidget;
    const widget = sheet().widgets?.find((item) => item.id === widgetId);
    if (!widget) return;
    e.preventDefault();
    prepareWidgetContextSelection(widget);
    contextMenu(e.clientX, e.clientY, isStatisticsWidget(widget) ? "Population statistics" : "Compensation", [
      {
        label: "Normal: 選択項目を他サンプルへ展開…",
        disabled: worksheetMode() !== "normal",
        run: () => batchWorksheetItemsToSamples(),
      },
    ]);
  };
  document
    .querySelectorAll<HTMLElement>("[data-axis-label], [data-axis-details]")
    .forEach((el) => {
      const c = sheet().plots.find((p) => p.id === el.dataset.for)!;
      const side = (el.dataset.axisLabel ?? el.dataset.axisDetails) as AxisSide;
      const details = () => openAxisDetails(c, side, el);
      el.onclick = () => {
        activate(c.id);
        if (el.dataset.axisDetails) {
          details();
          return;
        }
        chooseParameter(
          el,
          side,
          c,
          cardSample(c)?.channels ?? [],
          (id) => {
            if (c[side].channel === id) return;
            remember();
            const target = cardSample(c);
            if (target) c[side] = axisForSample(target, id);
            changed();
            document
              .querySelector<HTMLElement>(
                `[data-axis-label="${side}"][data-for="${c.id}"]`,
              )
              ?.focus({ preventScroll: true });
          },
          details,
        );
      };
      el.oncontextmenu = (e) => {
        e.preventDefault();
        details();
      };
      el.onkeydown = (e) => {
        if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") {
          e.preventDefault();
          details();
        }
      };
    });
  document.querySelectorAll<HTMLElement>("[data-swap]").forEach(
    (el) =>
      (el.onclick = () => {
        const c = sheet().plots.find((p) => p.id === el.dataset.swap)!;
        remember();
        [c.x, c.y] = [c.y, c.x];
        changed();
      }),
  );
  document.querySelectorAll<HTMLElement>("[data-focus]").forEach(
    (el) =>
      (el.onclick = () => {
        focusedCard = focusedCard === el.dataset.focus ? "" : el.dataset.focus!;
        activeCard = el.dataset.focus!;
        render();
      }),
  );
  document.querySelectorAll<HTMLSelectElement>("[data-binding]").forEach(
    (el) =>
      (el.onchange = () => {
        const plot = sheet().plots.find((p) => p.id === el.dataset.binding);
        if (!plot) return;
        if (worksheetMode() === "global" && el.value !== "active") {
          // Choosing a fixed sample is an explicit transition to Normal.
          remember();
          sheet().mode = "normal";
          normalizeWorksheetPlots();
          plot.sampleId = el.value;
          selectedCards.clear();
          changed();
          message("このプロットを固定サンプルにしたため、Normal sheetへ切り替えました。");
          return;
        }
        remember();
        plot.sampleId =
          worksheetMode() === "normal" ? (el.value === "active" ? sampleId : el.value) : "active";
        changed();
      }),
  );
  document.querySelectorAll<HTMLSelectElement>("[data-population]").forEach(
    (el) =>
      (el.onchange = () => {
        remember();
        sheet().plots.find((p) => p.id === el.dataset.population)!.population =
          JSON.parse(el.value);
        changed();
      }),
  );
  document.querySelectorAll<HTMLSelectElement>("[data-mode]").forEach(
    (el) =>
      (el.onchange = () => {
        remember();
        sheet().plots.find((p) => p.id === el.dataset.mode)!.mode =
          el.value as WorksheetPlot["mode"];
        changed();
      }),
  );
  document
    .querySelectorAll<HTMLElement>("[data-move],[data-resize]")
    .forEach((el) => {
      el.onpointerdown = (e) => {
        const key = el.dataset.move ?? el.dataset.resize ?? "";
        const isWidget = key.startsWith("widget:");
        if ((e.target as Element).closest("button,select,input,label,textarea,a") || (focusedCard && !isWidget))
          return;
        e.preventDefault();
        const id = isWidget ? key.slice("widget:".length) : key;
        const item = isWidget
          ? sheet().widgets?.find((widget) => widget.id === id)
          : sheet().plots.find((plot) => plot.id === id);
        const element = el.closest<HTMLElement>("[data-card],[data-statistics-widget],[data-compensation-widget]");
        if (!item || !element) return;
        const isCompWidget = "type" in item && item.type === "compensation";
        const original = { left: item.left, top: item.top, width: item.width, height: item.height },
          start = [e.clientX, e.clientY];
        let moved = false;
        gesture = true;
        el.setPointerCapture(e.pointerId);
        el.onpointermove = (ev) => {
          const dx = ev.clientX - start[0],
            dy = ev.clientY - start[1];
          if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
          if (!moved) {
            remember();
            moved = true;
          }
          if (el.dataset.resize) {
            item.width = Math.max(isCompWidget ? 420 : isWidget ? 380 : 280, original.width + dx);
            item.height = Math.max(isCompWidget ? 260 : isWidget ? 210 : 270, original.height + dy);
            element.style.width = `${item.width}px`;
            element.style.height = `${item.height}px`;
          } else {
            item.left = Math.max(0, original.left + dx);
            item.top = Math.max(0, original.top + dy);
            element.style.left = `${item.left}px`;
            element.style.top = `${item.top}px`;
          }
        };
        const end = () => {
          el.onpointermove = null;
          el.onpointerup = null;
          gesture = false;
          render();
        };
        el.onpointerup = end;
        el.onpointercancel = end;
      };
    });
  wireInspector();
}
function openAxisDetails(
  c: WorksheetPlot,
  side: AxisSide,
  anchor: HTMLElement,
) {
  activate(c.id);
  const channel = c[side].channel;
  const matches = sheet().plots.flatMap((p) =>
    (["x", "y"] as const)
      .filter(
        (k) => !(k === "y" && oneDimensional(p)) && p[k].channel === channel,
      )
      .map((k) => ({ p, k })),
  );
  const axisAnchor =
    document.querySelector<HTMLElement>(
      `[data-axis-label="${side}"][data-for="${c.id}"]`,
    ) ?? anchor;
  editAxis(axisAnchor, side, c, matches.length, (value, scope) => {
    remember();
    if (scope === "sheet")
      for (const { p, k } of matches) p[k] = structuredClone(value);
    else c[side] = value;
    changed();
    document
      .querySelector<HTMLElement>(
        `[data-axis-label="${side}"][data-for="${c.id}"]`,
      )
      ?.focus({ preventScroll: true });
  }, (value) => rpc("axis_preview", {
    project: clone(), sampleId: cardSample(c)?.id, population: c.population,
    axis: value,
  }));
}
function ensureCompensationWidget(visibleChannels?: string[], sourceSampleId?: string) {
  const menu = document.querySelector<HTMLDetailsElement>(".widget-add-menu");
  if (menu) menu.open = false;
  const existing = sheet().widgets?.find((widget) => widget.type === "compensation");
  if (existing) {
    if (visibleChannels !== undefined) {
      existing.visibleChannels = [...visibleChannels];
      if (sourceSampleId && worksheetMode() === "normal") existing.sampleId = sourceSampleId;
    }
    const viewport = document.querySelector<HTMLElement>(".viewport");
    if (viewport) {
      viewport.scrollLeft = Math.max(0, existing.left - 30);
      viewport.scrollTop = Math.max(0, existing.top - 30);
    }
    return existing;
  }
  if (!project.samples.length) {
    message("先にFCSサンプルを読み込んでください。", true);
    return undefined;
  }
  const source = card() ? cardSample(card()!) : sample();
  const widget = newCompensationWidget(
    sheet().plots,
    sheet().widgets ?? [],
    worksheetMode() === "global" ? "active" : sourceSampleId ?? source?.id ?? sampleId,
  );
  if (visibleChannels !== undefined) widget.visibleChannels = [...visibleChannels];
  sheet().widgets ??= [];
  sheet().widgets!.push(widget);
  const viewport = document.querySelector<HTMLElement>(".viewport");
  if (viewport) {
    viewport.scrollLeft = Math.max(0, widget.left - 30);
    viewport.scrollTop = Math.max(0, widget.top - 30);
  }
  return widget;
}
function addCompensationWidget() {
  const existing = sheet().widgets?.find((widget) => widget.type === "compensation");
  if (existing) {
    ensureCompensationWidget();
    message("このワークシートにはCompensationウィジェットがあります。");
    return;
  }
  if (!project.samples.length) {
    message("先にFCSサンプルを読み込んでください。", true);
    return;
  }
  remember();
  ensureCompensationWidget();
  changed(false);
}
function selectedCompensationTargets(widgetId: string) {
  const ids = [...document.querySelectorAll<HTMLInputElement>(`[data-comp-target="${CSS.escape(widgetId)}"]:checked`)]
    .map((input) => input.dataset.sample)
    .filter((id): id is string => !!id);
  return project.samples.filter((item) => ids.includes(item.id));
}
function applyCompensationWidget(widgetId: string) {
  const widget = sheet().widgets?.find((item): item is CompensationWidget => item.id === widgetId && item.type === "compensation");
  const source = widget && compensationWidgetSample(widget);
  if (!widget || !source) return;
  const config: Compensation = structuredClone(source.compensation);
  config.enabled = document.querySelector<HTMLInputElement>(`[data-comp-enabled="${CSS.escape(widgetId)}"]`)?.checked ?? false;
  for (const input of document.querySelectorAll<HTMLInputElement>(`[data-comp-matrix="${CSS.escape(widgetId)}"]`)) {
    const row = Number(input.dataset.row), column = Number(input.dataset.column);
    const value = Number(input.value) / 100;
    if (!Number.isFinite(value) || !Number.isInteger(row) || row < 0 || row >= config.values.length || !Number.isInteger(column) || column < 0 || column >= (config.values[row]?.length ?? 0)) {
      message("補正行列に有限の数値を入力してください。", true);
      return;
    }
    config.values[row][column] = value;
  }
  const targets = selectedCompensationTargets(widgetId);
  if (!targets.length) {
    message("適用先のサンプルにチェックを入れてください。", true);
    return;
  }
  const compatible = targets.filter((target) => config.channels.every((channel) => target.channels.some((item) => item.id === channel)));
  if (!compatible.length) {
    message("チェックしたサンプルには補正に必要な検出器がありません。", true);
    return;
  }
  remember();
  compatible.forEach((target) => { target.compensation = structuredClone(config); });
  changed();
  message(`補正行列を適用しました: ${source.name}の設定 → ${compatible.map((target) => target.name).join("、")}${compatible.length !== targets.length ? "（チャンネル不足の対象は除外）" : ""}`);
}
function applyDivaCompensationFromWidget(widgetId: string) {
  const selector = document.querySelector<HTMLSelectElement>(`[data-diva-comp-preset="${CSS.escape(widgetId)}"]`);
  const preset = project.divaCompensations?.find((item) => item.id === selector?.value);
  if (!preset) return;
  const targets = selectedCompensationTargets(widgetId);
  const compatible = targets.filter((target) => preset.channels.every((channel) => target.channels.some((item) => item.id === channel)));
  if (!compatible.length) {
    message("適用先のサンプルにチェックを入れてください。選択したDIVA行列の全チャンネルが必要です。", true);
    return;
  }
  const indices = preset.channels.map((_, index) => index);
  const config: Compensation = {
    enabled: preset.enabled,
    channels: [...preset.channels],
    values: indices.map((row) => indices.map((column) => preset.values[row][column])),
    source: "DIVA XML · " + preset.name,
  };
  remember();
  project.divaCompensations?.forEach((item) => { item.active = item.id === preset.id; });
  compatible.forEach((target) => { target.compensation = structuredClone(config); });
  changed();
  message(`DIVA行列「${preset.name}」を適用しました: ${compatible.map((target) => target.name).join("、")}`);
}
function wireInspector() {
  document.querySelectorAll<HTMLElement>("[data-inspect-axis]").forEach(
    (el) =>
      (el.onclick = () => {
        const c = card();
        if (c) openAxisDetails(c, el.dataset.inspectAxis as AxisSide, el);
      }),
  );
  const name = document.querySelector<HTMLInputElement>("#gate-name");
  if (name)
    name.onchange = () => {
      const g = project.gates.find((g) => g.id === selectedGate);
      if (g) renameGate(g, name.value);
    };
  const scope = document.querySelector<HTMLSelectElement>("#gate-scope");
  if (scope)
    scope.onchange = () => {
      const g = project.gates.find(
        (candidate) => candidate.id === selectedGate,
      );
      if (!g) return;
      const next = scope.value as "global" | "sample";
      const target = card() ? cardSample(card()!) : sample(g.sampleId);
      changeGateScope(g, next, target?.id);
    };
  on("delete-gate", () => {
    const g = project.gates.find((g) => g.id === selectedGate);
    if (g) removeGate(g);
  });
  on("gate-child", () => {
    const g = project.gates.find((g) => g.id === selectedGate);
    const target = card() ? cardSample(card()!) : sample();
    if (g && target && gateAppliesToSample(g, target.id))
      addPlot(pathFor(project, g.id, target.id), target.id);
  });
  on("gate-parent", () => {
    const g = project.gates.find((g) => g.id === selectedGate);
    if (!g) return;
    const target = card() ? cardSample(card()!) : sample(g.sampleId);
    if (!target || !gateAppliesToSample(g, target.id)) return;
    const s = target;
    remember();
    const c = newSamplePlot(
      s,
      sheet().plots.length,
      pathFor(project, g.parent, s.id),
    );
    c.sampleId = s.id;
    c.x = structuredClone(g.x);
    c.y = structuredClone(g.y);
    sheet().plots.push(c);
    activeCard = c.id;
    changed();
  });
  const notes = document.querySelector<HTMLTextAreaElement>("#notes");
  if (notes)
    notes.onchange = () => {
      remember();
      project.notes = notes.value;
      statusBar();
    };
}
function undo(redo: boolean) {
  const from = redo ? future : history,
    to = redo ? history : future;
  if (!from.length) return;
  to.push(clone());
  project = migrate(from.pop()!);
  if (!sample()) sampleId = project.samples[0]?.id ?? "";
  selectedGate = "";
  dirty = true;
  changed();
}
async function runOperation(label: string, fn: () => Promise<void>) {
  if (operation) {
    message("ファイル処理の完了を待ってください。");
    return;
  }
  jobs.invalidate();
  operation = true;
  message(label);
  try {
    await fn();
  } catch (e) {
    message(String(e), true);
  } finally {
    operation = false;
    statusBar();
  }
}
function divaSourceKey(sourceId?: string, template?: string) {
  return (sourceId ?? "") + "\u001f" + (template ?? "");
}
function chooseDivaWorksheets(worksheets: Worksheet[], gates: Gate[]): Promise<Set<string> | null> {
  if (worksheets.length <= 1) return Promise.resolve(new Set(worksheets.map((item) => item.id)));
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "axis-dialog diva-import-dialog";
    dialog.setAttribute("aria-label", "DIVAワークシート選択");
    const options = worksheets.map((item) => {
      const gateCount = gates.filter(
        (gate) =>
          divaSourceKey(gate.divaSourceId, gate.divaTemplate) ===
          divaSourceKey(item.divaSourceId, item.divaTemplate),
      ).length;
      const mode = item.mode === "normal" ? "Normal worksheet" : "Global worksheet";
      return (
        '<label class="check diva-sheet-option"><input type="checkbox" data-diva-sheet="' +
        esc(item.id) +
        '" checked><span><strong>' +
        esc(item.name) +
        "</strong><small>" +
        mode +
        " · " +
        gateCount +
        " ゲート · " +
        item.plots.length +
        " プロット</small></span></label>"
      );
    }).join("");
    dialog.innerHTML =
      "<form><h2>DIVAワークシートの選択</h2><p class=\"hint\">選択したシートのプロットと、そのシートに属するゲートを取り込みます。サンプルはすべて読み込みます。</p>" +
      '<div class="diva-sheet-controls"><button type="button" data-diva-all>全選択</button><button type="button" data-diva-none>全解除</button><span data-diva-count></span></div>' +
      '<div class="diva-sheet-list">' +
      options +
      '</div><div class="axis-dialog-actions"><button type="button" data-diva-cancel>キャンセル</button><button type="submit" class="primary" data-diva-submit>選択したシートを取り込む</button></div></form>';
    document.body.append(dialog);
    const inputs = Array.from(
      dialog.querySelectorAll<HTMLInputElement>("[data-diva-sheet]"),
    );
    const count = dialog.querySelector<HTMLElement>("[data-diva-count]")!;
    const submit = dialog.querySelector<HTMLButtonElement>("[data-diva-submit]")!;
    const selectedIds = () =>
      inputs.filter((input) => input.checked).map((input) => input.dataset.divaSheet!);
    const update = () => {
      const total = selectedIds().length;
      count.textContent = total + " / " + worksheets.length + " 枚選択中";
      submit.disabled = total === 0;
    };
    const finish = (selection: Set<string> | null) => {
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(selection);
    };
    dialog.querySelector<HTMLButtonElement>("[data-diva-all]")!.onclick = () => {
      inputs.forEach((input) => (input.checked = true));
      update();
    };
    dialog.querySelector<HTMLButtonElement>("[data-diva-none]")!.onclick = () => {
      inputs.forEach((input) => (input.checked = false));
      update();
    };
    inputs.forEach((input) => input.addEventListener("change", update));
    dialog.querySelector<HTMLButtonElement>("[data-diva-cancel]")!.onclick = () =>
      finish(null);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });
    dialog.querySelector("form")!.addEventListener("submit", (event) => {
      event.preventDefault();
      finish(new Set(selectedIds()));
    });
    update();
    dialog.showModal();
  });
}
async function importData(source: "fcs" | "folder" | "diva") {
  const isFolder = source === "folder";
  const paths = await open({
    directory: isFolder,
    multiple: source === "fcs",
    filters:
      source === "fcs"
        ? [{ name: "FCS", extensions: ["fcs"] }]
        : source === "diva"
          ? [{ name: "BD FACSDiva experiment", extensions: ["xml"] }]
          : undefined,
  });
  if (!paths) return;
  const label =
    source === "diva"
      ? "DIVA XMLと同じフォルダのFCSを読み込み中…"
      : source === "folder"
        ? "FCS / DIVAフォルダを読み込み中…"
        : "FCSを読み込み中…";
  await runOperation(label, async () => {
    const hadNoSamples = project.samples.length === 0;
    const r = await rpc<{
      samples: Sample[];
      warnings: string[];
      divaMetadata: Project["divaMetadata"];
      divaGates?: Gate[];
      divaWorksheets?: Worksheet[];
      divaCompensations?: DivaCompensation[];
      divaActiveWorksheet?: string | null;
    }>("import", { paths: Array.isArray(paths) ? paths : [paths] });
    if (r.divaWorksheets?.length) {
      const selectedIds = await chooseDivaWorksheets(r.divaWorksheets, r.divaGates ?? []);
      if (!selectedIds) {
        message("DIVAワークシートの選択をキャンセルしました。");
        return;
      }
      const selectedWorksheets = r.divaWorksheets.filter((item) => selectedIds.has(item.id));
      const selectedSources = new Set(
        selectedWorksheets.map((item) => divaSourceKey(item.divaSourceId, item.divaTemplate)),
      );
      r.divaWorksheets = selectedWorksheets;
      r.divaGates = (r.divaGates ?? []).filter((item) =>
        selectedSources.has(divaSourceKey(item.divaSourceId, item.divaTemplate)),
      );
      r.divaCompensations = (r.divaCompensations ?? []).filter((item) =>
        selectedSources.has(divaSourceKey(item.divaSourceId, item.template)),
      );
      if (!selectedWorksheets.some((item) => item.id === r.divaActiveWorksheet)) {
        r.divaActiveWorksheet = selectedWorksheets[0]?.id ?? null;
      }
    }
    if (r.divaWorksheets?.length || r.divaGates?.length) {
      const importedAxes = new Map<string, Axis>();
      const preferred = [...(r.divaWorksheets ?? [])].sort(
        (a, b) => Number(b.id === r.divaActiveWorksheet) - Number(a.id === r.divaActiveWorksheet),
      );
      const addDefault = (value: Axis) => {
        if (value?.channel && !importedAxes.has(value.channel))
          importedAxes.set(value.channel, structuredClone(value));
      };
      for (const worksheet of preferred)
        for (const plot of worksheet.plots) {
          addDefault(plot.x);
          addDefault(plot.y);
        }
      for (const gate of r.divaGates ?? []) {
        addDefault(gate.x);
        addDefault(gate.y);
      }
      if (importedAxes.size) {
        const channels = new Set(importedAxes.keys());
        project.divaAxisDefaults = [
          ...importedAxes.values(),
          ...(project.divaAxisDefaults ?? []).filter((item) => !channels.has(item.channel)),
        ];
      }
    }
    remember();
    const oldSampleKeys = new Set(
      project.samples.map((old) => (old.path ?? "") + "|" + (old.md5 ?? "")),
    );
    let addedSamples = 0;
    for (const imported of r.samples) {
      const key = (imported.path ?? "") + "|" + (imported.md5 ?? "");
      const existing = project.samples.find(
        (old) => (old.path ?? "") + "|" + (old.md5 ?? "") === key,
      );
      if (existing) {
        if (imported.name.includes(" / ")) existing.name = imported.name;
        if (
          imported.compensation.source === "DIVA XML" &&
          existing.compensation.source !== "DIVA XML"
        ) {
          existing.compensation = structuredClone(imported.compensation);
        }
        continue;
      }
      if (oldSampleKeys.has(key)) continue;
      imported.id = uid();
      imported.importOrder = nextSampleImportOrder();
      project.samples.push(imported);
      sampleId = imported.id;
      addedSamples++;
    }
    sortSamples(project.sampleSort ?? "import");

    const priorDivaPaths = new Set(
      (project.divaMetadata ?? [])
        .map((entry) => entry.sourcePath)
        .filter((value): value is string => !!value),
    );
    const freshMetadata = (r.divaMetadata ?? []).filter(
      (entry) => !entry.sourcePath || !priorDivaPaths.has(entry.sourcePath),
    );
    const freshGates: Gate[] = [];
    let refreshedGates = 0;
    for (const importedGate of r.divaGates ?? []) {
      const existing = project.gates.find((gate) => gate.id === importedGate.id);
      if (!existing) {
        freshGates.push(importedGate);
        continue;
      }
      if (existing.divaSourceId && existing.divaSourceId === importedGate.divaSourceId) {
        const color = existing.color;
        const scope = existing.scope;
        Object.assign(existing, structuredClone(importedGate));
        existing.color = color ?? importedGate.color ?? populationPalette[project.gates.indexOf(existing) % populationPalette.length];
        existing.scope = scope ?? importedGate.scope;
        refreshedGates++;
      }
    }
    freshGates.forEach((gate, index) => {
      gate.color ||= populationPalette[(project.gates.length + index) % populationPalette.length];
    });
    project.gates.push(...freshGates);

    const freshWorksheets: Worksheet[] = [];
    let refreshedWorksheets = 0;
    for (const importedSheet of r.divaWorksheets ?? []) {
      const existing = project.worksheets!.find((item) => item.id === importedSheet.id);
      if (!existing) {
        freshWorksheets.push(importedSheet);
        continue;
      }
      if (existing.divaSourceId && existing.divaSourceId === importedSheet.divaSourceId) {
        for (const importedPlot of importedSheet.plots) {
          const plot = existing.plots.find((item) => item.id === importedPlot.id);
          if (!plot) continue;
          // Refresh DIVA's axis transform while retaining the user's layout and plot styling.
          plot.x = structuredClone(importedPlot.x);
          plot.y = structuredClone(importedPlot.y);
        }
        refreshedWorksheets++;
      }
    }    if (
      hadNoSamples &&
      freshWorksheets.length &&
      project.worksheets!.length === 1 &&
      !project.worksheets![0].plots.length &&
      project.worksheets![0].name === "Global worksheet"
    ) {
      project.worksheets = [];
    }
    project.worksheets!.push(...freshWorksheets);
    if (
      r.divaActiveWorksheet &&
      project.worksheets!.some((item) => item.id === r.divaActiveWorksheet)
    ) {
      project.activeWorksheet = r.divaActiveWorksheet;
      activeCard =
        project.worksheets!.find((item) => item.id === r.divaActiveWorksheet)
          ?.plots[0]?.id ?? "";
    }
    selectedCards.clear();
    project.importWarnings.push(...r.warnings);
    project.divaMetadata = [...(project.divaMetadata ?? []), ...freshMetadata];
    const priorDivaCompensationIds = new Set((project.divaCompensations ?? []).map((item) => item.id));
    project.divaCompensations = [...(project.divaCompensations ?? []), ...(r.divaCompensations ?? []).filter((item) => !priorDivaCompensationIds.has(item.id))];

    if (!sheet().plots.length && sample()) {
      const c = newSamplePlot(sample()!, 0);
      sheet().plots.push(c);
      activeCard = c.id;
    }
    changed();
    if (freshWorksheets.length || refreshedWorksheets || freshGates.length || refreshedGates) {
      message(
        "DIVAを読み込みました: " + addedSamples + " サンプル、" +
          (freshGates.length + refreshedGates) + " ゲート (" + refreshedGates + " 更新)、" +
          (freshWorksheets.length + refreshedWorksheets) + " ワークシート (" + refreshedWorksheets + " 更新)、" +
          (r.divaCompensations ?? []).length + " 補償プリセット。",
      );
    } else {
      message(addedSamples + " サンプルを読み込みました。");
    }
  });
}
async function saveProject() {
  const path = await save({
    defaultPath: projectPath ?? `${project.name}.flowdesk-r.json`,
    filters: [{ name: "FlowDesk project", extensions: ["json"] }],
  });
  if (!path) return;
  await runOperation("保存中…", async () => {
    const snapshot = clone(),
      serialized = JSON.stringify(snapshot);
    await rpc("save", { path, project: snapshot });
    projectPath = path;
    if (JSON.stringify(project) === serialized) dirty = false;
    message("プロジェクトと全ワークシートを保存しました。");
  });
}
async function saveWorksheetTemplate() {
  const path = await save({
    defaultPath: `${project.name}-${sheet().name}.flowdesk-worksheet.json`,
    filters: [{ name: "Worksheet template", extensions: ["json"] }],
  });
  if (!path) return;
  await runOperation("ワークシートテンプレートを保存中…", async () => {
    const template = {
      schema: "flowdesk-worksheet-template/1",
      name: project.name,
      worksheet: structuredClone(sheet()),
      // Template files contain reusable geometry and layout, never event data.
      gateDefinitions: structuredClone(project.gates),
    };
    await rpc("save_template", { path, template });
    message(`ワークシートテンプレートを保存しました: ${path}`);
  });
}
function reportOptionsDialog(): Promise<{
  plots: boolean;
  statistics: boolean;
  compensation: boolean;
} | null> {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-label", "全サンプルPDFの出力内容");
  dialog.innerHTML = `<form><h2>全サンプルPDFの出力内容</h2><p class="hint">Global worksheetを各サンプルへ展開して出力します。ワークシート上の統計ウィジェットは常に各サンプルページへ印刷します。</p><label class="check"><input name="plots" type="checkbox" checked> プロット</label><label class="check"><input name="statistics" type="checkbox" checked> 詳細な集団統計ページ</label><label class="check"><input name="compensation" type="checkbox" checked> Compensation / spillover 行列</label><div class="axis-dialog-actions"><button type="button" data-cancel>キャンセル</button><button class="primary" type="submit">PDFを生成</button></div></form>`;
  document.body.append(dialog);
  return new Promise((resolve) => {
    const close = (value: { plots: boolean; statistics: boolean; compensation: boolean } | null) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    dialog.querySelector<HTMLButtonElement>("[data-cancel]")!.onclick = () => close(null);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close(null);
    });
    dialog.querySelector("form")!.addEventListener("submit", (event) => {
      event.preventDefault();
      const checked = (name: string) =>
        dialog.querySelector<HTMLInputElement>(`[name="${name}"]`)!.checked;
      const value = {
        plots: checked("plots"),
        statistics: checked("statistics"),
        compensation: checked("compensation"),
      };
      if (!value.plots && !value.statistics && !value.compensation) return;
      close(value);
    });
    dialog.showModal();
  });
}
async function loadProject() {
  if (
    dirty &&
    !(await confirm("未保存の変更があります。保存せずに開きますか？", {
      title: "FlowDesk",
    }))
  )
    return;
  const path = await open({
    multiple: false,
    filters: [{ name: "FlowDesk project", extensions: ["json"] }],
  });
  if (!path || Array.isArray(path)) return;
  await runOperation("プロジェクトを開いています…", async () => {
    const p = await rpc<Project>("load", { path });
    jobs.invalidate();
    project = migrate(p);
    projectPath = path;
    sampleId = p.samples[0]?.id ?? "";
    activeCard = sheet().plots[0]?.id ?? "";
    selectedGate = "";
    history = [];
    future = [];
    data = { plots: {}, stats: {}, errors: {}, workerPid: data.workerPid };
    dirty = false;
    changed();
  });
}
async function exportPdf(worksheet: boolean) {
  const options = worksheet
    ? { plots: true, statistics: false, compensation: false }
    : await reportOptionsDialog();
  if (!options) return;
  const path = await save({
    defaultPath: `${project.name}-${worksheet ? sheet().name : "report"}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!path) return;
  await runOperation("PDFを生成中…", async () => {
    const result = await rpc<{ outside?: number; pages?: number }>(worksheet ? "worksheet_pdf" : "worksheet_report_pdf", {
      project: clone(),
      path,
      sampleId,
      plots: structuredClone(sheet().plots),
      widgets: structuredClone((sheet().widgets ?? []).filter(isStatisticsWidget)),
      printPages: worksheet ? structuredClone(sheet().printPages ?? []) : undefined,
      includeWidgets: true,
      worksheetName: sheet().name,
      includePlots: options.plots,
      includeStatistics: options.statistics,
      includeCompensation: options.compensation,
    });
    message(`PDFを保存しました: ${path}${worksheet && result.outside ? ` · 印刷枠外の${result.outside}項目は含まれていません` : ""}`);
  });
}

function alignBatchSourceRanges(sources: WorksheetPlot[]) {
  const groups = new Map<string, { plots: WorksheetPlot[]; x: DisplayRange[]; y: DisplayRange[] }>();
  for (const plot of sources) {
    const d = data.plots[plot.id];
    if (d) {
      for (const side of ["x", "y"] as const) {
        if (side === "y" && oneDimensional(plot)) continue;
        const axisValue = plot[side];
        const range = displayRange(side === "x" ? d.xRange : d.yRange);
        if (range && axisIsAuto(axisValue)) {
          axisValue.autoRange = true;
          axisValue.min = range[0];
          axisValue.max = range[1];
        }
      }
    }
    const key = JSON.stringify([
      plot.population,
      plot.mode,
      axisKey(plot.x),
      oneDimensional(plot) ? "count" : axisKey(plot.y),
    ]);
    const group = groups.get(key) ?? { plots: [], x: [], y: [] };
    group.plots.push(plot);
    if (plot.x.min !== undefined && plot.x.max !== undefined)
      group.x.push([plot.x.min, plot.x.max]);
    if (!oneDimensional(plot) && plot.y.min !== undefined && plot.y.max !== undefined)
      group.y.push([plot.y.min, plot.y.max]);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    for (const side of ["x", "y"] as const) {
      const ranges = side === "x" ? group.x : group.y;
      if (!ranges.length) continue;
      const range: DisplayRange = [
        Math.min(...ranges.map((value) => value[0])),
        Math.max(...ranges.map((value) => value[1])),
      ];
      group.plots.forEach((plot) => {
        if (side === "y" && oneDimensional(plot)) return;
        if (!axisIsAuto(plot[side])) return;
        plot[side].autoRange = true;
        plot[side].min = range[0];
        plot[side].max = range[1];
      });
    }
  }
}
function sameStatisticsSettings(left: StatisticsWidget, right: StatisticsWidget) {
  return left.showEvents === right.showEvents &&
    left.showPercentParent === right.showPercentParent &&
    left.showPercentTotal === right.showPercentTotal &&
    JSON.stringify(left.mfiChannels ?? []) === JSON.stringify(right.mfiChannels ?? []) &&
    JSON.stringify(left.hiddenPopulationPaths ?? []) === JSON.stringify(right.hiddenPopulationPaths ?? []);
}
function isPlotItem(item: WorksheetPlot | WorksheetWidget): item is WorksheetPlot {
  return "population" in item;
}
function expansionOwner(item: WorksheetPlot | WorksheetWidget): Sample | undefined {
  if (isPlotItem(item)) return cardSample(item);
  if (isStatisticsWidget(item)) return sample(statisticsWidgetSampleId(item));
  return compensationWidgetSample(item);
}
function batchWorksheetItemsToSamples() {
  if (worksheetMode() !== "normal") {
    message("他サンプルへの展開はNormal sheetだけで使用できます。", true);
    return;
  }
  const plots = sheet().plots.filter((plot) => selectedCards.has(plot.id));
  const widgets = (sheet().widgets ?? []).filter((widget) => selectedWidgets.has(widget.id));
  if (!plots.length && !widgets.length && card()) plots.push(card()!);
  const sources: (WorksheetPlot | WorksheetWidget)[] = [...plots, ...widgets].filter((item) => !!expansionOwner(item));
  if (!sources.length) {
    message("展開するプロットまたはウィジェットを選択してください。", true);
    return;
  }
  const ownerIds = new Set(sources.map((item) => expansionOwner(item)!.id));
  const candidates = project.samples.filter((target) => !ownerIds.has(target.id));
  if (!candidates.length) {
    message("展開先になる別サンプルがありません。", true);
    return;
  }
  const dialog = document.createElement("dialog");
  dialog.className = "axis-dialog worksheet-expansion-dialog";
  dialog.setAttribute("aria-label", "Normal sheetの選択項目を他サンプルへ展開");
  dialog.innerHTML = `<form><div class="axis-dialog-heading"><h2>Normal sheet · 他サンプルへ展開</h2><button type="button" data-close aria-label="閉じる">×</button></div><p class="hint">選択中: プロット ${plots.length}個、ウィジェット ${widgets.length}個。配置を保って各サンプルへ複製します。</p><fieldset><legend>展開方向</legend><div class="expansion-direction"><label><input type="radio" name="direction" value="horizontal" checked> 横方向</label><label><input type="radio" name="direction" value="vertical"> 縦方向</label></div></fieldset><fieldset><legend>展開先のサンプル</legend><div class="gate-display-list">${candidates.map((target) => `<label><input type="checkbox" data-expansion-target value="${esc(target.id)}" checked><span>${esc(target.name)}</span></label>`).join("")}</div></fieldset><div class="axis-dialog-actions"><button type="button" data-cancel>キャンセル</button><button id="batch-plots-apply" class="primary" type="submit">選択サンプルへ展開</button></div></form>`;
  document.body.append(dialog);
  const close = () => dialog.close();
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelector<HTMLButtonElement>("[data-close]")!.onclick = close;
  dialog.querySelector<HTMLButtonElement>("[data-cancel]")!.onclick = close;
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  dialog.querySelector("form")!.addEventListener("submit", (event) => {
    event.preventDefault();
    const targetIds = [...dialog.querySelectorAll<HTMLInputElement>("[data-expansion-target]:checked")].map((input) => input.value);
    if (!targetIds.length) return;
    const direction = dialog.querySelector<HTMLInputElement>('[name="direction"]:checked')!.value;
    const planned: { source: WorksheetPlot | WorksheetWidget; target: Sample }[] = [];
    const skipped: string[] = [];
    for (const targetId of targetIds) {
      const target = sample(targetId);
      if (!target) continue;
      for (const source of sources) {
        const owner = expansionOwner(source);
        if (!owner || owner.id === target.id) continue;
        if (isPlotItem(source)) {
          if (source.population.length && !resolveGate(project, source.population, target.id)) {
            skipped.push(`${target.name}: ${source.population.join(" / ")}（分画なし）`);
            continue;
          }
          if (!target.channels.some((channel) => channel.id === source.x.channel) ||
              (!oneDimensional(source) && !target.channels.some((channel) => channel.id === source.y.channel))) {
            skipped.push(`${target.name}: 軸チャンネルなし`);
            continue;
          }
          const duplicate = sheet().plots.some((plot) =>
            plot.sampleId === target.id &&
            JSON.stringify(plot.population) === JSON.stringify(source.population) &&
            axisKey(plot.x) === axisKey(source.x) &&
            axisKey(plot.y) === axisKey(source.y) &&
            plot.mode === source.mode);
          if (duplicate) continue;
        } else if (isStatisticsWidget(source)) {
          const duplicate = (sheet().widgets ?? []).some((widget) =>
            isStatisticsWidget(widget) && statisticsWidgetSampleId(widget) === target.id &&
            sameStatisticsSettings(widget, source));
          if (duplicate) continue;
        } else {
          const duplicate = (sheet().widgets ?? []).some((widget) =>
            widget.type === "compensation" && compensationWidgetSample(widget)?.id === target.id &&
            JSON.stringify(widget.visibleChannels ?? null) === JSON.stringify(source.visibleChannels ?? null));
          if (duplicate) continue;
        }
        planned.push({ source, target });
      }
    }
    if (!planned.length) {
      close();
      message("追加できる項目がありません。展開先に同じ項目があるか、必要な分画・軸がありません。", true);
      return;
    }
    remember();
    if (plots.length) alignBatchSourceRanges(plots);
    const left = Math.min(...sources.map((item) => item.left));
    const top = Math.min(...sources.map((item) => item.top));
    const width = Math.max(...sources.map((item) => item.left + item.width)) - left;
    const height = Math.max(...sources.map((item) => item.top + item.height)) - top;
    const occupied = [...sheet().plots, ...(sheet().widgets ?? [])].map((item) =>
      ({ left: item.left, top: item.top, width: item.width, height: item.height }));
    const createdPlots: WorksheetPlot[] = [];
    const createdWidgets: WorksheetWidget[] = [];
    let slot = 1;
    for (const targetId of targetIds) {
      const group = planned.filter((entry) => entry.target.id === targetId);
      if (!group.length) continue;
      let positions: { left: number; top: number; width: number; height: number }[] = [];
      for (; slot < 1000; slot++) {
        const dx = direction === "horizontal" ? slot * (width + 24) : 0;
        const dy = direction === "vertical" ? slot * (height + 24) : 0;
        positions = group.map(({ source }) => ({
          left: source.left + dx, top: source.top + dy,
          width: source.width, height: source.height,
        }));
        const overlaps = positions.some((candidate) => occupied.some((box) =>
          candidate.left < box.left + box.width + 8 &&
          candidate.left + candidate.width + 8 > box.left &&
          candidate.top < box.top + box.height + 8 &&
          candidate.top + candidate.height + 8 > box.top));
        if (!overlaps) break;
      }
      slot++;
      group.forEach(({ source, target }, index) => {
        const copy = structuredClone(source);
        copy.id = uid();
        copy.left = positions[index].left;
        copy.top = positions[index].top;
        if (isPlotItem(copy)) {
          copy.sampleId = target.id;
          if (copy.displayGates) copy.displayGates = copy.displayGates.flatMap((id) => {
            const gate = project.gates.find((item) => item.id === id);
            if (!gate) return [];
            const mapped = resolveGate(project, pathFor(project, id, expansionOwner(source)!.id), target.id);
            return mapped && mapped !== "root" ? [mapped] : [];
          });
          createdPlots.push(copy);
        } else {
          copy.sampleId = target.id;
          if (copy.type === "compensation") copy.targetSampleIds = [target.id];
          createdWidgets.push(copy);
        }
        occupied.push(positions[index]);
      });
    }
    sheet().plots.push(...createdPlots);
    sheet().widgets ??= [];
    sheet().widgets!.push(...createdWidgets);
    selectedCards.clear();
    selectedWidgets.clear();
    createdPlots.forEach((plot) => selectedCards.add(plot.id));
    createdWidgets.forEach((widget) => selectedWidgets.add(widget.id));
    if (createdPlots.length) activeCard = createdPlots[0].id;
    close();
    changed();
    message(`プロット ${createdPlots.length}個、ウィジェット ${createdWidgets.length}個を展開しました。${skipped.length ? ` スキップ: ${skipped.slice(0, 4).join("、")}${skipped.length > 4 ? "…" : ""}` : ""}`);
  });
  dialog.showModal();
}
function batchGates() {
  const source = sample();
  const sampleGates = source
    ? project.gates.filter(
        (g) => g.sampleId === source.id && gateScope(g) === "sample",
      )
    : [];
  const hasGlobalGates = project.gates.some((g) => gateScope(g) === "global");
  if (source && !sampleGates.length && hasGlobalGates) {
    const dialog = document.createElement("dialog");
    dialog.innerHTML =
      "<h2>Globalゲートは全サンプルに適用済み</h2><p>" +
      esc(source.name) +
      " のGlobalゲートは既に全サンプルへ適用されています。対象を選んで確認できます。</p>" +
      project.samples
        .filter((target) => target.id !== source.id)
        .map(
          (target) =>
            '<label class="check"><input type="checkbox" value="' +
            esc(target.id) +
            '">' +
            esc(target.name) +
            "</label>",
        )
        .join("") +
      '<button id="batch-apply" class="primary">適用済みとして閉じる</button><button id="batch-close">閉じる</button>';
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector("#batch-close")!.addEventListener("click", () => dialog.remove());
    dialog.querySelector("#batch-apply")!.addEventListener("click", () => {
      dialog.remove();
      message("Globalゲートは既に全サンプルへ適用されています。");
    });
    return;
  }
  if (!source || !sampleGates.length) {
    message("コピーするゲートを持つサンプルを選択してください。");
    return;
  }
  const dialog = document.createElement("dialog");
  dialog.innerHTML = `<h2>ゲート階層を他サンプルへコピー</h2><p>${esc(source.name)} の全ゲートをコピーします。既存ゲートがあるサンプルはスキップします。</p>${project.samples
    .filter((s) => s.id !== source.id)
    .map(
      (s) =>
        `<label class="check"><input type="checkbox" value="${s.id}">${esc(s.name)}</label>`,
    )
    .join(
      "",
    )}<button id="batch-apply" class="primary">選択サンプルへコピー</button><button id="batch-close">閉じる</button>`;
  document.body.append(dialog);
  dialog.showModal();
  dialog
    .querySelector("#batch-close")!
    .addEventListener("click", () => dialog.remove());
  dialog.querySelector("#batch-apply")!.addEventListener("click", () => {
    const targets = Array.from(
      dialog.querySelectorAll<HTMLInputElement>("input:checked"),
    ).map((e) => e.value);
    if (!targets.length) return;
    const gates = project.gates.filter(
      (g) => g.sampleId === source.id && gateScope(g) === "sample",
    );
    remember();
    let count = 0;
    const skipped: string[] = [];
    for (const id of targets) {
      const s = sample(id)!;
      if (
        gates.some(
          (g) =>
            ![g.x.channel, g.y.channel].every((ch) =>
              s.channels.some((c) => c.id === ch),
            ),
        ) ||
        project.gates.some(
          (g) => g.sampleId === id && gateScope(g) === "sample",
        )
      ) {
        skipped.push(s.name);
        continue;
      }
      const ids = new Map(gates.map((g) => [g.id, uid()]));
      const groups = new Map(
        gates.filter((g) => g.groupId).map((g) => [g.groupId!, uid()]),
      );
      for (const original of gates) {
        const g = structuredClone(original);
        g.id = ids.get(g.id)!;
        g.sampleId = id;
        g.parent = g.parent === "root" ? "root" : ids.get(g.parent)!;
        if (g.groupId) g.groupId = groups.get(g.groupId);
        project.gates.push(g);
      }
      count++;
    }
    dialog.remove();
    changed();
    message(
      `${count}サンプルにゲートをコピーしました。${skipped.length ? ` スキップ（既存ゲート / チャンネル不一致）: ${skipped.join(", ")}` : ""}`,
    );
  });
}
document.addEventListener("keydown", (e) => {
  if (document.querySelector("dialog[open]")) return;
  const editing = (e.target as Element).matches("input,textarea,select");
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    void saveProject();
  }
  if (
    !editing &&
    (e.ctrlKey || e.metaKey) &&
    ["z", "y"].includes(e.key.toLowerCase())
  ) {
    e.preventDefault();
    undo(e.key.toLowerCase() === "y" || e.shiftKey);
  }
  if (e.key === "Escape") {
    if (focusedCard) {
      focusedCard = "";
      render();
      return;
    }
    gesture = false;
    tool = "select";
    render();
  }
  if (!editing && e.key === "Delete" && selectedGate) {
    const g = project.gates.find((g) => g.id === selectedGate);
    if (g) {
      removeGate(g);
    }
  }
});
window.addEventListener("resize", () => {
  if (!gesture) paint();
});
render();
if (isTauri()) {
  void rpc<Record<string, unknown>>("health")
    .then((v) => message(`flowCore ${v.flowCore} · 起動完了`))
    .catch((e) => message(String(e), true));
  void getCurrentWindow().onCloseRequested(async (e) => {
    if (dirty || operation) {
      e.preventDefault();
      if (
        await confirm(
          operation
            ? "ファイル処理中です。終了しますか？"
            : "未保存の変更があります。終了しますか？",
          { title: "FlowDesk" },
        )
      )
        await getCurrentWindow().destroy();
    }
  });
} else message("デスクトップアプリから起動してください。");
