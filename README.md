# Traccar Assistant + Mapbox MCP Apps

This starter wires assistant-ui to three MCP servers:

- Traccar MCP for fleet data and operations.
- GeoJSON MCP at `/api/geojson-mcp`. Its `routes_to_geojson` tool loads a Traccar route report and returns the driven path as GeoJSON.
- Mapbox MCP for geospatial tools and `render_map_tool`, which returns a live MCP Apps map.

## Run

```bash
cp .env.example .env.local
npm install
npm run dev
```

Set `OPENAI_API_KEY`, `MAPBOX_MCP_URL`, and `TRACCAR_MCP_URL`. The GeoJSON MCP is this app, at `http://127.0.0.1:3000/api/geojson-mcp` unless `GEOJSON_MCP_URL` is set. `TRACCAR_BASE_URL` overrides the Traccar origin derived from `TRACCAR_MCP_URL`. The Mapbox MCP endpoint may require the transport/auth configuration used by your Mapbox MCP deployment. The `/api/mcp-apps` route is the assistant-ui host bridge for `ui://` resources.
