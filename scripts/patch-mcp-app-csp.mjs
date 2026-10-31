// assistant-ui's MCP app CSP blocks two things Mapbox GL needs in the map
// iframe. The parser worker is a blob: URL, and worker-src is unset, so the
// browser falls back to script-src and blocks it. Vector tiles are parsed by
// WebAssembly, and script-src has neither 'wasm-unsafe-eval' nor 'unsafe-eval'.
// This adds both after npm install.
import { readFileSync, writeFileSync } from "node:fs";

const file = "node_modules/@assistant-ui/react/dist/mcp-apps/csp.js";
let source = readFileSync(file, "utf8");
let changed = false;

if (!source.includes('directive("worker-src"')) {
  const needle = `"form-action 'none'"`;
  if (!source.includes(needle)) {
    throw new Error(`${file} changed shape. The Mapbox worker CSP patch needs an update.`);
  }
  source = source.replace(
    needle,
    `${needle},\n\t\tdirective("worker-src", ["blob:"])`,
  );
  changed = true;
}

if (!source.includes("'wasm-unsafe-eval'")) {
  const scriptSrc = /directive\("script-src", \[\s*"'self'",\s*"'unsafe-inline'",/;
  if (!scriptSrc.test(source)) {
    throw new Error(`${file} changed shape. The Mapbox WebAssembly CSP patch needs an update.`);
  }
  source = source.replace(
    scriptSrc,
    (match) => match.replace(`"'unsafe-inline'",`, `"'unsafe-inline'",\n\t\t\t"'wasm-unsafe-eval'",`),
  );
  changed = true;
}

if (changed) writeFileSync(file, source);
