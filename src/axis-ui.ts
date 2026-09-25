import type { Axis, Sample, WorksheetPlot } from "./types";
import { axis, oneDimensional, scaleLabel } from "./model";

export type AxisSide = "x" | "y";
export type AxisScope = "plot" | "sheet";
export type AxisPreview = { range: [number, number]; counts: number[]; ticks: { value: number; label: string }[]; total: number; outside: number };
const esc = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
let closeCurrent: (() => void) | undefined;
export const closeAxisUI = () => closeCurrent?.();

export function axisLabels(plot: WorksheetPlot, channels: Sample["channels"]) {
  return (["x", "y"] as const)
    .map((side) => {
      if (side === "y" && oneDimensional(plot))
        return `<span class="axis-label axis-y counts-label" title="分布の縦軸">${plot.mode === "cdf" ? "Cumulative %" : plot.histogramNormalize === "percent" ? "% of events" : plot.histogramNormalize === "mode" ? "% of maximum" : "Count"}</span>`;
      const a = plot[side],
        label = channels.find((c) => c.id === a.channel)?.label || a.channel;
      const text = [...new Set([...label.split(" · "), a.channel])].join(" · ");
      return `<button class="axis-label axis-${side}" data-axis-label="${side}" data-for="${plot.id}" aria-label="${side.toUpperCase()}軸: ${esc(text)}" aria-haspopup="dialog" title="${esc(text)}\nクリック: チャンネル選択 / 右クリック: スケール詳細">${esc(text)} <span>▾</span></button><button class="axis-transform transform-${side}" data-axis-details="${side}" data-for="${plot.id}" aria-label="${side.toUpperCase()}軸のスケール詳細" title="${scaleLabel(a.scale)} · スケール / 範囲を調整">T</button>`;
    })
    .join("");
}

function dialogShell(className: string, label: string, anchor: HTMLElement) {
  closeAxisUI();
  const dialog = document.createElement("dialog");
  dialog.className = className;
  dialog.setAttribute("aria-label", label);
  document.body.append(dialog);
  const selector = `[data-axis-label="${anchor.dataset.axisLabel ?? anchor.dataset.axisDetails ?? "x"}"][data-for="${anchor.dataset.for}"]`;
  const close = () => {
    dialog.close();
    dialog.remove();
    if (closeCurrent === close) closeCurrent = undefined;
    if (anchor.isConnected) anchor.focus({ preventScroll: true });
    else
      document
        .querySelector<HTMLElement>(selector)
        ?.focus({ preventScroll: true });
  };
  closeCurrent = close;
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  // A backdrop click closes the chooser, but never discards an unfinished scale form.
  if (className === "parameter-picker")
    dialog.addEventListener("click", (e) => {
      const b = dialog.getBoundingClientRect();
      if (
        e.target === dialog &&
        (e.clientX < b.left ||
          e.clientX > b.right ||
          e.clientY < b.top ||
          e.clientY > b.bottom)
      )
        close();
    });
  return { dialog, close };
}

