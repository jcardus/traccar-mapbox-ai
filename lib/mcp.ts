// @ts-nocheck
import {createMCPClient, mcpAppClientCapabilities, type MCPClient} from "@ai-sdk/mcp";

export type McpServerId = "mapbox" | "traccar" | "geojson";

const SERVER_IDS: McpServerId[] = ["mapbox", "traccar", "geojson"];

function getServerConfig(id: McpServerId) {
  if (id === "mapbox") {
    return { url: process.env.MAPBOX_MCP_URL, token: process.env.MAPBOX_ACCESS_TOKEN };
  }
  if (id === "geojson") {
    const port = process.env.PORT || "3000";
    return {
      url: process.env.GEOJSON_MCP_URL || `http://127.0.0.1:${port}/api/geojson-mcp`,
      token: undefined,
    };
  }
  return { url: process.env.TRACCAR_MCP_URL, token: process.env.TRACCAR_MCP_TOKEN };
}

const clientCache: Partial<Record<McpServerId, { key: string; promise: Promise<MCPClient | null> }>> = {};

async function getClient(id: McpServerId): Promise<MCPClient | null> {
  const { url, token } = getServerConfig(id);
  if (!url || url.includes("your-") || url.includes("example.com")) return null;

  const key = `${url}|${token ?? ""}`;
  if (clientCache[id]?.key === key) return clientCache[id]!.promise;

  const promise = (async () => {
    try {
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      return await Promise.race([
        createMCPClient({
          transport: {type: "http", url, headers},
          capabilities: mcpAppClientCapabilities,
        }),
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("MCP connection timed out after 8s")), 8000),
        ),
      ]);
    } catch (error) {
      console.error(`MCP connection failed (${id})`, error);
      delete clientCache[id];
      return null;
    }
  })();

  clientCache[id] = { key, promise };
  return promise;
}

export async function readTraccarResource(uri: string): Promise<string> {
  const client = await getClient("traccar");
  if (!client) throw new Error("Traccar MCP is not configured.");
  const result = await client.readResource({ uri });
  for (const item of result?.contents ?? []) {
    if (typeof item?.text === "string") return item.text;
  }
  throw new Error("Traccar returned no positions.");
}

export async function createMcpClients() {
  const entries = await Promise.all(
    SERVER_IDS.map(async (id) => [id, await getClient(id)] as const),
  );
  return Object.fromEntries(entries) as Partial<Record<McpServerId, MCPClient>>;
}
