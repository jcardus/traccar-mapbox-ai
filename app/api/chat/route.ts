// @ts-nocheck
import { splitMCPAppTools } from "@ai-sdk/mcp";
import { openai } from "@ai-sdk/openai";
import { convertToModelMessages, stepCountIs, streamText } from "ai";
import { fleetInstructions } from "@/lib/instructions";
import { createMcpClients } from "@/lib/mcp";

export const runtime = "nodejs";

const POSITIONS_LINK =
  "When from or to is set, returns a summary and a traccar:// resource link instead of the positions. Pass that exact URI to positions_to_geojson as uri. Do not paste positions and do not call resources/read.";

function describeTraccarTool(name: string, tool: any) {
  if (name === "getPositions") {
    return {
      ...tool,
      description: `Returns the latest position of each device as JSON. ${POSITIONS_LINK}`,
    };
  }
  if (name === "getReportsRoute") {
    return {
      ...tool,
      description:
        "Returns a summary and a traccar:// resource link for the positions in the period. Pass that exact URI to positions_to_geojson as uri. Do not paste positions and do not call resources/read.",
    };
  }
  return tool;
}

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
        serverId === "mapbox" || serverId === "geojson" ? name : `${serverId}_${name}`,
        serverId === "traccar" ? describeTraccarTool(name, tool) : tool,
      ] as const);
    }),
  );
  const modelVisible = Object.fromEntries(entries.flat());

  const result = streamText({
    model: openai("gpt-6-luna"),
    system: fleetInstructions(),
    messages: await convertToModelMessages(messages, { tools: modelVisible }),
    tools: modelVisible,
    stopWhen: stepCountIs(10),
  });

  return result.toUIMessageStreamResponse();
}
