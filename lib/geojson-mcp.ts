import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { readTraccarResource } from "@/lib/mcp";
import { positionsToGeojson, type PositionTrace } from "@/lib/positions-to-geojson";
import { saveRecordedRoute } from "@/lib/recorded-routes";
import { trackMapPayload } from "@/lib/track-map";
import { positionsFromResource, traccarPositionsUri } from "@/lib/traccar-positions";

export function createGeojsonMcpServer() {
  const server = new McpServer(
    { name: "positions_to_geojson", version: "1.0.0" },
    {
      instructions:
        "positions_to_geojson reads a traccar:// positions link, or a short positions array, and draws the driven path. The result is a trace. Positions and GeoJSON stay off the result.",
    },
  );

  server.registerTool(
    "positions_to_geojson",
    {
      title: "Positions to GeoJSON",
      description:
        "Draw a recorded track on the live map. Pass uri, the traccar://positions or traccar://route link from traccar_getPositions (when from or to is set) or traccar_getReportsRoute. " +
        "You can instead pass a short positions array that is already in the conversation. Each object has latitude, longitude, fixTime, and speed in knots. " +
        "The result is only a trace: point count, distance, duration, max speed, start, and end. Speeds are converted from knots to km/h.",
      inputSchema: z.object({
        uri: z.string().min(1).optional().describe(
          "traccar://positions or traccar://route URI from traccar_getPositions or traccar_getReportsRoute.",
        ),
        positions: z.array(z.record(z.string(), z.unknown())).min(1).max(20000).optional().describe(
          "Short position list already in the conversation. Do not paste a ranged list; pass uri instead.",
        ),
      }),
    },
    async ({ uri, positions }) => {
      const rows = await resolvePositions(uri, positions);
      if (!rows.ok) return toolError(rows.message);
      const converted = positionsToGeojson(rows.positions);
      if (!converted.ok) return toolError(converted.message);
      const routeId = saveRecordedRoute(trackMapPayload(converted.geojson, converted.trace));
      return {
        content: [{ type: "text" as const, text: modelSummary(converted.trace) }],
        structuredContent: { routeId, trace: converted.trace },
      };
    },
  );

  return server;
}

async function resolvePositions(
  uri: string | undefined,
  positions: unknown[] | undefined,
): Promise<{ ok: true; positions: unknown[] } | { ok: false; message: string }> {
  if (typeof uri === "string" && uri.trim()) {
    const accepted = traccarPositionsUri(uri);
    if (!accepted) {
      return { ok: false, message: "Pass the traccar://positions or traccar://route URI from the tool result." };
    }
    try {
      const text = await readTraccarResource(accepted);
      const parsed = positionsFromResource(text);
      if (!parsed) return { ok: false, message: "Traccar positions were not a JSON array." };
      return { ok: true, positions: parsed };
    } catch (error) {
      return { ok: false, message: shortError(error) };
    }
  }
  if (Array.isArray(positions)) return { ok: true, positions };
  return { ok: false, message: "Pass a traccar:// URI or a positions array." };
}

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Could not read the positions.";
  const line = message.split("\n")[0] ?? message;
  if (line.includes("[{") || line.length > 300) return "Could not read the positions.";
  return line;
}

function toolError(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
    structuredContent: { message },
  };
}

function modelSummary(trace: PositionTrace): string {
  return `${trace.points} fixes, ${trace.distanceKm} km, ${trace.durationMinutes} min, max ${trace.maxSpeedKmh} km/h, from ${trace.from} to ${trace.to}.`;
}

export function createGeojsonMcpHandler() {
  return createMcpHandler(() => createGeojsonMcpServer());
}
