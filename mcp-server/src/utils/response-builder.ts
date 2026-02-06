// ═══════════════════════════════════════════════════════════════
// Response Builder - MCP 및 HTTP 응답 포맷 통일
// ═══════════════════════════════════════════════════════════════

// MCP 도구 응답 타입 (SDK 호환: index signature 포함)
export interface McpToolResponse {
  [key: string]: unknown;
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

// MCP 도구 응답 빌더
export function mcpSuccess(data: unknown): McpToolResponse {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function mcpError(message: string): McpToolResponse {
  return {
    content: [
      {
        type: 'text',
        text: message,
      },
    ],
    isError: true,
  };
}

// HTTP 응답 빌더
export function httpSuccess<T extends Record<string, unknown>>(data: T) {
  return {
    success: true as const,
    ...data,
  };
}

export function httpError(error: string, statusHint?: number) {
  return {
    success: false as const,
    error,
    statusHint,
  };
}
