#!/usr/bin/env node
/**
 * Pest Sentinel MCP Server
 *
 * Provides real-time pest risk intelligence for 500+ zones across the US and Canada.
 * Updated weekly with scores for 15 pest types across 12 US states and 7 Canadian provinces.
 *
 * Questions this server answers:
 *  - What are the current pest risk scores for [city/zone]?
 *  - Which zones have rising pest pressure this week?
 *  - Where is termite/rodent/mosquito risk highest right now?
 *  - How has pest pressure in [city] changed over the past 6 weeks?
 *  - What's the regional pest outlook for [state/province]?
 *  - Which cities are covered? Is [city] covered?
 *  - What pest types does Pest Sentinel track?
 *
 * Required environment variable:
 *   SUPABASE_ANON_KEY — your Pest Sentinel API key (get from pestsentinel.ai)
 *
 * Transport modes:
 *   stdio (default) — for Claude Desktop and local use
 *   http — for remote/cloud deployment (set TRANSPORT=http)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

import { registerZoneTools } from "./tools/zones.js";
import { registerRiskScoreTools } from "./tools/risk-scores.js";
import { registerPestTools } from "./tools/pests.js";

const server = new McpServer({
  name: "pestsentinel-mcp-server",
  version: "1.0.0",
});

// Register all tools
registerZoneTools(server);
registerRiskScoreTools(server);
registerPestTools(server);

// ── Transport ─────────────────────────────────────────────────────────────────

async function runStdio(): Promise<void> {
  if (!process.env.SUPABASE_ANON_KEY) {
    console.error(
      "ERROR: SUPABASE_ANON_KEY environment variable is required.\n" +
      "Get your API key at https://pestsentinel.ai or contact support@pestsentinel.ai"
    );
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Pest Sentinel MCP server running via stdio");
}

async function runHTTP(): Promise<void> {
  if (!process.env.SUPABASE_ANON_KEY) {
    console.error("ERROR: SUPABASE_ANON_KEY environment variable is required.");
    process.exit(1);
  }

  const app = express();
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.json({
      name: "Pest Sentinel MCP Server",
      version: "1.0.0",
      description: "Real-time pest risk intelligence for 500+ zones across the US and Canada",
      transport: "streamable-http",
      endpoint: "/mcp",
    });
  });

  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT ?? "3000", 10);
  app.listen(port, () => {
    console.error(`Pest Sentinel MCP server running on http://localhost:${port}/mcp`);
  });
}

const transportMode = process.env.TRANSPORT ?? "stdio";
if (transportMode === "http") {
  runHTTP().catch((error: unknown) => {
    console.error("Server error:", error);
    process.exit(1);
  });
} else {
  runStdio().catch((error: unknown) => {
    console.error("Server error:", error);
    process.exit(1);
  });
}
