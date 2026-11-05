const FONT = "Segoe UI, Arial, sans-serif";

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("ゲート表示を画像に変換できませんでした"));
    image.src = url;
  });
}

// Composes the on-screen plot (canvas, gate overlay and axis names) into one PNG.
export async function plotStageBlob(stage: HTMLElement): Promise<Blob> {
  const source = stage.querySelector("canvas");
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  if (!source || w <= 0 || h <= 0) throw new Error("コピーできるプロットがありません");
  const ratio = source.width / w || 1;
  const out = document.createElement("canvas");
  out.width = Math.round(w * ratio);
  out.height = Math.round(h * ratio);
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("画像を作成できません");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, 0, 0, out.width, out.height);

  const svg = stage.querySelector("svg");
  if (svg) {
    const copy = svg.cloneNode(true) as SVGSVGElement;
    copy.querySelectorAll("[data-handle]").forEach((item) => item.remove());
    copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    copy.setAttribute("width", String(w));
    copy.setAttribute("height", String(h));
    copy.setAttribute("font-family", FONT);
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
    ctx.drawImage(await loadImage(url), 0, 0, out.width, out.height);
  }

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = "#1f2a30";
  ctx.font = `600 11px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const box = stage.getBoundingClientRect();
  for (const label of stage.querySelectorAll<HTMLElement>(".axis-label")) {
    if (getComputedStyle(label).display === "none") continue;
    const text = (label.firstChild?.textContent ?? label.textContent ?? "").trim();
    if (!text) continue;
    const rect = label.getBoundingClientRect();
    const x = rect.left - box.left + rect.width / 2;
    const y = rect.top - box.top + rect.height / 2;
    if (label.classList.contains("axis-y")) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    } else ctx.fillText(text, x, y);
  }

  return new Promise((resolve, reject) =>
    out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNGを作成できません"))), "image/png"),
  );
}

export async function copyPlotToClipboard(stage: HTMLElement) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
    throw new Error("この環境では画像のクリップボードコピーに対応していません");
  const blob = await plotStageBlob(stage);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}
