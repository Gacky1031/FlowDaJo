import type { HistogramOverlay, Project, WorksheetPlot } from "./types";
import { gateAppliesToSample, pathFor, resolveGate } from "./model";
import { histogramPalette, histogramSeriesColor, histogramSources } from "./histogram";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function editHistogramComparison(plot: WorksheetPlot, project: Project, apply: (value: WorksheetPlot) => void) {
  const draft = structuredClone(plot);
  const dialog = document.createElement("dialog");
  dialog.className = "axis-dialog histogram-comparison-dialog";
  dialog.setAttribute("aria-label", "ヒストグラムの重ね合わせ比較");
  const close = () => { dialog.close(); dialog.remove(); };
  const updateSource = (source: HistogramOverlay) => {
    if (source.id === "primary") { draft.sampleId = source.sampleId; draft.population = source.population; draft.histogramColor = source.color; }
    else Object.assign(draft.histogramOverlays!.find((entry) => entry.id === source.id)!, source);
  };
  const render = () => {
    const sources = histogramSources(draft);
    if (sources.length < 2) draft.histogramControl = undefined;
    const option = (value: string, label: string, selected: string) => `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(label)}</option>`;
    dialog.innerHTML = `<form><div class="axis-dialog-heading"><h2>ヒストグラムの重ね合わせ比較</h2><button type="button" data-close aria-label="閉じる">×</button></div><p class="hint">すべての曲線にこのプロットのX軸・ビン・平滑化・正規化を使用します。Controlに指定した曲線は他サンプルへの展開でも固定されます。</p><label class="check"><input type="radio" name="control" value="" ${!draft.histogramControl ? "checked" : ""}> Controlなし（すべて展開）</label><div class="histogram-series-editor">${sources.map((source, index) => {
      const paths = [[], ...project.gates.filter((gate) => gateAppliesToSample(gate, source.sampleId)).map((gate) => pathFor(project, gate.id, source.sampleId))];
      if (!paths.some((path) => JSON.stringify(path) === JSON.stringify(source.population))) paths.push(source.population);
      return `<fieldset data-series="${source.id}"><legend>曲線 ${index + 1}${index === 0 ? " · 主プロット" : ""}</legend><div class="two"><label>サンプル<select data-series-sample>${project.samples.map((sample) => option(sample.id, sample.name, source.sampleId)).join("")}</select></label><label>分画<select data-series-population>${paths.map((path) => option(JSON.stringify(path), ["All events", ...path].join(" / "), JSON.stringify(source.population))).join("")}</select></label></div><label class="check"><input type="radio" name="control" value="${source.id}" ${draft.histogramControl === source.id ? "checked" : ""}> この曲線をControlとして固定</label><label class="check"><input type="checkbox" data-color-override ${source.color ? "checked" : ""}> 曲線の色をOverride（分画の色は変更しません）</label><div class="histogram-color-swatches">${histogramPalette.map((color) => `<button type="button" data-series-color="${color}" title="${color}" aria-label="曲線 ${index + 1}の色 ${color}" aria-pressed="${color === histogramSeriesColor(draft, source, index)}" style="--swatch-color:${color}"></button>`).join("")}</div>${index > 0 ? '<button type="button" data-remove-series>この曲線を比較から外す</button>' : ""}</fieldset>`;
    }).join("")}</div><button type="button" data-add-series>＋ 比較するヒストグラムを追加</button><p class="axis-validation" role="alert"></p><div class="axis-dialog-actions"><button type="button" data-cancel>キャンセル</button><button type="submit" class="primary">比較設定を適用</button></div></form>`;
    dialog.querySelector<HTMLButtonElement>("[data-close]")!.onclick = close;
    dialog.querySelector<HTMLButtonElement>("[data-cancel]")!.onclick = close;
    dialog.querySelectorAll<HTMLInputElement>('[name="control"]').forEach((radio) => {
      radio.disabled = sources.length < 2 && !!radio.value;
      radio.onchange = () => { draft.histogramControl = radio.value || undefined; render(); };
    });
    dialog.querySelectorAll<HTMLElement>("[data-series]").forEach((row) => {
      const source = sources.find((entry) => entry.id === row.dataset.series)!;
      row.querySelector<HTMLSelectElement>("[data-series-sample]")!.onchange = (event) => {
        source.sampleId = (event.target as HTMLSelectElement).value;
        if (!resolveGate(project, source.population, source.sampleId)) source.population = [];
        updateSource(source); render();
      };
      row.querySelector<HTMLSelectElement>("[data-series-population]")!.onchange = (event) => { source.population = JSON.parse((event.target as HTMLSelectElement).value); updateSource(source); };
      row.querySelector<HTMLInputElement>("[data-color-override]")!.onchange = (event) => { source.color = (event.target as HTMLInputElement).checked ? histogramSeriesColor(draft, source, sources.indexOf(source)) : undefined; updateSource(source); render(); };
      row.querySelectorAll<HTMLButtonElement>("[data-series-color]").forEach((button) => button.onclick = () => { source.color = button.dataset.seriesColor; updateSource(source); render(); });
      const remove = row.querySelector<HTMLButtonElement>("[data-remove-series]");
      if (remove) remove.onclick = () => { draft.histogramOverlays = draft.histogramOverlays?.filter((entry) => entry.id !== source.id); if (draft.histogramControl === source.id) draft.histogramControl = undefined; render(); };
    });
    dialog.querySelector<HTMLButtonElement>("[data-add-series]")!.onclick = () => {
      const sampleId = project.samples.find((sample) => !sources.some((source) => source.sampleId === sample.id))?.id ?? draft.sampleId;
      draft.histogramOverlays ??= [];
      draft.histogramOverlays.push({ id: crypto.randomUUID(), sampleId, population: [...draft.population] });
      if (!resolveGate(project, draft.population, sampleId)) draft.histogramOverlays.at(-1)!.population = [];
      render();
    };
    dialog.querySelector("form")!.onsubmit = (event) => {
      event.preventDefault();
      for (const source of histogramSources(draft)) {
        const sample = project.samples.find((sample) => sample.id === source.sampleId);
        if (!sample?.channels.some((channel) => channel.id === draft.x.channel) || !resolveGate(project, source.population, source.sampleId)) {
          dialog.querySelector<HTMLElement>(".axis-validation")!.textContent = "サンプルのX軸チャンネルと分画を確認してください。"; return;
        }
      }
      close(); apply(draft);
    };
  };
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  render(); document.body.append(dialog); dialog.showModal();
}
