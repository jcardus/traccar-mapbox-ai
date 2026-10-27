// @ts-nocheck
import { splitMCPAppTools } from "@ai-sdk/mcp";
import { openai } from "@ai-sdk/openai";
import { convertToModelMessages, stepCountIs, streamText } from "ai";
import { fleetInstructions } from "@/lib/instructions";
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
    system: fleetInstructions(),
    messages: await convertToModelMessages(messages),
    tools: modelVisible,
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
}
