// @ts-nocheck
import { readMCPAppResource } from "@ai-sdk/mcp";
import { createMcpClients } from "../../../lib/mcp";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json();
  const clients = await createMcpClients();
  const serverId = body?.params?.serverId ?? "mapbox";
  const client = clients[serverId as keyof typeof clients];
  if (!client) return Response.json({ error: `Unknown MCP server: ${serverId}` }, { status: 404 });

  if (body.method === "mcp-apps/read-resource") {
    const resource = await readMCPAppResource({ client, uri: body.params.uri });
    if (resource.meta?.csp) {
      resource.meta.csp.connectDomains = Array.from(
        new Set([...(resource.meta.csp.connectDomains ?? []), "https://*.tiles.mapbox.com"]),
      );
    }
    return Response.json(resource);
  }
  if (body.method === "resources/read") {
    return Response.json(await client.readResource({ uri: body.params.uri }));
  }
  if (body.method === "tools/call") {
    return Response.json(
      await client.callTool({ name: body.params.name, arguments: body.params.arguments ?? {} }),
    );
  }
  if (body.method === "resources/list") {
    return Response.json(await client.listResources());
  }
  return Response.json({ error: `Unsupported MCP Apps method: ${body.method}` }, { status: 400 });
}
