// ═══════════════════════════════════════════════════════════════
// Agent Types - Claude Agent 전용 TypeScript 인터페이스
// ═══════════════════════════════════════════════════════════════

import type {
  Category,
  WallAnalysis,
  CabinetSpecs,
  StructuredDesignData,
  BomResult,
  DrawingData,
} from '../types/index.js';
import type { ClassifiedRules } from '../mappers/rule-classifier.js';
import type { SvgOutput } from '../services/svg-renderer.service.js';

// ─────────────────────────────────────────────────────────────────
// Claude API tool_use 확장 타입
// ─────────────────────────────────────────────────────────────────

export interface ClaudeToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ClaudeToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }>;
  is_error?: boolean;
}

export interface ClaudeTextBlock {
  type: 'text';
  text: string;
}

export type ClaudeAgentContentBlock = ClaudeTextBlock | ClaudeToolUseBlock;

export interface ClaudeAgentResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: ClaudeAgentContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens';
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface ClaudeAgentMessage {
  role: 'user' | 'assistant';
  content: string | Array<ClaudeAgentContentBlock | ClaudeToolResultBlock | { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }>;
}

export interface ClaudeToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ─────────────────────────────────────────────────────────────────
// Agent Session 타입
// ─────────────────────────────────────────────────────────────────

export interface DesignState {
  category?: Category;
  style?: string;
  wallAnalysis?: WallAnalysis;
  ragRules?: ClassifiedRules;
  cabinetSpecs?: CabinetSpecs;
  designData?: StructuredDesignData;
  generatedImages?: { closed: string; open: string | null };
  bomResult?: BomResult;
  drawingData?: DrawingData;
  svgOutput?: SvgOutput;
}

export interface AgentSession {
  id: string;
  messages: ClaudeAgentMessage[];
  designState: DesignState;
  roomImage?: string;
  imageType?: string;
  createdAt: number;
  lastActiveAt: number;
}

// ─────────────────────────────────────────────────────────────────
// Agent Orchestrator 타입
// ─────────────────────────────────────────────────────────────────

export interface AgentChatRequest {
  session_id?: string;
  message: string;
  images?: Array<{ data: string; mime_type: string }>;
}

export type SSEEventType = 'progress' | 'text' | 'image' | 'design_data' | 'bom' | 'svg' | 'done' | 'error';

export interface SSEEvent {
  event: SSEEventType;
  data: Record<string, unknown>;
}

export interface ToolExecutionResult {
  success: boolean;
  data: unknown;
  error?: string;
}