export function chooseParameter(
  anchor: HTMLElement,
  side: AxisSide,
  plot: WorksheetPlot,
  channels: Sample["channels"],
  select: (id: string) => void,
  details: () => void,
) {
  const { dialog, close } = dialogShell(
    "parameter-picker",
    `${side.toUpperCase()}軸のチャンネル選択`,
    anchor,
  );
  dialog.innerHTML = `<div class="axis-dialog-heading"><strong>${side.toUpperCase()}軸 · チャンネル</strong><button type="button" data-close aria-label="閉じる">×</button></div><input type="search" aria-label="チャンネルを検索" placeholder="蛍光・マーカー名で検索" autocomplete="off"><div class="parameter-list" role="listbox" aria-label="チャンネル"></div><div class="parameter-footer"><button type="button" data-detail>スケール / 範囲の詳細…</button><small>↑ ↓ で選択 · Enter で決定</small></div>`;
  const search = dialog.querySelector<HTMLInputElement>("input")!;
  const list = dialog.querySelector<HTMLElement>(".parameter-list")!;
  let visible = channels,
    index = Math.max(
      0,
      channels.findIndex((c) => c.id === plot[side].channel),
    );
  function mark() {
    list
      .querySelectorAll<HTMLElement>("[role=option]")
      .forEach((el, i) => el.classList.toggle("highlight", i === index));
    search.setAttribute("aria-activedescendant", `parameter-${index}`);
    list
      .querySelector<HTMLElement>(".highlight")
      ?.scrollIntoView({ block: "nearest" });
  }
  const commit = (id: string) => {
    close();
    select(id);
  };
  function draw() {
    list.innerHTML = visible.length
      ? visible
          .map(
            (c, i) =>
              `<button type="button" role="option" id="parameter-${i}" aria-selected="${c.id === plot[side].channel}"><span class="parameter-check">${c.id === plot[side].channel ? "✓" : ""}</span><span><strong>${esc(c.label || c.id)}</strong>${c.label && c.label !== c.id ? `<small>${esc(c.id)}</small>` : ""}</span></button>`,
          )
          .join("")
      : '<p class="no-parameters">一致するチャンネルがありません</p>';
    list
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((el, i) => (el.onclick = () => commit(visible[i].id)));
    mark();
  }
  search.setAttribute("role", "combobox");
  search.setAttribute("aria-expanded", "true");
  list.id = "axis-parameter-list";
  search.setAttribute("aria-controls", list.id);
  search.oninput = () => {
    const q = search.value.trim().toLocaleLowerCase();
    visible = channels.filter((c) =>
      `${c.id} ${c.label}`.toLocaleLowerCase().includes(q),
    );
    index = 0;
    draw();
  };
  dialog.addEventListener("keydown", (e) => {
    if (["ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      index = visible.length
        ? (index + (e.key === "ArrowDown" ? 1 : -1) + visible.length) %
          visible.length
        : 0;
      search.focus();
      mark();
    }
    if (e.key === "Enter" && e.target === search) {
      e.preventDefault();
      if (visible[index]) commit(visible[index].id);
    }
  });
  dialog.querySelector<HTMLElement>("[data-close]")!.onclick = close;
  dialog.querySelector<HTMLElement>("[data-detail]")!.onclick = () => {
    close();
    details();
  };
  draw();
  dialog.showModal();
  const b = anchor.getBoundingClientRect(),
    width = Math.min(330, innerWidth - 24);
  dialog.style.width = `${width}px`;
  dialog.style.left = `${Math.max(12, Math.min(innerWidth - width - 12, b.left))}px`;
  dialog.style.top = `${Math.max(12, Math.min(innerHeight - dialog.offsetHeight - 12, b.bottom + 6))}px`;
  search.focus();
  mark();
}

export function axisValidation(a: Axis): string | undefined {
  if (![a.w, a.t, a.m, a.a].every(Number.isFinite))
    return "変換パラメータには有限の数値を入力してください。";
  if (
    a.scale === "logicle" &&
    (a.t <= 0 ||
      a.m <= 0 ||
      a.w < 0 ||
      2 * a.w > a.m ||
      a.a < -a.w ||
      a.a > a.m - 2 * a.w)
  )
    return "Logicle: T > 0、M > 0、0 ≤ 2W ≤ M、−W ≤ A ≤ M−2W にしてください。";
  if (
    (a.min !== undefined || a.max !== undefined) &&
    (!Number.isFinite(a.min) || !Number.isFinite(a.max) || a.min! >= a.max!)
  )
    return "最小値と最大値の両方を入力し、最小値 < 最大値にしてください。";
}

export function editAxis(
  anchor: HTMLElement,
  side: AxisSide,
  plot: WorksheetPlot,
  matches: number,
  apply: (a: Axis, scope: AxisScope) => void,
  preview?: (a: Axis) => Promise<AxisPreview>,
) {
  const { dialog, close } = dialogShell(
    "axis-dialog",
    `${side.toUpperCase()}軸のスケール詳細`,
    anchor,
  );
  const current = plot[side];
  dialog.innerHTML = `<form novalidate><div class="axis-dialog-heading"><div><h2>${side.toUpperCase()}軸のスケール詳細</h2><p>${esc(current.channel)}</p></div><button type="button" data-close aria-label="閉じる">×</button></div><label>表示スケール<select name="scale" aria-label="表示スケール"><option value="linear">Linear（線形）</option><option value="log">Log（常用対数・正値のみ）</option><option value="logicle">Biexponential / Logicle（負値・ゼロを含む蛍光）</option></select></label><fieldset class="range-fields"><legend>表示範囲</legend><label class="check"><input type="checkbox" name="auto">データに合わせて自動調整</label><div class="two"><label>最小値<input name="min" type="number" step="any"></label><label>最大値<input name="max" type="number" step="any"></label></div><p class="hint" data-units></p></fieldset><fieldset class="transform-fields"><legend>Logicle 変換</legend><div class="two"><label>W · ゼロ付近の線形幅<input name="w" type="number" step="0.1"></label><label>T · 上限の基準値<input name="t" type="number" step="any"></label><label>M · 正側の decades<input name="m" type="number" step="0.1"></label><label>A · 負側の追加 decades<input name="a" type="number" step="0.1"></label></div></fieldset><fieldset class="axis-preview"><legend>変更後の分布プレビュー</legend><div data-axis-preview class="axis-preview-body">ヒストグラムを読み込んでいます…</div></fieldset><label>適用先<select name="scope"><option value="plot">このプロットの ${side.toUpperCase()} 軸のみ</option><option value="sheet">このワークシートの同じチャンネル（${matches} 軸）</option></select></label><p class="hint">変換を変更しても既存ゲートの判定条件は保持します。異なる変換のゲートは、この表示では編集できません。</p><p class="axis-validation" role="alert"></p><div class="axis-dialog-actions"><button type="button" data-default>既定値に戻す</button><span class="spacer"></span><button type="button" data-cancel>キャンセル</button><button type="submit" class="primary">適用して閉じる</button></div></form>`;
  const form = dialog.querySelector("form")!;
  const input = (key: string) =>
    form.elements.namedItem(key) as HTMLInputElement;
  const error = dialog.querySelector<HTMLElement>("[role=alert]")!;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let previewSequence = 0;
  const previewBody = dialog.querySelector<HTMLElement>("[data-axis-preview]")!;
  function candidate(): Axis {
    const a: Axis = { ...current, scale: input("scale").value as Axis["scale"] };
    for (const k of ["w", "t", "m", "a"] as const) a[k] = input(k).value.trim() ? Number(input(k).value) : NaN;
    delete a.min; delete a.max;
    a.autoRange = input("auto").checked;
    if (!a.autoRange) {
      a.min = input("min").value.trim() ? Number(input("min").value) : NaN;
      a.max = input("max").value.trim() ? Number(input("max").value) : NaN;
    }
    return a;
  }
  function schedulePreview() {
    if (!preview) return;
    if (previewTimer) clearTimeout(previewTimer);
    const sequence = ++previewSequence;
    const a = candidate();
    const issue = axisValidation(a);
    if (issue) { previewBody.textContent = issue; return; }
    previewBody.textContent = "分布を計算中…";
    previewTimer = setTimeout(async () => {
      try {
        const result = await preview(a);
        if (sequence !== previewSequence || !dialog.open) return;
        const counts = result.counts ?? [];
        const max = Math.max(1, ...counts);
        const bars = counts.map((count, i) => `<rect x="${18 + i * 6}" y="${110 - count / max * 88}" width="5.6" height="${count / max * 88}" fill="#3b81a9"/>`).join("");
        const labels = (result.ticks ?? []).filter((tick) => !!tick.label).filter((_, i) => i % Math.max(1, Math.ceil(result.ticks.filter((t) => !!t.label).length / 6)) === 0).map((tick) => {
          const x = 18 + (tick.value - result.range[0]) / Math.max(1e-12, result.range[1] - result.range[0]) * 384;
          return `<text x="${x}" y="126" text-anchor="middle" font-size="10" fill="#455d70">${esc(tick.label)}</text>`;
        }).join("");
        previewBody.innerHTML = `<svg viewBox="0 0 420 138" role="img" aria-label="変更後の${esc(a.channel)}ヒストグラム"><path d="M18 20V110H402" fill="none" stroke="#667b8b"/>${bars}${labels}</svg><small>${(result.total - result.outside).toLocaleString()} / ${result.total.toLocaleString()} events · 範囲外 ${result.outside.toLocaleString()}</small>`;
      } catch (error) {
        if (sequence === previewSequence && dialog.open) previewBody.textContent = `プレビューを表示できません: ${String(error)}`;
      }
    }, 180);
  }
  form.addEventListener("input", (event) => { if ((event.target as HTMLInputElement).name !== "scope") schedulePreview(); });
  form.addEventListener("change", (event) => { if ((event.target as HTMLInputElement).name !== "scope") schedulePreview(); });
  function update() {
    const linear = input("scale").value === "linear";
    (
      dialog.querySelector(".transform-fields") as HTMLFieldSetElement
    ).disabled = input("scale").value !== "logicle";
    input("min").disabled = input("max").disabled = input("auto").checked;
    dialog.querySelector<HTMLElement>("[data-units]")!.textContent = linear
      ? "単位: 測定値（補正 ON 時は補正後の値）。"
      : input("scale").value === "log"
        ? "範囲は log10 座標（例: 1〜5 は蛍光値10〜100,000）。0以下は表示から除外し、全イベント統計には保持します。"
        : "範囲は Logicle 変換後の座標です。グラフの目盛は蛍光値で表示します。";
    error.textContent = "";
  }
  function fill(a: Axis) {
    for (const k of ["scale", "w", "t", "m", "a", "min", "max"] as const)
      input(k).value = String(a[k] ?? "");
    input("auto").checked = a.autoRange === true || (a.min === undefined && a.max === undefined);
    update();
    schedulePreview();
  }
  input("scale").onchange = update;
  input("auto").onchange = update;
  dialog.querySelector<HTMLElement>("[data-close]")!.onclick = close;
  dialog.querySelector<HTMLElement>("[data-cancel]")!.onclick = close;
  dialog.querySelector<HTMLElement>("[data-default]")!.onclick = () =>
    fill(axis(current.channel));
  form.onsubmit = (e) => {
    e.preventDefault();
    const a: Axis = {
      ...current,
      scale: input("scale").value as Axis["scale"],
    };
    for (const k of ["w", "t", "m", "a"] as const)
      a[k] = input(k).value.trim() ? Number(input(k).value) : NaN;
    delete a.min;
    delete a.max;
    a.autoRange = input("auto").checked;
    if (!input("auto").checked) {
      a.min = input("min").value.trim() ? Number(input("min").value) : NaN;
      a.max = input("max").value.trim() ? Number(input("max").value) : NaN;
    }
    const issue = axisValidation(a);
    if (issue) {
      error.textContent = issue;
      return;
    }
    const scope = input("scope").value as AxisScope;
    close();
    apply(a, scope);
  };
  fill(current);
  dialog.showModal();
  schedulePreview();
  input("scale").focus();
}
