// @ts-nocheck
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AssistantRuntimeProvider,
  AuiConfig,
  ComposerPrimitive,
  McpAppRenderer,
  McpAppsRemoteHost,
  MessagePrimitive,
  ThreadPrimitive,
  Tools,
  useAuiState,
} from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { MarkdownText } from "@/components/markdown-text";

const config = AuiConfig({
  tools: Tools({
    mcpApp: McpAppRenderer({
      host: McpAppsRemoteHost({ url: "/api/mcp-apps" }),
      maxHeight: 2000,
      sandbox: {
        unsafeDocumentWrite: true,
        style: { width: "100%", height: "100%", minHeight: "100%" },
      },
    }),
  }),
});

const MAP_TOOL_NAMES = new Set(["render_map_tool"]);
const TRACK_TOOL_NAME = "positions_to_geojson";

function mapResultOf(part: any) {
  return part?.result ?? part?.output;
}

function routeIdOf(part: any) {
  const id = mapResultOf(part)?.structuredContent?.routeId;
  return typeof id === "string" ? id : null;
}

function traceLabel(part: any) {
  const trace = mapResultOf(part)?.structuredContent?.trace;
  if (!trace) return "Recorded track";
  const bits = [];
  if (trace.distanceKm != null) bits.push(`${trace.distanceKm} km`);
  if (trace.durationMinutes != null) bits.push(`${trace.durationMinutes} min`);
  return bits.length > 0 ? bits.join(", ") : "Recorded track";
}

function mapButtonStyle(isActive: boolean) {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    margin: "6px 0",
    padding: "6px 10px",
    fontSize: 13,
    borderRadius: 6,
    border: isActive ? "1px solid #2563eb" : "1px solid #ccc",
    background: isActive ? "#eff6ff" : "#f9fafb",
    color: isActive ? "#1d4ed8" : "#374151",
    cursor: "pointer",
  };
}

async function loadTrack(id: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`/api/recorded-routes/${id}`);
      if (response.status === 404) return null;
      if (response.ok) {
        const body = await response.json();
        if (body?.mapboxRender) return body.mapboxRender;
      }
    } catch {
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return null;
}

// Hovering a message rebuilds the thread state. A new result object makes the
// map remove the line and draw it again, which flickers as the pointer crosses
// between the chat and the map.
function cachedTrackResult(cache: Map<string, { payload: any; result: any }>, id: string, payload: any) {
  const cached = cache.get(id);
  if (cached?.payload === payload) return cached.result;
  const result = trackMapResult(payload);
  cache.set(id, { payload, result });
  return result;
}

function trackMapResult(payload: any) {
  return {
    structuredContent: {
      rendered: true,
      layer_count: payload.layers?.length ?? 0,
      marker_count: payload.markers?.length ?? 0,
      summary: payload.summary,
      mapboxRender: payload,
    },
  };
}

function isDrawnMap(part: any) {
  return Boolean(mapResultOf(part)?.structuredContent?.mapboxRender);
}

const EMPTY_ARGS = {};

const INITIAL_MAP_OUTPUT = {
  structuredContent: {
    rendered: true,
    layer_count: 0,
    marker_count: 0,
    mapboxRender: {
      layers: [],
      markers: [],
    },
  },
};

