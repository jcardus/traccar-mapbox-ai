// @ts-nocheck
import { splitMCPAppTools } from "@ai-sdk/mcp";
import { openai } from "@ai-sdk/openai";
import { convertToModelMessages, stepCountIs, streamText } from "ai";
import { createMcpClients } from "@/lib/mcp";

export const runtime = "nodejs";

function stripPropertyNames(schema: any): any {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(stripPropertyNames);
  const { propertyNames: _removed, ...rest } = schema;
  return Object.fromEntries(
    Object.entries(rest).map(([k, v]) => [k, stripPropertyNames(v)]),
  );
}

export async function POST(req: Request) {
  const { messages } = await req.json();
  const clients = await createMcpClients();
  const entries = await Promise.all(
    Object.entries(clients).map(async ([serverId, client]) => {
      if (!client) return [];
      const definitions = await client.listTools();
      const split = splitMCPAppTools(definitions);
      const cleaned = {
        ...split.modelVisible,
        tools: split.modelVisible.tools.map((t) => ({
          ...t,
          inputSchema: stripPropertyNames(t.inputSchema),
        })),
      };
      const tools = client.toolsFromDefinitions(cleaned);
      return Object.entries(tools).map(([name, tool]) => [
        serverId === "mapbox" ? name : `${serverId}_${name}`,
        tool,
      ] as const);
    }),
  );
  const modelVisible = Object.fromEntries(entries.flat());

  const result = streamText({
    model: openai("gpt-6-luna"),
    system:
      "You are a Traccar fleet and Mapbox geospatial assistant. Use Traccar tools for fleet data (devices, positions, routes, geofences, events) and Mapbox tools for geocoding, directions, or isochrones. The UI has a single persistent Mapbox map on the side that updates in place whenever you call render_map_tool. When the user asks to update, restyle, or add to the current map, re-pass the existing payload_refs, markers, or layers alongside your updates in render_map_tool so the map modifies in place without losing previous context unless the user asks for something completely new.",
    messages: await convertToModelMessages(messages),
    tools: modelVisible,
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
}
