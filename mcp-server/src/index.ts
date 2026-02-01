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

import { supabaseRagTool, handleSupabaseRag } from './tools/supabase-rag.js';
import { geminiVisionTool, handleGeminiVision } from './tools/gemini-vision.js';
import { geminiImageTool, handleGeminiImage } from './tools/gemini-image.js';

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
// Tool Definitions
// ─────────────────────────────────────────────────────────────────

const tools = [
  supabaseRagTool,
  geminiVisionTool,
  geminiImageTool,
];

// ─────────────────────────────────────────────────────────────────
// Request Handlers
// ─────────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'supabase_rag_search':
        return await handleSupabaseRag(args);

      case 'gemini_wall_analysis':
        return await handleGeminiVision(args);

      case 'gemini_generate_image':
        return await handleGeminiImage(args);

      default:
        return {
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        };
    }
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
