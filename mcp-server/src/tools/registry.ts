// ═══════════════════════════════════════════════════════════════
// MCP Tool Registry - Map 기반 도구 레지스트리
// switch문 → Map 레지스트리로 전환
// ═══════════════════════════════════════════════════════════════

import type { McpToolResponse } from '../utils/response-builder.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type ToolHandler = (args: unknown) => Promise<McpToolResponse>;

interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

const registry = new Map<string, RegisteredTool>();

export function registerTool(definition: ToolDefinition, handler: ToolHandler): void {
  registry.set(definition.name, { definition, handler });
}

export function getToolDefinitions(): ToolDefinition[] {
  return Array.from(registry.values()).map(t => t.definition);
}

export async function executeTool(name: string, args: unknown): Promise<McpToolResponse> {
  const tool = registry.get(name);
  if (!tool) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  return tool.handler(args);
}
