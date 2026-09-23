import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save, confirm } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  Gate,
  Project,
  Sample,
  WorksheetPlot,
  WorksheetData,
  WorksheetResult,
  WorksheetMode,
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
const selectedCards = new Set<string>();
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
const cardSample = (c: WorksheetPlot) =>
  sample(c.sampleId === "active" ? sampleId : c.sampleId);
function normalizeWorksheetPlots(ws = sheet()) {
  const mode = ws.mode ?? "global";
  ws.mode = mode;
  const fallback = sampleId || project.samples[0]?.id || "";
  if (mode === "global") {
    // A Global worksheet always follows exactly one selected sample.
    for (const p of ws.plots) p.sampleId = "active";
  } else {
    // A Normal worksheet stores a concrete sample on every plot.
    for (const p of ws.plots) {
      if (p.sampleId === "active" || !project.samples.some((s) => s.id === p.sampleId))
        p.sampleId = fallback;
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
  let remembered = false;
  const setRange = (a: WorksheetPlot["x"], range: DisplayRange, expandAuto = false) => {
    const hasRange = a.min !== undefined && a.max !== undefined;
    if (a.autoRange !== true && (a.min !== undefined || a.max !== undefined)) return;
    if (a.autoRange === true && hasRange && (!expandAuto || (range[0] >= a.min! && range[1] <= a.max!))) return;
    if (!remembered && (a.autoRange !== true || a.min !== range[0] || a.max !== range[1])) {
      remember();
      remembered = true;
    }
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
    document.querySelector(".statistics")?.classList.toggle("stale", value);
    if (!value && !gesture) paint();
  },
);
function analyze() {
  if (!sampleId) return;
  jobs.submit({
    project: clone(),
    sampleId,
    plots: structuredClone(sheet().plots),
  });
}
function changed(calculate = true) {
  render();
  if (calculate) analyze();
  else statusBar();
}
function statsTable() {
  const stats = data.stats[sampleId] ?? [];
  return `<div class="stats-title">Population statistics <span>${pending ? "更新待ち" : "全イベント"} · median＝補正後の線形値</span></div><table><thead><tr><th>Population</th><th>Events</th><th>% Parent</th><th>% Total</th>${(sample()?.channels ?? []).map((c) => `<th>${esc(c.id)} median</th>`).join("")}</tr></thead><tbody>${stats.map((s) => `<tr data-pop="${esc(s.id)}"><td>${esc(s.name)}</td><td>${fmt(s.count)}</td><td>${fmt(s.percentParent)}</td><td>${fmt(s.percentTotal)}</td>${(sample()?.channels ?? []).map((c) => `<td>${fmt(s.medians[c.id])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
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
      return `<div class="sample-group"><button class="sample ${s.id === sampleId ? "selected" : ""}" data-sample="${esc(s.id)}">▣ ${esc(s.name)}<small>${fmt(s.events)} events · ${s.compensation.enabled ? "Comp ON" : "Comp OFF"}</small></button>${s.id === sampleId ? nodes("root", 0) : ""}</div>`;
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
      ? `<select data-binding="${c.id}" title="Global worksheet: 選択サンプルを表示">${selectOptions(
          [
            {
              value: "active",
              label: `↻ Global · ${sample()?.name ?? "選択サンプル"}`,
            },
            ...project.samples.map((s) => ({
              value: s.id,
              label: `📌 ${s.name}`,
            })),
          ],
          c.sampleId,
        )}</select>`
      : `<select data-binding="${c.id}" title="Normal sheet: プロットごとの固定サンプル">${selectOptions(
          project.samples.map((s) => ({
            value: s.id,
            label: `📌 ${s.name}`,
          })),
          c.sampleId,
        )}</select>`;
  return `<section class="plot-card ${activeCard === c.id ? "active" : ""} ${focusedCard === c.id ? "focused" : ""} ${selectedCards.has(c.id) ? "selected-card" : ""}" data-card="${c.id}" style="left:${c.left}px;top:${c.top}px;width:${c.width}px;height:${c.height}px"><div class="plot-head" data-move="${c.id}"><label class="plot-select" title="一括操作の対象"><input type="checkbox" data-select-card="${c.id}" ${selectedCards.has(c.id) ? "checked" : ""} aria-label="プロットを一括操作の対象にする"></label><span class="grip">⠿</span>${binding}<button data-swap="${c.id}" title="X / Y 軸を入れ替え" aria-label="X / Y 軸を入れ替え" ${oneDimensional(c) ? "disabled" : ""}>⇄</button><button data-focus="${c.id}" title="${focusedCard === c.id ? "ワークシートに戻る (Esc)" : "拡大して編集"}" aria-label="${focusedCard === c.id ? "ワークシートに戻る" : "拡大して編集"}">${focusedCard === c.id ? "↙" : "⛶"}</button><button data-duplicate="${c.id}" title="プロットを複製">⧉</button><button data-plot-options="${c.id}" title="プロット表示設定" aria-label="プロット表示設定">⚙</button><button data-remove="${c.id}" title="プロットを削除">×</button></div><div class="plot-pop"><button data-parent="${c.id}" aria-label="親集団に戻る" title="親集団に戻る" ${c.population.length ? "" : "disabled"}>↑</button><select data-population="${c.id}" aria-label="表示する集団">${populationOptions(c)}</select><select data-mode="${c.id}" title="グラフ形式">${selectOptions(plotModes, c.mode)}</select></div><div class="plot-stage" data-stage="${c.id}"><canvas></canvas><svg xmlns="http://www.w3.org/2000/svg"></svg><div class="plot-error"></div>${axisLabels(c, channels)}</div><div class="resize-grip" data-resize="${c.id}" title="サイズを変更">◢</div></section>`;
}
function inspector() {
  const c = card(),
    s = c ? cardSample(c) : sample();
  const g = project.gates.find((g) => g.id === selectedGate);
  return `<h2>Graph properties</h2>${
    c
      ? `<div class="axis-summary"><p class="hint">軸名をクリックしてチャンネルを選択。右クリック、または T でスケールを調整。</p>${(["x", "y"] as const).map((k) => `<button data-inspect-axis="${k}" ${k === "y" && oneDimensional(c) ? "disabled" : ""}><strong>${k.toUpperCase()} · ${k === "y" && oneDimensional(c) ? "Count" : esc(c[k].channel)}</strong><small>${k === "y" && oneDimensional(c) ? "イベント数" : `${scaleLabel(c[k].scale)} · ${c[k].min === undefined ? "Auto range" : `${c[k].min} ～ ${c[k].max}`}`}</small><span>詳細…</span></button>`).join("")}</div>`
      : '<p class="hint">プロットを選択して軸を調整します。</p>'
  }
 ${g ? `<h2>Gate editor</h2><label>集団名<input id="gate-name" value="${esc(g.name)}"></label><label>適用範囲<select id="gate-scope"><option value="sample" ${gateScope(g) === "sample" ? "selected" : ""}>個別適用（${esc(g.sampleId)}）</option><option value="global" ${gateScope(g) === "global" ? "selected" : ""}>全体適用（全サンプル）</option></select></label><div class="hint">線をドラッグして移動。白い点をドラッグして形を変更。四分割の中心は4集団まとめて移動します。</div><button id="gate-parent">親集団で編集</button><button id="gate-child">子集団のプロットを開く</button><button id="delete-gate" class="danger">ゲートと子集団を削除</button>` : ""}
 ${s ? `<details class="compensation"><summary>Compensation · ${s.compensation.enabled ? "ON" : "OFF"}</summary><label class="check"><input id="comp-enabled" type="checkbox" ${s.compensation.enabled ? "checked" : ""}> 補正を有効にする</label><div class="matrix-wrap"><table><thead><tr><th>Source ↓ / detector →</th>${s.compensation.channels.map((ch) => `<th>${esc(ch)}</th>`).join("")}</tr></thead><tbody>${s.compensation.values.map((row, i) => `<tr><th>${esc(s.compensation.channels[i])}</th>${row.map((v, j) => `<td><input data-matrix="${i},${j}" type="number" step="0.1" value="${+(v * 100).toFixed(6)}" ${i === j ? "disabled" : ""}></td>`).join("")}</tr>`).join("")}</tbody></table></div><div class="comp-actions"><button id="apply-comp">補正を適用</button><button id="comp-all-on">全サンプル ON</button><button id="comp-all-off">全サンプル OFF</button><button id="copy-comp">他サンプルへコピー</button></div></details>` : ""}
 <details><summary>実験ノート / import情報</summary><textarea id="notes">${esc(project.notes)}</textarea><p class="hint">${esc(project.importWarnings.join("\n"))}</p></details>`;
}
function render() {
  normalizeWorksheetPlots();
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
  app.innerHTML = `<header><strong>FlowDesk <span>WORKSPACE</span></strong><input id="experiment" value="${esc(project.name)}" aria-label="Experiment name"><span class="spacer"></span><span>R / flowCore · 0.4.0</span></header><nav class="toolbar"><button id="import" class="primary">＋ FCS</button><button id="folder">DIVAフォルダ</button><button id="demo">デモ</button><span class="divider"></span><button id="load">開く</button><button id="save">保存</button><button id="undo" ${history.length ? "" : "disabled"} title="Ctrl+Z">↶ 戻す</button><button id="redo" ${future.length ? "" : "disabled"} title="Ctrl+Y">↷ やり直す</button><span class="spacer"></span><button id="batch" title="個別ゲートの階層を他サンプルへコピー">ゲート階層コピー</button><button id="batch-plots" title="Normal sheet専用: 選択プロットの分画を他サンプルへ展開" ${worksheetMode() === "normal" ? "" : "disabled"}>Normal: 分画を他サンプルへ展開</button><button id="csv" title="全サンプル・全分画の統計をCSVで出力">統計 CSV</button><button id="pdf">Worksheet PDF</button><button id="report">全サンプル report</button><button id="template" title="現在のワークシートとゲート定義だけをテンプレート保存">テンプレート</button><button id="toggle-properties" title="軸・設定サイドバーの表示切替">右サイドバー</button></nav><div class="shell"><aside class="browser"><h2>Samples & populations <span>${project.samples.length}</span></h2><div id="tree">${tree()}</div><div class="hint tree-help">集団をダブルクリック、またはワークシートへドラッグしてプロットを追加。Globalは1サンプル、Normalは複数サンプルを比較します。</div><button id="show-population">選択集団をプロットに追加</button></aside><main><div class="sheet-tabs">${project.worksheets!.map((s) => `<button data-sheet="${s.id}" class="${s.id === sheet().id ? "active" : ""}">${esc(s.name)} <small>${s.mode === "normal" ? "Normal" : "Global"} · ${s.plots.length}</small></button>`).join("")}<button id="new-sheet" title="ワークシートを追加">＋</button><button id="clone-sheet" title="ワークシートを複製">⧉</button></div><div class="workspace-heading"><input id="sheet-name" value="${esc(sheet().name)}" aria-label="Worksheet name"><div class="sheet-mode" aria-label="ワークシートモード"><span>Mode:</span><button type="button" data-sheet-mode="global" class="${worksheetMode() === "global" ? "active" : ""}" title="選択サンプルを全プロットへ一括適用">Global</button><button type="button" data-sheet-mode="normal" class="${worksheetMode() === "normal" ? "active" : ""}" title="サンプルごとに固定したプロットを比較">Normal</button></div><button id="add-plot" class="primary">＋ Plot</button><button id="standard-expansion" title="FSC/SSCの定型展開を追加">定型展開</button><button id="compensation-expansion" title="FSC-Aを横軸、全蛍光を縦軸にしたコンペ調整用プロットを作成">Comp定型解析</button><button id="batch-axis-x" title="選択プロットのX軸を一括変更">選択X軸</button><button id="batch-axis-y" title="選択プロットのY軸を一括変更">選択Y軸</button><button id="batch-arrange" title="選択プロットを配置。Normal sheetでは他サンプル展開後の配置も選べます">バッチ配置 / 展開</button><button id="batch-plots-sheet" title="Normal sheet専用: この分画プロットを他サンプルへ展開" ${worksheetMode() === "normal" ? "" : "disabled"}>Normal: 分画展開</button><button id="arrange" title="各プロットを最寄りのグリッドに揃える">グリッド整列</button><span class="print-settings"><span>印刷:</span><label><input data-print-gate-names type="checkbox">分画名</label><label><input data-print-gate-percentages type="checkbox">割合</label></span><span class="zoom-controls"><button id="zoom-out">−</button><output id="zoom-value">100%</output><button id="zoom-in">＋</button><button id="zoom-reset">1:1</button></span><button id="delete-sheet" title="ワークシートを削除">削除</button><span id="selection-info" class="selection-info">選択: ${selectedPlots().length}</span><span class="spacer"></span><div class="gate-tools">${[
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
    )}</div><div class="gate-scope" aria-label="分画の適用範囲"><span>新規分画:</span><button type="button" data-gate-scope="sample" class="${gateScopeMode === "sample" ? "active" : ""}" title="選択中のサンプルだけに適用">個別適用</button><button type="button" data-gate-scope="global" class="${gateScopeMode === "global" ? "active" : ""}" title="全サンプルに適用">全体適用</button></div><div class="gate-filter" aria-label="分画表示"><span>分画:</span><button type="button" data-gate-filter="all" class="${gateFilter === "all" ? "active" : ""}">すべて</button><button type="button" data-gate-filter="global" class="${gateFilter === "global" ? "active" : ""}">Global</button><button type="button" data-gate-filter="sample" class="${gateFilter === "sample" ? "active" : ""}">個別</button></div></div><div class="viewport"><div class="board" style="width:${Math.max(1120, ...sheet().plots.map((c) => c.left + c.width + 30))}px;height:${Math.max(710, ...sheet().plots.map((c) => c.top + c.height + 40))}px">${sheet().plots.map(plotCard).join("")}${!sheet().plots.length ? '<div class="empty"><h1>' + (worksheetMode() === "normal" ? "Normal sheet" : "Global worksheet") + '</h1><p>' + (worksheetMode() === "normal" ? "複数サンプルの分画プロットを並べて比較できます。" : "選択中の1サンプルを共通軸で解析します。") + '<br>左の集団をドラッグ、または「＋ Plot」で始めます。</p></div>' : ""}</div></div><section class="statistics ${pending ? "stale" : ""}">${statsTable()}</section></main><aside class="properties">${inspector()}</aside></div><footer></footer>`;
  const board = document.querySelector<HTMLElement>(".board")!;
  board.style.zoom = String(sheet().zoom ?? 1);
  document.querySelector<HTMLInputElement>("[data-print-gate-names]")!.checked = !!sheet().print?.showGateNames;
  document.querySelector<HTMLInputElement>("[data-print-gate-percentages]")!.checked = !!sheet().print?.showGatePercentages;
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
        changed(false);
      };
      controls.append(button);
    }
    sampleButton.parentElement?.append(controls);
  });
}function paint() {
  if (gesture) return;
  document.querySelector("#tree")!.innerHTML = tree();
  decorateSampleOrder();
  document.querySelector(".statistics")!.innerHTML = statsTable();
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
  document.querySelector(".properties")!.innerHTML = inspector();
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
  const c = newPlot(s, sheet().plots.length, population);
  if (worksheetMode() === "normal") c.sampleId = sourceId;
  else c.sampleId = "active";
  if (at) {
    c.left = Math.max(0, at[0]);
    c.top = Math.max(0, at[1]);
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
    const p = newPlot(s, baseIndex + i, population);
    p.x = axis(findChannel(s, xName)!);
    p.y = axis(findChannel(s, yName)!);
    p.sampleId = worksheetMode() === "normal"
      ? current?.sampleId ?? s.id
      : "active";
    p.left = 24 + ((baseIndex + i) % 3) * 360;
    p.top = 24 + Math.floor((baseIndex + i) / 3) * 330;
    sheet().plots.push(p);
  });
  activeCard = sheet().plots.at(-1)?.id ?? activeCard;
  changed();
  message(
    `${available.map(([, , label]) => label).join("・")} を追加しました。`,
  );
}
function setSheetMode(mode: WorksheetMode) {
  if (worksheetMode() === mode) return;
  remember();
  sheet().mode = mode;
  normalizeWorksheetPlots();
  selectedCards.clear();
  changed();
  message(
    mode === "global"
      ? "Global worksheet: 1サンプルだけを全プロットへ表示します。"
      : "Normal sheet: プロットごとにサンプルと分画を固定して比較します。",
  );
}
function addCompensationAnalysis() {
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
  remember();
  const baseIndex = sheet().plots.length;
  selectedCards.clear();
  channels.forEach((ch, i) => {
    const p = newPlot(s, baseIndex + i, population);
    p.x = axis(xId);
    p.y = axis(ch.id);
    p.sampleId = worksheetMode() === "normal" ? s.id : "active";
    p.left = 24 + ((baseIndex + i) % 3) * 360;
    p.top = 24 + Math.floor((baseIndex + i) / 3) * 330;
    sheet().plots.push(p);
    selectedCards.add(p.id);
  });
  activeCard = sheet().plots[baseIndex]?.id ?? activeCard;
  changed();
  message(
    "コンペ調整用に" + channels.length + "プロットを追加しました。横軸は「選択X軸」で一括変更できます。",
  );
}
function batchAxisDialog(side: AxisSide) {
  const targets = selectedPlots();
  const reference =
    targets.map((p) => cardSample(p)).find((value): value is Sample => !!value) ??
    sample();
  if (!targets.length || !reference) {
    message("一括変更するプロットを選択してください。");
    return;
  }
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-label", side.toUpperCase() + "軸の一括変更");
  dialog.innerHTML = `<form><h2>${side.toUpperCase()}軸を一括変更</h2><p class="hint">${targets.length}個の選択プロットに適用します。チャンネルが存在しないカードはスキップします。</p><label>チャンネル<select name="channel">${selectOptions(reference.channels.map((c) => ({ value: c.id, label: c.id })), targets[0][side].channel)}</select></label><div class="axis-dialog-actions"><button type="button" data-cancel>キャンセル</button><button class="primary" type="submit">一括適用</button></div></form>`;
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
    const value = (
      dialog.querySelector<HTMLSelectElement>('[name="channel"]')!
    ).value;
    const applicable = targets.filter((p) =>
      cardSample(p)?.channels.some((c) => c.id === value),
    );
    if (!applicable.length) {
      message("チャンネル「" + value + "」を持つプロットがありません。", true);
      return;
    }
    remember();
    applicable.forEach((p) => (p[side] = axis(value)));
    close();
    changed();
    message(
      side.toUpperCase() + "軸を" + applicable.length + "プロットへ一括適用しました。",
    );
  });
  dialog.showModal();
}
function arrangePlots(
  targets: WorksheetPlot[],
  rowsValue: number,
  columnsValue: number,
  direction: "row" | "column",
) {
  targets.forEach((plot, i) => {
    const row = direction === "row" ? Math.floor(i / columnsValue) : i % rowsValue;
    const column = direction === "row" ? i % columnsValue : Math.floor(i / rowsValue);
    plot.left = 24 + column * 360;
    plot.top = 24 + row * 330;
  });
}
function batchArrangeDialog() {
  const targets = selectedPlots();
  if (!targets.length) {
    message("配置するプロットを選択してください。");
    return;
  }
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-label", "選択プロットの配置・サンプル展開");
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(targets.length))));
  const rows = Math.ceil(targets.length / columns);
  const canExpand =
    worksheetMode() === "normal" &&
    project.samples.some(
      (candidate) => !targets.some((plot) => cardSample(plot)?.id === candidate.id),
    );
  dialog.innerHTML = `<form><h2>選択プロットを配置</h2><p class="hint">${targets.length}個のプロットを行数・列数で並べます。Normal sheetでは展開後のカードも同じ配置に揃えられます。</p><div class="grid-fields"><label>行数<input name="rows" type="number" min="1" max="20" value="${rows}"></label><label>列数<input name="columns" type="number" min="1" max="20" value="${columns}"></label></div><label>方向<select name="direction"><option value="row">横方向（行優先）</option><option value="column">縦方向（列優先）</option></select></label><div class="axis-dialog-actions"><button type="button" data-cancel>キャンセル</button>${canExpand ? '<button type="button" data-expand-arrange>他サンプルへ展開して配置…</button>' : ""}<button class="primary" type="submit">配置</button></div></form>`;
  document.body.append(dialog);
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  const readLayout = () => ({
    rows: Math.min(
      20,
      Math.max(
        1,
        Number(dialog.querySelector<HTMLInputElement>('[name="rows"]')!.value) || 1,
      ),
    ),
    columns: Math.min(
      20,
      Math.max(
        1,
        Number(dialog.querySelector<HTMLInputElement>('[name="columns"]')!.value) || 1,
      ),
    ),
    direction: dialog.querySelector<HTMLSelectElement>('[name="direction"]')!
      .value as "row" | "column",
  });
  dialog.querySelector<HTMLButtonElement>("[data-cancel]")!.onclick = close;
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.querySelector<HTMLButtonElement>("[data-expand-arrange]")?.addEventListener(
    "click",
    () => {
      const layout = readLayout();
      close();
      batchPlotsToSamples(undefined, (created) => {
        arrangePlots([...targets, ...created], layout.rows, layout.columns, layout.direction);
      });
    },
  );
  dialog.querySelector("form")!.addEventListener("submit", (event) => {
    event.preventDefault();
    const layout = readLayout();
    remember();
    arrangePlots(targets, layout.rows, layout.columns, layout.direction);
    close();
    changed(false);
    message(
      targets.length +
        "個のプロットを" +
        layout.rows +
        "行 × " +
        layout.columns +
        "列で配置しました。",
    );
  });
  dialog.showModal();
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
  if (existing) {
    const g = project.gates.find((g) => g.id === existing.id)!;
    Object.assign(g, shape);
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
          color: populationPalette[(project.gates.length + q - 1) % populationPalette.length],
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
function removeGate(g: Gate) {
  remember();
  const oldPath = pathFor(project, g.id, g.sampleId),
    parent = oldPath.slice(0, -1);
  deleteBranch(project, g);
  for (const ws of project.worksheets!)
    for (const p of ws.plots)
      if (
        (gateScope(g) === "global" ||
          p.sampleId === g.sampleId ||
          (p.sampleId === "active" && gateAppliesToSample(g, sampleId))) &&
        oldPath.every((v, i) => p.population[i] === v)
      )
        p.population = [...parent];
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
function gateMenu(g: Gate, x: number, y: number, c?: WorksheetPlot) {
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
  activate(c.id);
  if (hits.length === 1) {
    gateMenu(hits[0], e.clientX, e.clientY, c);
    return;
  }
  if (hits.length > 1) {
    contextMenu(
      e.clientX,
      e.clientY,
      "操作する分画を選択",
      hits.map((g) => ({
        label: g.name,
        run: () => gateMenu(g, e.clientX, e.clientY, c),
      })),
    );
    return;
  }
  contextMenu(e.clientX, e.clientY, "プロット", [
    { label: "プロット表示設定…", run: () => plotOptions(c) },
    {
      label: "親集団に戻る",
      run: () => parentPopulation(c),
      disabled: !c.population.length,
    },
    {
      label: "Normal: このプロットを他サンプルへ展開…",
      run: () => batchPlotsToSamples(c),
      disabled: worksheetMode() !== "normal",
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
function wire() {
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
        project.samples.push(s);
        sampleId = s.id;
        if (!sheet().plots.length) {
          sheet().plots.push(newPlot(s, 0));
          activeCard = sheet().plots[0].id;
        }
        changed();
      }),
  );
  on("import", () => void importData(false));
  on("folder", () => void importData(true));
  on("load", () => void loadProject());
  on("save", () => void saveProject());
  on("pdf", () => void exportPdf(true));
  on("report", () => void exportPdf(false));
  on("template", () => void saveWorksheetTemplate());
  on("csv", () => void exportStatistics());
  on("batch", batchGates);
  on("batch-plots", () => batchPlotsToSamples());
  on("batch-plots-sheet", () => batchPlotsToSamples());
  on("undo", () => undo(false));
  on("redo", () => undo(true));
  on("add-plot", () => addPlot());
  on("standard-expansion", addStandardExpansion);
  on("compensation-expansion", addCompensationAnalysis);
  on("batch-axis-x", () => batchAxisDialog("x"));
  on("batch-axis-y", () => batchAxisDialog("y"));
  on("batch-arrange", batchArrangeDialog);
  on("show-population", () =>
    addPlot(pathFor(project, project.selectedGate, sampleId)),
  );
  on("new-sheet", () => {
    remember();
    const s = {
      id: uid(),
      name: `Worksheet ${project.worksheets!.length + 1}`,
      plots: [],
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
    project.worksheets!.push(s);
    project.activeWorksheet = s.id;
    selectedCards.clear();
    changed();
  });
  on("delete-sheet", () => {
    if (project.worksheets!.length === 1) return;
    remember();
    project.worksheets = project.worksheets!.filter(
      (s) => s.id !== project.activeWorksheet,
    );
    project.activeWorksheet = project.worksheets[0].id;
    selectedCards.clear();
    activeCard = sheet().plots[0]?.id ?? "";
    changed();
  });
  on("arrange", () => {
    remember();
    sheet().plots.forEach((c) => {
      c.left = 24 + Math.round((c.left - 24) / 360) * 360;
      c.top = 24 + Math.round((c.top - 24) / 330) * 330;
    });
    changed(false);
  });
  on("zoom-out", () => { remember(); sheet().zoom = Math.max(0.5, +((sheet().zoom ?? 1) - 0.1).toFixed(2)); render(); });
  on("zoom-in", () => { remember(); sheet().zoom = Math.min(2, +((sheet().zoom ?? 1) + 0.1).toFixed(2)); render(); });
  on("zoom-reset", () => { remember(); sheet().zoom = 1; render(); });
  on("toggle-properties", () => {
    if (window.matchMedia("(max-width: 1350px)").matches)
      document.body.classList.toggle("show-properties");
    else document.body.classList.toggle("hide-properties");
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
  document.querySelectorAll<HTMLInputElement>("[data-print-gate-names], [data-print-gate-percentages]").forEach((input) => input.onchange = () => {
    remember();
    const print = sheet().print ?? (sheet().print = {});
    if (input.dataset.printGateNames !== undefined) print.showGateNames = input.checked;
    if (input.dataset.printGatePercentages !== undefined) print.showGatePercentages = input.checked;
    dirty = true;
  });
  document.querySelectorAll<HTMLElement>("[data-sheet]").forEach(
    (el) =>
      (el.onclick = () => {
        project.activeWorksheet = el.dataset.sheet!;
        activeCard = sheet().plots[0]?.id ?? "";
        selectedCards.clear();
        selectedGate = "";
        render();
        analyze();
      }),
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
        const info = document.querySelector("#selection-info");
        if (info) info.textContent = "選択: " + selectedPlots().length;
      }),
  );
  app.onclick = (e) => {
    const el = (e.target as Element).closest<HTMLElement>(
      "[data-pop],[data-sample]",
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
  };  document.querySelectorAll<HTMLElement>("[data-card]").forEach((el) =>
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
    }),
  );
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
    const el = (e.target as Element).closest<HTMLElement>(
      ".population[data-pop], tr[data-pop]",
    );
    if (!el) return;
    e.preventDefault();
    const g = project.gates.find(
      (g) =>
        g.id === el.dataset.pop &&
        gateAppliesToSample(g, el.dataset.sample ?? sampleId),
    );
    if (g) gateMenu(g, e.clientX, e.clientY);
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
            c[side] = axis(id);
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
        if ((e.target as Element).closest("button,select,input,label,textarea,a") || focusedCard)
          return;
        e.preventDefault();
        const c = sheet().plots.find(
          (p) => p.id === (el.dataset.move ?? el.dataset.resize),
        )!;
        const element = el.closest<HTMLElement>("[data-card]")!;
        const original = { ...c },
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
            c.width = Math.max(280, original.width + dx);
            c.height = Math.max(270, original.height + dy);
            element.style.width = `${c.width}px`;
            element.style.height = `${c.height}px`;
          } else {
            c.left = Math.max(0, original.left + dx);
            c.top = Math.max(0, original.top + dy);
            element.style.left = `${c.left}px`;
            element.style.top = `${c.top}px`;
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
  });
}
function setCompensationEnabled(enabled: boolean) {
  if (!project.samples.length) return;
  remember(); project.samples.forEach((s) => (s.compensation.enabled = enabled)); changed();
  message("補正を全 " + project.samples.length + " サンプルで " + (enabled ? "ON" : "OFF") + " にしました。");
}
function copyCompensationToSamples() {
  const source = card() ? cardSample(card()!) : sample(); if (!source) return;
  const config = structuredClone(source.compensation);
  const targets = project.samples.filter((target) => target.id !== source.id && config.channels.every((channel) => target.channels.some((item) => item.id === channel)));
  if (!targets.length) { message("コピー可能なチャンネル構成のサンプルがありません。", true); return; }
  remember(); targets.forEach((target) => (target.compensation = structuredClone(config))); changed();
  message(source.name + " の補正を " + targets.length + " サンプルへコピーしました。");
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
    const c = newPlot(
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
  on("comp-all-on", () => setCompensationEnabled(true));
  on("comp-all-off", () => setCompensationEnabled(false));
  on("copy-comp", () => copyCompensationToSamples());
  on("apply-comp", () => {
    const s = card() ? cardSample(card()!) : sample();
    if (!s) return;
    const config = structuredClone(s.compensation);
    config.enabled =
      document.querySelector<HTMLInputElement>("#comp-enabled")!.checked;
    document
      .querySelectorAll<HTMLInputElement>("[data-matrix]")
      .forEach((el) => {
        const [i, j] = el.dataset.matrix!.split(",").map(Number);
        config.values[i][j] = Number(el.value) / 100;
      });
    if (config.values.flat().some((v) => !Number.isFinite(v))) {
      message("補正行列に有限の数値を入力してください。", true);
      return;
    }
    remember();
    s.compensation = config;
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
async function importData(folder: boolean) {
  const paths = await open({
    directory: folder,
    multiple: !folder,
    filters: folder ? undefined : [{ name: "FCS", extensions: ["fcs"] }],
  });
  if (!paths) return;
  await runOperation("FCSを読み込み中…", async () => {
    const r = await rpc<{
      samples: Sample[];
      warnings: string[];
      divaMetadata: Project["divaMetadata"];
    }>("import", { paths: Array.isArray(paths) ? paths : [paths] });
    remember();
    for (const s of r.samples) {
      if (
        project.samples.some((old) => old.path === s.path && old.md5 === s.md5)
      )
        continue;
      s.id = uid();
      project.samples.push(s);
      sampleId = s.id;
    }
    project.importWarnings.push(...r.warnings);
    project.divaMetadata = [
      ...(project.divaMetadata ?? []),
      ...(r.divaMetadata ?? []),
    ];
    if (!sheet().plots.length && sample()) {
      const c = newPlot(sample()!, 0);
      sheet().plots.push(c);
      activeCard = c.id;
    }
    changed();
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
  dialog.innerHTML = `<form><h2>全サンプルPDFの出力内容</h2><p class="hint">Global worksheetを各サンプルへ展開して出力します。必要なページだけ選択してください。</p><label class="check"><input name="plots" type="checkbox" checked> プロット</label><label class="check"><input name="statistics" type="checkbox" checked> 集団統計</label><label class="check"><input name="compensation" type="checkbox" checked> Compensation / spillover 行列</label><div class="axis-dialog-actions"><button type="button" data-cancel>キャンセル</button><button class="primary" type="submit">PDFを生成</button></div></form>`;
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
    await rpc(worksheet ? "worksheet_pdf" : "worksheet_report_pdf", {
      project: clone(),
      path,
      sampleId,
      plots: structuredClone(sheet().plots),
      worksheetName: sheet().name,
      includePlots: options.plots,
      includeStatistics: options.statistics,
      includeCompensation: options.compensation,
      worksheetPrint: structuredClone(sheet().print ?? {}),
    });
    message(`PDFを保存しました: ${path}`);
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
function batchPlotsToSamples(seed?: WorksheetPlot, after?: (created: WorksheetPlot[]) => void) {
  if (worksheetMode() !== "normal") {
    message("分画プロットのバッチ展開はNormal sheetだけで使用できます。", true);
    return;
  }
  const sources = (seed ? [seed] : selectedPlots()).filter((p) => cardSample(p));
  if (!sources.length) {
    message("展開するプロットを選択してください。", true);
    return;
  }
  const sourceSummary = sources
    .map((p) => {
      const owner = cardSample(p)?.name ?? "不明";
      const population = p.population.length ? p.population.join(" / ") : "All events";
      return owner + " · " + population;
    })
    .join("、");
  const candidates = project.samples.filter(
    (target) => !sources.some((p) => cardSample(p)?.id === target.id),
  );
  if (!candidates.length) {
    message("展開先になる別サンプルがありません。", true);
    return;
  }
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-label", "Normal sheetの分画プロットをバッチ展開");
  dialog.innerHTML = `<form><h2>Normal sheet · 分画プロットを他サンプルへ展開</h2><p class="hint">選択中: ${esc(sourceSummary)}。同じ軸・同じ分画パスで、選択したサンプルのプロットカードを追加します。</p>${candidates
    .map(
      (target) =>
        `<label class="check"><input type="checkbox" value="${esc(target.id)}" checked> ${esc(target.name)}</label>`,
    )
    .join("")}<div class="axis-dialog-actions"><button type="button" data-batch-cancel>キャンセル</button><button id="batch-plots-apply" class="primary" type="submit">選択サンプルへ展開</button></div></form>`;
  document.body.append(dialog);
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.querySelector("[data-batch-cancel]")!.addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.querySelector("form")!.addEventListener("submit", (event) => {
    event.preventDefault();
    const targets = Array.from(
      dialog.querySelectorAll<HTMLInputElement>("input[type=checkbox]:checked"),
    ).map((input) => input.value);
    if (!targets.length) return;
    remember();

    alignBatchSourceRanges(sources);
    const created: WorksheetPlot[] = [];
    const skipped: string[] = [];
    for (const source of sources) {
      const owner = cardSample(source);
      if (!owner) continue;
      for (const targetId of targets) {
        if (targetId === owner.id) continue;
        const target = sample(targetId);
        if (!target) continue;
        const gateId = resolveGate(project, source.population, target.id);
        if (source.population.length && !gateId) {
          skipped.push(target.name + ": " + source.population.join(" / ") + "（分画なし）");
          continue;
        }
        if (
          !target.channels.some((channel) => channel.id === source.x.channel) ||
          (!oneDimensional(source) &&
            !target.channels.some((channel) => channel.id === source.y.channel))
        ) {
          skipped.push(target.name + ": 軸チャンネルなし");
          continue;
        }
        const duplicate = sheet().plots.some(
          (plot) =>
            plot.sampleId === target.id &&
            JSON.stringify(plot.population) === JSON.stringify(source.population) &&
            axisKey(plot.x) === axisKey(source.x) &&
            axisKey(plot.y) === axisKey(source.y) &&
            plot.mode === source.mode,
        );
        if (duplicate) continue;
        const index = sheet().plots.length + created.length;
        const copy = structuredClone(source);
        copy.id = uid();
        copy.sampleId = target.id;
        copy.left = 24 + (index % 3) * 360;
        copy.top = 24 + Math.floor(index / 3) * 330;
        created.push(copy);
      }
    }
    sheet().plots.push(...created);
    after?.(created);
    selectedCards.clear();
    created.forEach((plot) => selectedCards.add(plot.id));
    if (created.length) activeCard = created[0].id;
    close();
    changed();
    message(
      created.length +
        "個の分画プロットを追加しました。" +
        (skipped.length
          ? " スキップ: " + skipped.slice(0, 4).join("、") + (skipped.length > 4 ? "…" : "")
          : "") + (after ? " 配置も更新しました。" : ""),
    );
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
