// @ts-nocheck
import { splitMCPAppTools } from "@ai-sdk/mcp";
import { openai } from "@ai-sdk/openai";
import { convertToModelMessages, dynamicTool, jsonSchema, stepCountIs, streamText } from "ai";
import { fleetInstructions } from "@/lib/instructions";
import { createMcpClients } from "@/lib/mcp";
import { recordedRouteToolError, renderRecordedRoutes } from "@/lib/recorded-route";

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
  modelVisible.map_recorded_routes = dynamicTool({
    description:
      "Draw the full recorded GPS track for one or more Traccar trips on the live map. " +
      "Loads every stored fix between from and to and renders the path. " +
      "Use this for any historical route, trip, or GPS trace. " +
      "Pass every requested trip in one call. Do not pass coordinates. " +
      "from and to are the trip startTime and endTime, copied exactly.",
    inputSchema: jsonSchema({
      type: "object",
      additionalProperties: false,
      properties: {
        summary: {
          type: "string",
          description: "Short map title, such as \"11 trips · 12067\".",
        },
        routes: {
          type: "array",
          description: "One window per trip. All windows are drawn on the same map.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              deviceId: { type: "integer", description: "Traccar device id." },
              from: { type: "string", description: "Trip startTime, ISO-8601, copied from the trip report." },
              to: { type: "string", description: "Trip endTime, ISO-8601, copied from the trip report." },
              label: { type: "string", description: "Device name and trip start, shown on the start and end markers." },
            },
            required: ["deviceId", "from", "to", "label"],
          },
        },
      },
      required: ["summary", "routes"],
    }),
    execute: async (input: any) => {
      try {
        return await renderRecordedRoutes(
          { mapbox: clients.mapbox ?? null },
          input ?? {},
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not draw the recorded route.";
        return recordedRouteToolError(message);
      }
    },
    toModelOutput: ({ output }: { output: any }) => ({
      type: "json" as const,
      value: output?.trace ?? { message: "Recorded route map finished." },
    }),
  });

  const result = streamText({
    model: openai("gpt-6-luna"),
    system: fleetInstructions(),
    messages: await convertToModelMessages(messages, { tools: modelVisible }),
    tools: modelVisible,
    stopWhen: stepCountIs(10),
  });

  return result.toUIMessageStreamResponse();
}
