import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { routesToGeojson } from "@/lib/traccar-geojson";

const routeInput = z.object({
  deviceId: z.number().int().optional().describe("Traccar device id. Required when positions are omitted."),
  from: z.string().optional().describe("Trip startTime, ISO-8601, copied from the trip report."),
  to: z.string().optional().describe("Trip endTime, ISO-8601, copied from the trip report."),
  label: z.string().optional().describe("Device name and trip start, stored on each feature."),
  positions: z.array(z.record(z.string(), z.unknown())).optional().describe(
    "Traccar position objects to convert. When omitted, the route report is loaded for deviceId, from, and to.",
  ),
});

export function createGeojsonMcpServer() {
  const server = new McpServer(
    { name: "traccar-geojson", version: "1.0.0" },
    {
      instructions:
        "routes_to_geojson loads a Traccar route report, or accepts position objects, and returns a GeoJSON FeatureCollection of the driven path. " +
        "Trip reports are only endpoints. Pass one routes entry per trip with deviceId, from, and to. " +
        "The result also includes layers, markers, and legend for Mapbox render_map_tool. Pass those through unchanged.",
    },
  );

  server.registerTool(
    "routes_to_geojson",
    {
      title: "Traccar routes to GeoJSON",
      description:
        "Convert Traccar route reports into GeoJSON of the driven path. " +
        "Pass every trip in one call. Each entry is deviceId plus from and to (the trip startTime and endTime), or a positions array of Traccar fixes. " +
        "Returns a FeatureCollection plus layers, markers, and legend. " +
        "Speeds are converted from knots to km/h. The track is split where the fix gap exceeds 10 minutes.",
      inputSchema: z.object({
        summary: z.string().describe("Short title, such as \"11 trips · 12067\"."),
        routes: z.array(routeInput).min(1).max(40).describe("One window or position list per trip."),
      }),
    },
    async ({ summary, routes }) => {
      const converted = await routesToGeojson({ summary, routes });
      if (!converted.ok) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: converted.message }],
        };
      }
      const output = {
        summary: converted.summary,
        geojson: converted.geojson,
        layers: converted.layers,
        markers: converted.markers,
        legend: converted.legend,
        trace: converted.trace,
      };
      return {
        content: [
          {
            type: "text" as const,
            text: `${converted.summary}. ${converted.trace.totalPoints} fixes across ${converted.trace.drawnRoutes} routes. Pass layers, markers, legend, and summary to render_map_tool unchanged.`,
          },
          { type: "text" as const, text: JSON.stringify(output) },
        ],
        structuredContent: output,
      };
    },
  );

  return server;
}

export function createGeojsonMcpHandler() {
  return createMcpHandler(() => createGeojsonMcpServer());
}
