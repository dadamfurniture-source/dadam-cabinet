#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// 다담AI MCP Server - Main Entry Point
// ═══════════════════════════════════════════════════════════════

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// 도구 등록 (import 시 자동 등록)
import './tools/supabase-rag.tool.js';
import './tools/gemini-vision.tool.js';
import './tools/gemini-image.tool.js';

import { getToolDefinitions, executeTool } from './tools/registry.js';

// ─────────────────────────────────────────────────────────────────
// Server Initialization
// ─────────────────────────────────────────────────────────────────

const server = new Server(
  {
    name: 'dadam-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ─────────────────────────────────────────────────────────────────
// Request Handlers
// ─────────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: getToolDefinitions() };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    return await executeTool(name, args);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Error executing ${name}: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// ─────────────────────────────────────────────────────────────────
// Server Startup
// ─────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('다담AI MCP Server started');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
