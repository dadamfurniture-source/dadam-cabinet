// ═══════════════════════════════════════════════════════════════
// SketchUp Client (planner-vite 측) — iframe planner → mcp-server → SketchUp
//
// dadamfurniture.com 의 detail design 페이지가 iframe 으로 본 Vite 빌드를
// 로드하므로, iframe 내부에서 직접 mcp-server 를 호출한다.
//
// 같은 origin (dadamfurniture.com) 이므로 supabase 의 localStorage 세션이
// iframe 에서도 동일하게 접근 가능 → supabase-js 가 부모 페이지의 로그인
// 세션을 자동으로 detect.
// ═══════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';
import type {
  CabinetCategory,
  CabinetPart,
  MaterialTone,
} from './planner';

// Vite env (build time inline) — 미설정 시 prod fallback.
const SUPABASE_URL =
  (import.meta as any).env?.VITE_SUPABASE_URL ||
  'https://vvqrvgcgnlfpiqqndsve.supabase.co';
const SUPABASE_ANON_KEY =
  (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ2cXJ2Z2NnbmxmcGlxcW5kc3ZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4NTYyMjYsImV4cCI6MjA4MzQzMjIyNn0.WvMdB2bojqRUjYWdljAcxP1yHqQZJwuyv2equltyWWQ';
const DEFAULT_MCP_SERVER_URL =
  (import.meta as any).env?.VITE_MCP_SERVER_URL || 'http://localhost:3200';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export interface ExportToSketchupOptions {
  parts: CabinetPart[];
  category: CabinetCategory;
  materialTone: MaterialTone;
  clearExisting?: boolean;
  transactional?: boolean;
  mcpServerUrl?: string;
}

export type ExportToSketchupResult =
  | {
      ok: true;
      componentCount: number;
      summary: {
        totalSent: number;
        successCount: number;
        failures: Array<{ index: number; error: { message: string } }>;
        durationMs: number;
        averageRttMs: number;
        aborted: boolean;
      };
    }
  | {
      ok: false;
      code: string;
      message: string;
      status?: number;
    };

function resolveMcpUrl(override?: string): string {
  return (override || DEFAULT_MCP_SERVER_URL).replace(/\/$/, '');
}

export async function exportToSketchup(
  opts: ExportToSketchupOptions,
): Promise<ExportToSketchupResult> {
  const url = `${resolveMcpUrl(opts.mcpServerUrl)}/api/sketchup/build`;

  // Supabase 세션 (같은 origin 이므로 부모 페이지의 로그인 토큰 공유)
  const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr || !session?.access_token) {
    return {
      ok: false,
      code: 'AUTH_REQUIRED',
      message: '로그인이 필요합니다. dadamfurniture.com 에 로그인 후 다시 시도하세요.',
    };
  }

  const body = {
    parts: opts.parts,
    category: opts.category,
    materialTone: opts.materialTone,
    clearExisting: opts.clearExisting ?? true,
    transactional: opts.transactional ?? true,
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      code: 'NETWORK_ERROR',
      message: `mcp-server (${url}) 에 연결 실패: ${msg}\n디자이너 PC 에서 mcp-server 가 떠 있는지 확인하세요.`,
    };
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    return {
      ok: false,
      code: 'INVALID_RESPONSE',
      message: `mcp-server 응답이 JSON 이 아닙니다 (${res.status})`,
      status: res.status,
    };
  }

  if (!res.ok || json?.success !== true) {
    return {
      ok: false,
      code: json?.code ?? `HTTP_${res.status}`,
      message: json?.error ?? `mcp-server 빌드 실패 (HTTP ${res.status})`,
      status: res.status,
    };
  }

  return {
    ok: true,
    componentCount: json.componentCount,
    summary: json.summary,
  };
}
