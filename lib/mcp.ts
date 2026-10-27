// @ts-nocheck
import { createMCPClient, mcpAppClientCapabilities, type MCPClient } from "@ai-sdk/mcp";

export type McpServerId = "mapbox";

const urls: Record<McpServerId, string | undefined> = {
  mapbox: process.env.MAPBOX_MCP_URL,
};

const tokens: Record<McpServerId, string | undefined> = {
  mapbox: process.env.MAPBOX_ACCESS_TOKEN,
};

const clientCache: Partial<Record<McpServerId, Promise<MCPClient | null>>> = {};

async function getClient(id: McpServerId): Promise<MCPClient | null> {
  if (clientCache[id]) return clientCache[id]!;
  const url = urls[id];
  if (!url || url.includes("your-") || url.includes("example.com")) return null;

  const promise = (async () => {
    try {
      const headers: Record<string, string> = {};
      if (tokens[id]) headers["Authorization"] = `Bearer ${tokens[id]}`;
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

  clientCache[id] = promise;
  return promise;
}

export async function createMcpClients() {
  const entries = await Promise.all(
    (Object.keys(urls) as McpServerId[]).map(async (id) => [id, await getClient(id)] as const),
  );
  return Object.fromEntries(entries) as Partial<Record<McpServerId, MCPClient>>;
}
