import { routesToGeojson, type RouteTrace, type RouteWindowInput } from "@/lib/traccar-geojson";

export type { RouteTrace };

export type RecordedRouteInput = {
  summary?: string;
  routes?: RouteWindowInput[];
};

type ToolCaller = {
  callTool(args: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<unknown>;
};

export function recordedRouteToolError(message: string, trace?: Partial<RouteTrace>) {
  const full: RouteTrace = {
    summary: "",
    drawnRoutes: 0,
    totalPoints: 0,
    routes: [],
    skipped: [],
    message,
    ...trace,
  };
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
    trace: full,
  };
}

export async function renderRecordedRoutes(
  clients: { mapbox: ToolCaller | null },
  input: RecordedRouteInput,
) {
  if (!clients.mapbox) {
    return recordedRouteToolError("Mapbox is required to draw a recorded route.");
  }

  const converted = await routesToGeojson(input);
  if (!converted.ok) return recordedRouteToolError(converted.message, converted.trace);

  let mapResult: any;
  try {
    mapResult = await clients.mapbox.callTool({
      name: "render_map_tool",
      arguments: {
        summary: converted.summary,
        layers: converted.layers,
        markers: converted.markers,
        legend: converted.legend,
      },
    });
  } catch (error) {
    return recordedRouteToolError(
      error instanceof Error ? error.message : "Map render failed.",
      converted.trace,
    );
  }

  if (mapResult?.isError) {
    const text = textContent(mapResult);
    return recordedRouteToolError(text || "Map render failed.", converted.trace);
  }

  // Keep the geometry on the tool result. A large render stores it behind a
  // session-scoped ref, which the map pane cannot read from its own connection.
  const returned = mapResult?.structuredContent?.mapboxRender ?? {};
  return {
    content: [{
      type: "text",
      text: `Rendered ${converted.trace.drawnRoutes} recorded ${converted.trace.drawnRoutes === 1 ? "route" : "routes"} (${converted.trace.totalPoints} fixes).`,
    }],
    structuredContent: {
      ...(mapResult?.structuredContent ?? {}),
      rendered: true,
      layer_count: converted.layers.length,
      marker_count: converted.markers.length,
      summary: converted.summary,
      mapboxRender: {
        ...returned,
        summary: converted.summary,
        layers: converted.layers,
        markers: converted.markers,
        legend: converted.legend,
      },
    },
    isError: false,
    trace: converted.trace,
  };
}

function textContent(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> } | null)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}
