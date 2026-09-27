// Development-only bridge for interaction tests. Never imported by production.
import { createServer } from "vite";
import { copyFileSync, mkdtempSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { rWorker } from "../tests/r-worker.mjs";
const storage = mkdtempSync(join(tmpdir(), "flowdesk-browser-"));
const worker = rWorker(storage);
const server = await createServer({
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
  plugins: [
    {
      name: "flowdesk-test-bridge",
      transformIndexHtml(html) {
        return html.replace(
          "<head>",
          `<head><script>window.isTauri=true;window.__FLOWDESK_TEST_BRIDGE__=true;window.__TAURI_INTERNALS__={transformCallback:()=>1,metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},invoke:async(cmd,args)=>{if(cmd==='request'){const r=await fetch('/__test_rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args.payload)});const v=await r.json();if(!v.ok)throw Error(v.error);return v.data;}if(cmd==='plugin:dialog|save')return args.options.defaultPath.endsWith('.csv')?${JSON.stringify(resolve("artifacts/ui-statistics.csv"))}:args.options.defaultPath.endsWith('.svg')?${JSON.stringify(resolve("artifacts/ui-plot.svg"))}:args.options.defaultPath.endsWith('.pdf')?${JSON.stringify(resolve("artifacts/ui-worksheet.pdf"))}:args.options.defaultPath.endsWith('.flowdesk-worksheet.json')?${JSON.stringify(resolve("artifacts/ui-template.json"))}:${JSON.stringify(resolve("artifacts/ui-workspace.json"))};if(cmd==='plugin:dialog|open')return args.options?.filters?.[0]?.name==='Worksheet template'?${JSON.stringify(resolve("artifacts/ui-template.json"))}:${JSON.stringify(resolve("artifacts/ui-workspace.json"))};if(cmd==='plugin:dialog|message')return args.buttons==='OkCancel' && window.__FLOWDESK_TEST_CONFIRM__ === false ? 'Cancel' : 'Ok';if(cmd==='plugin:dialog|confirm')return window.__FLOWDESK_TEST_CONFIRM__ ?? true;return 1;}};</script>`,
        );
      },
      configureServer(server) {
        server.middlewares.use("/__test_rpc", (req, res) => {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end();
            return;
          }
          if (
            req.headers.origin &&
            !["http://127.0.0.1:1420", "http://localhost:1420"].includes(
              req.headers.origin,
            )
          ) {
            res.statusCode = 403;
            res.end();
            return;
          }
          let body = "";
          req.on("data", (chunk) => {
            body += chunk;
            if (body.length > 5e6) req.destroy();
          });
          req.on("end", async () => {
            res.setHeader("Content-Type", "application/json");
            try {
              const payload = JSON.parse(body);
              const data = await worker.call(payload);
              if (["worksheet_pdf", "worksheet_report_pdf"].includes(payload.action) && data.pageFiles?.length) {
                try {
                  if (data.pageFiles.length === 1) copyFileSync(data.pageFiles[0], payload.path);
                  else execFileSync("pdfunite", [...data.pageFiles, payload.path]);
                } finally {
                  for (const file of data.pageFiles) unlinkSync(file);
                }
                delete data.pageFiles;
              }
              res.end(JSON.stringify({ ok: true, data }));
            } catch (e) {
              res.end(JSON.stringify({ ok: false, error: String(e) }));
            }
          });
        });
      },
    },
  ],
});
await server.listen();
console.log("FlowDaJo test bridge http://127.0.0.1:1420");
process.on("SIGINT", () => {
  worker.close();
  server.close();
  process.exit();
});
process.on("exit", () => worker.close());
