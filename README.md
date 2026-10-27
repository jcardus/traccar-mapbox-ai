# Traccar Assistant + Mapbox MCP Apps

This starter wires assistant-ui to two MCP servers:

- Traccar MCP for fleet data and operations.
- Mapbox MCP for geospatial tools and `render_map_tool`, which returns a live MCP Apps map.

## Run

```bash
cp .env.example .env.local
npm install
npm run dev
```

Set `OPENAI_API_KEY`, `MAPBOX_MCP_URL`, and `TRACCAR_MCP_URL`. The Mapbox MCP endpoint may require the transport/auth configuration used by your Mapbox MCP deployment. The `/api/mcp-apps` route is the assistant-ui host bridge for `ui://` resources.
