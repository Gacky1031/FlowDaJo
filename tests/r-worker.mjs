import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { copyFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
export function rWorker(storage) {
  const processR = spawn(
    resolve("src-tauri/runtime/R/bin/Rscript.exe"),
    ["--vanilla", resolve("r/worker.R"), "--persistent"],
    {
      windowsHide: true,
      env: {
        ...process.env,
        LANG: "C",
        LC_ALL: "C",
        R_HOME: resolve("src-tauri/runtime/R"),
        R_LIBS_USER: resolve("src-tauri/runtime/R/library"),
        R_LIBS_SITE: resolve("src-tauri/runtime/R/library"),
      },
    },
  );
  const pending = [];
  let stderr = "";
  processR.stderr.on(
    "data",
    (chunk) => (stderr = (stderr + chunk).slice(-8000)),
  );
  createInterface({ input: processR.stdout }).on("line", (line) => {
    const job = pending.shift();
    if (!job) return;
    try {
      const response = JSON.parse(line);
      if (!response.ok) {
        job.reject(new Error(response.error));
        return;
      }
      const data = response.data;
      if (["worksheet_pdf", "worksheet_report_pdf"].includes(job.payload?.action) && data.pageFiles?.length) {
        try {
          const files = data.pageFiles;
          if (files.length === 1) copyFileSync(files[0], job.payload.path);
          else execFileSync("pdfunite", [...files, job.payload.path]);
          for (const file of files) unlinkSync(file);
          delete data.pageFiles;
        } catch (error) {
          job.reject(error);
          return;
        }
      }
      job.resolve(data);
    } catch (e) {
      job.reject(e);
    }
  });
  processR.on("error", (e) =>
    pending.splice(0).forEach((job) => job.reject(e)),
  );
  processR.on("exit", () =>
    pending
      .splice(0)
      .forEach((job) => job.reject(new Error("R exited: " + stderr))),
  );
  return {
    call: (payload) =>
      new Promise((resolve, reject) => {
        pending.push({ resolve, reject, payload });
        processR.stdin.write(JSON.stringify({ ...payload, storage }) + "\n");
      }),
    close: () => processR.kill(),
  };
}
