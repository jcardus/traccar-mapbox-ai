// @ts-nocheck
import { splitMCPAppTools } from "@ai-sdk/mcp";
import { openai } from "@ai-sdk/openai";
import { convertToModelMessages, stepCountIs, streamText } from "ai";
import { createMcpClients } from "../../../lib/mcp";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { messages } = await req.json();
  const clients = await createMcpClients();
  const mapboxClient = clients.mapbox;
  let modelVisible = {};

  if (mapboxClient) {
    const definitions = await mapboxClient.listTools();
    const split = splitMCPAppTools(definitions);
    modelVisible = mapboxClient.toolsFromDefinitions(split.modelVisible);
  }

  const result = streamText({
    model: openai("gpt-4.1-mini"),
    system:
      "You are a Mapbox geospatial assistant. Use Mapbox tools to search places, geocode, compute routes or isochrones, and always call render_map_tool as the final tool call when displaying a location, route, or map is helpful.",
    messages: await convertToModelMessages(messages),
    tools: modelVisible,
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
}
