import type { WorksheetPlot, PlotStyle, PlotMode } from "./types";
import { plotModes } from "./model";
export function editPlotOptions(
  c: WorksheetPlot,
  apply: (value: PlotStyle & { mode: PlotMode }) => void,
) {
  const dialog = document.createElement("dialog");
  dialog.className = "axis-dialog";
  dialog.setAttribute("aria-label", "プロット表示設定");
  dialog.innerHTML = `<form><div class="axis-dialog-heading"><h2>プロット表示設定</h2><button type="button" data-close aria-label="閉じる">×</button></div><label>表示形式<select name="mode">${plotModes.map((m) => `<option value="${m.value}">${m.label}</option>`).join("")}</select></label><fieldset><legend>点と色</legend><div class="two"><label>点の大きさ (px)<input name="dotSize" type="number" min="0.5" max="8" step="0.1"></label><label>不透明度 (0–1)<input name="dotOpacity" type="number" min="0.05" max="1" step="0.05"></label></div><label>点・ヒストグラムの色<input name="color" type="color"></label></fieldset><fieldset><legend>密度 / 等高線</legend><label class="check"><input name="smoothing" type="checkbox">平滑化する</label><label class="check"><input name="showOutliers" type="checkbox">最外等高線の外のイベントも点で表示</label><label>等高線の確率間隔<select name="contourPercent"><option value="5">5%</option><option value="10">10%</option><option value="20">20%</option></select></label><p class="hint">密度計算には表示範囲内の全イベントを使用します。点の描画は最大12,000イベントです。</p></fieldset><fieldset><legend>Histogram / CDF</legend><div class="two"><label>ビン数<select name="bins"><option value="64">64</option><option value="128">128</option><option value="256">256</option><option value="512">512</option></select></label><label>ヒストグラム縦軸<select name="histogramNormalize"><option value="count">Count</option><option value="percent">% of events</option><option value="mode">% of maximum</option></select></label></div><p class="hint">CDFは表示範囲内のイベントの累積割合（%）です。</p></fieldset><div class="axis-dialog-actions"><button type="button" data-default>既定値</button><span class="spacer"></span><button type="button" data-cancel>キャンセル</button><button type="submit" class="primary">表示設定を適用</button></div></form>`;
  const form = dialog.querySelector("form")!;
  const el = (key: string) => form.elements.namedItem(key) as HTMLInputElement;
  function fill(value: WorksheetPlot) {
    for (const [key, v] of Object.entries({
      mode: value.mode,
      dotSize: value.dotSize ?? 1.6,
      dotOpacity: value.dotOpacity ?? 0.6,
      color: value.color ?? "#146b8c",
      contourPercent: value.contourPercent ?? 10,
      bins: value.bins ?? 128,
      histogramNormalize: value.histogramNormalize ?? "count",
    }))
      el(key).value = String(v);
    el("smoothing").checked = value.smoothing !== false;
    el("showOutliers").checked = value.showOutliers !== false;
  }
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.querySelector<HTMLElement>("[data-close]")!.onclick = close;
  dialog.querySelector<HTMLElement>("[data-cancel]")!.onclick = close;
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  dialog.querySelector<HTMLElement>("[data-default]")!.onclick = () =>
    fill({
      ...c,
      dotSize: 1.6,
      dotOpacity: 0.6,
      color: "#146b8c",
      smoothing: true,
      showOutliers: true,
      contourPercent: 10,
      bins: 128,
      histogramNormalize: "count",
    });
  form.onsubmit = (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const value: PlotStyle & { mode: PlotMode } = {
      mode: el("mode").value as PlotMode,
      dotSize: +el("dotSize").value,
      dotOpacity: +el("dotOpacity").value,
      color: el("color").value,
      smoothing: el("smoothing").checked,
      showOutliers: el("showOutliers").checked,
      contourPercent: +el("contourPercent").value,
      bins: +el("bins").value,
      histogramNormalize: el("histogramNormalize")
        .value as PlotStyle["histogramNormalize"],
    };
    close();
    apply(value);
  };
  fill(c);
  document.body.append(dialog);
  dialog.showModal();
}
