# Traccar Assistant + Mapbox MCP Apps

This starter wires assistant-ui to three MCP servers:

- Traccar MCP for fleet data and operations.
- GeoJSON MCP at `/api/geojson-mcp`. Its `positions_to_geojson` tool reads a `traccar://` positions link, or a short positions array, and draws the track. The tool result is only a trace.
- Mapbox MCP for geospatial tools and `render_map_tool`, which returns a live MCP Apps map.

## Run

```bash
cp .env.example .env.local
npm install
npm run dev
```

Set `OPENAI_API_KEY`, `MAPBOX_MCP_URL`, and `TRACCAR_MCP_URL`. The GeoJSON MCP is this app, at `http://127.0.0.1:3000/api/geojson-mcp` unless `GEOJSON_MCP_URL` is set. The Mapbox MCP endpoint may require the transport/auth configuration used by your Mapbox MCP deployment. The `/api/mcp-apps` route is the assistant-ui host bridge for `ui://` resources.
