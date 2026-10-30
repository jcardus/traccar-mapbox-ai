import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { positionsToGeojson, type PositionsGeojsonSuccess } from "@/lib/positions-to-geojson";

export function createGeojsonMcpServer() {
  const server = new McpServer(
    { name: "positions_to_geojson", version: "1.0.0" },
    {
      instructions:
        "positions_to_geojson turns a positions array into a GeoJSON FeatureCollection of the driven path."
    },
  );

  server.registerTool(
    "positions_to_geojson",
    {
      title: "Positions to GeoJSON",
      description:
        "Translate a positions array into a GeoJSON FeatureCollection of the driven path. " +
        "Pass the positions array. Each object has latitude, longitude, fixTime, and speed in knots. " +
        "Speeds are converted from knots to km/h. ",
      inputSchema: z.object({
        positions: z.array(z.record(z.string(), z.unknown())).min(1).max(20000).describe(
          "Position objects to translate, in the order they were recorded.",
        ),
      }),
    },
    async ({ positions }) => {
      const converted = positionsToGeojson(positions);
      if (!converted.ok) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: converted.message }],
          structuredContent: {
            message: converted.message,
            trace: converted.trace,
          },
        };
      }
      const output = {
        geojson: converted.geojson,
        trace: converted.trace,
      };
      return {
        content: [
          { type: "text" as const, text: modelSummary(converted) },
          { type: "text" as const, text: JSON.stringify(output) },
        ],
        structuredContent: output,
      };
    },
  );

  return server;
}

function modelSummary(converted: PositionsGeojsonSuccess): string {
  const trace = converted.trace;
  return `Translated ${trace.points} fixes into GeoJSON (${trace.distanceKm} km, ${trace.durationMinutes} min).`;
}

export function createGeojsonMcpHandler() {
  return createMcpHandler(() => createGeojsonMcpServer());
}
