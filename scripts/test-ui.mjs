// Development-only bridge for interaction tests. Never imported by production.
import { createServer } from "vite";
import { mkdtempSync } from "node:fs";
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
          `<head><script>window.isTauri=true;window.__TAURI_INTERNALS__={transformCallback:()=>1,metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},invoke:async(cmd,args)=>{if(cmd==='request'){const r=await fetch('/__test_rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args.payload)});const v=await r.json();if(!v.ok)throw Error(v.error);return v.data;}if(cmd==='plugin:dialog|save')return args.options.defaultPath.endsWith('.csv')?${JSON.stringify(resolve("artifacts/ui-statistics.csv"))}:args.options.defaultPath.endsWith('.svg')?${JSON.stringify(resolve("artifacts/ui-plot.svg"))}:args.options.defaultPath.endsWith('.pdf')?${JSON.stringify(resolve("artifacts/ui-worksheet.pdf"))}:args.options.defaultPath.endsWith('.flowdesk-worksheet.json')?${JSON.stringify(resolve("artifacts/ui-template.json"))}:${JSON.stringify(resolve("artifacts/ui-workspace.json"))};if(cmd==='plugin:dialog|open')return ${JSON.stringify(resolve("artifacts/ui-workspace.json"))};if(cmd==='plugin:dialog|message')return 'Ok';if(cmd==='plugin:dialog|confirm')return true;return 1;}};</script>`,
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
              res.end(
                JSON.stringify({ ok: true, data: await worker.call(payload) }),
              );
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
console.log("FlowDesk test bridge http://127.0.0.1:1420");
process.on("SIGINT", () => {
  worker.close();
  server.close();
  process.exit();
});
process.on("exit", () => worker.close());