function Workspace() {
  const messages = useAuiState((s: any) => s.thread.messages);
  const Render = useAuiState((s: any) => s.tools?.mcpApp?.render);
  const [selectedToolCallId, setSelectedToolCallId] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Record<string, any>>({});
  const [missingTracks, setMissingTracks] = useState<Record<string, boolean>>({});
  const requestedTracks = useRef(new Set<string>());
  const trackResults = useRef(new Map());

  const routeIds = useMemo(() => {
    const ids: string[] = [];
    for (const msg of messages ?? []) {
      for (const p of msg.parts ?? msg.content ?? []) {
        if (p.type === "tool-call" && p.toolName === TRACK_TOOL_NAME) {
          const id = routeIdOf(p);
          if (id) ids.push(id);
        }
      }
    }
    return ids;
  }, [messages]);

  useEffect(() => {
    for (const id of routeIds) {
      if (requestedTracks.current.has(id)) continue;
      requestedTracks.current.add(id);
      loadTrack(id).then((payload) => {
        if (!payload) {
          setMissingTracks((current) => (current[id] ? current : { ...current, [id]: true }));
          return;
        }
        setTracks((current) => (current[id] ? current : { ...current, [id]: payload }));
      });
    }
  }, [routeIds]);

  const mapCalls = useMemo(() => {
    const list: { toolCallId: string; args: any; result: any }[] = [];
    for (const msg of messages ?? []) {
      for (const p of msg.parts ?? msg.content ?? []) {
        if (p.type === "tool-call" && MAP_TOOL_NAMES.has(p.toolName) && isDrawnMap(p)) {
          list.push({
            toolCallId: p.toolCallId,
            args: p.args,
            result: mapResultOf(p),
          });
        }
        if (p.type === "tool-call" && p.toolName === TRACK_TOOL_NAME) {
          const id = routeIdOf(p);
          const payload = id ? tracks[id] : null;
          if (id && payload) {
            list.push({
              toolCallId: `track:${id}`,
              args: EMPTY_ARGS,
              result: cachedTrackResult(trackResults.current, id, payload),
            });
          }
        }
      }
    }
    return list;
  }, [messages, tracks]);

  const latestMapToolCallId = mapCalls.length > 0 ? mapCalls[mapCalls.length - 1].toolCallId : null;

  useEffect(() => {
    if (latestMapToolCallId) {
      setSelectedToolCallId(latestMapToolCallId);
    }
  }, [latestMapToolCallId]);

  const activeToolCallId = selectedToolCallId ?? latestMapToolCallId;
  const activeMapCall = useMemo(
    () => mapCalls.find((c) => c.toolCallId === activeToolCallId) ?? mapCalls[mapCalls.length - 1] ?? null,
    [mapCalls, activeToolCallId],
  );
  const partProps = {
    type: "tool-call",
    toolCallId: "persistent-mapbox-map",
    toolName: "render_map_tool",
    args: activeMapCall?.args ?? {},
    argsText: JSON.stringify(activeMapCall?.args ?? {}),
    result: activeMapCall?.result ?? INITIAL_MAP_OUTPUT,
    status: { type: "complete" },
    mcp: {
      app: {
        resourceUri: "ui://mapbox/map-app/index.html",
        serverId: "mapbox",
      },
    },
  };

  return (
    <main
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "row",
        fontFamily: "system-ui",
        padding: 16,
        gap: 16,
        boxSizing: "border-box",
      }}
    >
      {/* Left pane: Chat */}
      <section
        style={{
          width: 420,
          minWidth: 320,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <h1 style={{ margin: "0 0 4px", fontSize: 22 }}>Traccar Assistant</h1>
        <p style={{ margin: "0 0 12px", color: "#555", fontSize: 14 }}>
          Ask about devices, positions, routes, or geofences.
        </p>
        <ThreadPrimitive.Root style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <ThreadPrimitive.Viewport
            style={{
              flex: 1,
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 16,
              overflow: "auto",
            }}
          >
            <ThreadPrimitive.Empty>
              <p style={{ color: "#666" }}>Try: “Show all online devices on a map.”</p>
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages>
              {({ message }) => (
                <MessagePrimitive.Root style={{ margin: "12px 0" }}>
                  <strong>{message.role === "user" ? "You" : "Assistant"}:</strong>
                  <div style={{ marginTop: 4 }}>
                    <MessagePrimitive.Parts>
                      {({ part }) => {
                        if (part.type === "text") {
                          if (!part.text) return <></>;
                          return <MarkdownText />;
                        }
                        if (part.type === "tool-call" && MAP_TOOL_NAMES.has(part.toolName)) {
                          if (!isDrawnMap(part)) return <></>;
                          const isActive = part.toolCallId === activeToolCallId;
                          const summary = part.args?.summary || mapResultOf(part)?.structuredContent?.summary || "Map updated";
                          return (
                            <button
                              type="button"
                              onClick={() => setSelectedToolCallId(part.toolCallId)}
                              style={mapButtonStyle(isActive)}
                            >
                              🗺️ {summary} {isActive ? "(Showing)" : "(Show on map)"}
                            </button>
                          );
                        }
                        if (part.type === "tool-call" && part.toolName === TRACK_TOOL_NAME) {
                          const routeId = routeIdOf(part);
                          if (!routeId) return <></>;
                          const toolCallId = `track:${routeId}`;
                          const isActive = toolCallId === activeToolCallId;
                          const ready = Boolean(tracks[routeId]);
                          const missing = Boolean(missingTracks[routeId]);
                          const state = isActive ? "(Showing)" : ready ? "(Show on map)" : missing ? "(Unavailable)" : "(Drawing)";
                          return (
                            <button
                              type="button"
                              onClick={() => ready && setSelectedToolCallId(toolCallId)}
                              style={mapButtonStyle(isActive)}
                            >
                              🗺️ {traceLabel(part)} {state}
                            </button>
                          );
                        }
                        return <></>;
                      }}
                    </MessagePrimitive.Parts>
                  </div>
                </MessagePrimitive.Root>
              )}
            </ThreadPrimitive.Messages>
          </ThreadPrimitive.Viewport>
          <ComposerPrimitive.Root style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <ComposerPrimitive.Input
              placeholder="Ask for a map, route, or device..."
              style={{ flex: 1, padding: 12, border: "1px solid #ccc", borderRadius: 8 }}
            />
            <ComposerPrimitive.Send style={{ padding: "12px 18px" }}>
              Send
            </ComposerPrimitive.Send>
          </ComposerPrimitive.Root>
        </ThreadPrimitive.Root>
      </section>

      {/* Right pane: Single Persistent Map */}
      <section
        style={{
          flex: 1,
          border: "1px solid #ddd",
          borderRadius: 12,
          overflow: "hidden",
          position: "relative",
          background: "#f8fafc",
        }}
      >
        {Render ? <Render {...partProps} /> : null}
      </section>
    </main>
  );
}

export default function Home() {
  const runtime = useChatRuntime();
  return (
    <AssistantRuntimeProvider runtime={runtime} config={config}>
      <Workspace />
    </AssistantRuntimeProvider>
  );
}
