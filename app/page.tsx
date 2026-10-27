// @ts-nocheck
"use client";

import { useEffect, useMemo, useState } from "react";
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

  const mapCalls = useMemo(() => {
    const list: { toolCallId: string; args: any; result: any }[] = [];
    for (const msg of messages ?? []) {
      for (const p of msg.parts ?? msg.content ?? []) {
        if (p.type === "tool-call" && p.toolName === "render_map_tool" && p.result !== undefined) {
          list.push({
            toolCallId: p.toolCallId,
            args: p.args,
            result: p.result,
          });
        }
      }
    }
    return list;
  }, [messages]);

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
                          return <p style={{ whiteSpace: "pre-line", margin: "4px 0" }}>{part.text}</p>;
                        }
                        if (part.type === "tool-call" && part.toolName === "render_map_tool") {
                          const isActive = part.toolCallId === activeToolCallId;
                          return (
                            <button
                              type="button"
                              onClick={() => setSelectedToolCallId(part.toolCallId)}
                              style={{
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
                              }}
                            >
                              🗺️ {part.args?.summary || "Map updated"} {isActive ? "(Showing)" : "(Show on map)"}
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
