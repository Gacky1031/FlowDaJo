import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
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
      response.ok
        ? job.resolve(response.data)
        : job.reject(new Error(response.error));
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
        pending.push({ resolve, reject });
        processR.stdin.write(JSON.stringify({ ...payload, storage }) + "\n");
      }),
    close: () => processR.kill(),
  };
}
