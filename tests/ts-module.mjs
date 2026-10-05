import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import ts from "typescript";
const urls = new Map();
export function tsModuleUrl(file) {
  file = resolve(file);
  if (urls.has(file)) return urls.get(file);
  let output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  output = output.replace(/from (["'])(\.\.?\/[^"']+)\1/g, (_, quote, relative) => `from ${JSON.stringify(tsModuleUrl(resolve(dirname(file), relative + ".ts")))}`);
  const url = "data:text/javascript;base64," + Buffer.from(output).toString("base64");
  urls.set(file, url); return url;
}
