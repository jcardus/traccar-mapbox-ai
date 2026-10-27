// @ts-nocheck
"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  AssistantRuntimeProvider,
  AuiConfig,
  McpAppRenderer,
  McpAppsRemoteHost,
  MessagePrimitive,
  ThreadPrimitive,
  Tools,
} from "@assistant-ui/react";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";

const config = AuiConfig({
  tools: Tools({
    mcpApp: McpAppRenderer({
      host: McpAppsRemoteHost({ url: "/api/mcp-apps" }),
    }),
  }),
});

export default function Home() {
  const chat = useChat({ api: "/api/chat" });
  const [input, setInput] = useState("");
  const runtime = useAISDKRuntime(chat);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || chat.status === "submitted" || chat.status === "streaming") return;
    setInput("");
    await chat.sendMessage({ text });
  }

  return (
    <AssistantRuntimeProvider runtime={runtime} config={config}>
      <main style={{ height: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui", padding: 24, boxSizing: "border-box" }}>
        <h1 style={{ margin: "0 0 4px" }}>Mapbox Assistant</h1>
        <p style={{ margin: "0 0 12px", color: "#555" }}>Ask about places, routes, directions, or isochrones.</p>
        <ThreadPrimitive.Root style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <ThreadPrimitive.Viewport style={{ flex: 1, border: "1px solid #ddd", borderRadius: 12, padding: 16, overflow: "auto" }}>
            <ThreadPrimitive.Empty>
              <p style={{ color: "#666" }}>Try: “Show coffee shops near Times Square on a map.”</p>
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages>
              {({ message }) => (
                <MessagePrimitive.Root style={{ margin: "12px 0" }}>
                  <strong>{message.role === "user" ? "You" : "Assistant"}:</strong>
                  <div style={{ marginTop: 4 }}>
                    <MessagePrimitive.Parts />
                  </div>
                </MessagePrimitive.Root>
              )}
            </ThreadPrimitive.Messages>
            {chat.error && <p style={{ color: "#b91c1c" }}>{chat.error.message}</p>}
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
        <form onSubmit={submit} style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask for a map, route, or place..."
            style={{ flex: 1, padding: 12, border: "1px solid #ccc", borderRadius: 8 }}
          />
          <button
            type="submit"
            disabled={!input.trim() || chat.status === "submitted" || chat.status === "streaming"}
            style={{ padding: "12px 18px" }}
          >
            {chat.status === "streaming" ? "Thinking…" : "Send"}
          </button>
        </form>
      </main>
    </AssistantRuntimeProvider>
  );
}
