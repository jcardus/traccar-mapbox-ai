// Mapbox GL creates its parser worker from a blob: URL. assistant-ui's MCP
// app CSP leaves worker-src unset, so the browser falls back to script-src
// and blocks the worker. This adds worker-src blob: after npm install.
import { readFileSync, writeFileSync } from "node:fs";

const file = "node_modules/@assistant-ui/react/dist/mcp-apps/csp.js";
const source = readFileSync(file, "utf8");
if (source.includes('directive("worker-src"')) {
  process.exit(0);
}

const needle = `"form-action 'none'"`;
if (!source.includes(needle)) {
  throw new Error(`${file} changed shape. The Mapbox worker CSP patch needs an update.`);
}

writeFileSync(
  file,
  source.replace(
    needle,
    `${needle},\n\t\tdirective("worker-src", ["blob:"])`,
  ),
);
