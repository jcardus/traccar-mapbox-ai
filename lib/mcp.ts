// @ts-nocheck
import { createMCPClient, mcpAppClientCapabilities, type MCPClient } from "@ai-sdk/mcp";

export type McpServerId = "mapbox" | "traccar";

const SERVER_IDS: McpServerId[] = ["mapbox", "traccar"];

function getServerConfig(id: McpServerId) {
  if (id === "mapbox") {
    return { url: process.env.MAPBOX_MCP_URL, token: process.env.MAPBOX_ACCESS_TOKEN };
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
      const client = await Promise.race([
        createMCPClient({
          transport: { type: "http", url, headers },
          capabilities: mcpAppClientCapabilities,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("MCP connection timed out after 8s")), 8000),
        ),
      ]);
      return client;
    } catch (error) {
      console.error(`MCP connection failed (${id})`, error);
      delete clientCache[id];
      return null;
    }
  })();

  clientCache[id] = { key, promise };
  return promise;
}

export async function createMcpClients() {
  const entries = await Promise.all(
    SERVER_IDS.map(async (id) => [id, await getClient(id)] as const),
  );
  return Object.fromEntries(entries) as Partial<Record<McpServerId, MCPClient>>;
}
