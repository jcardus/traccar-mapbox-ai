import { createGeojsonMcpHandler } from "@/lib/geojson-mcp";

export const runtime = "nodejs";

const handler = createGeojsonMcpHandler();

async function serve(request: Request) {
  return handler.fetch(request);
}

export { serve as GET, serve as POST, serve as DELETE };
