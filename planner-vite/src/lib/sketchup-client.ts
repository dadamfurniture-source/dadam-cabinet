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
  CabinetPartV2,
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
  // W4-3: deriveCabinet 출력이 V2 로 통일되어 변환 없이 직송.
  parts: CabinetPartV2[];
  category: CabinetCategory;
  materialTone: MaterialTone;
  clearExisting?: boolean;
  transactional?: boolean;
  /** W4-5: rotationZDeg ≠ 0 파트에 transform_component 호출 추가 (기본 false). */
  applyRotation?: boolean;
  /** W4-5: set_material 호출 + 16개 머티리얼 사전 등록 (기본 false). */
  applyMaterial?: boolean;
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

  // W4-3: deriveCabinet 출력이 V2 (Z-up corner mm degrees) — 변환 없이 그대로 송신.
  // W4-5: applyRotation/applyMaterial 옵션 노출 (기본 false — 디자이너 E2E 검증 후 default 전환).
  const body = {
    schemaVersion: 'v2' as const,
    parts: opts.parts,
    category: opts.category,
    materialTone: opts.materialTone,
    clearExisting: opts.clearExisting ?? true,
    transactional: opts.transactional ?? true,
    applyRotation: opts.applyRotation ?? false,
    applyMaterial: opts.applyMaterial ?? false,
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

// ═══════════════════════════════════════════════════════════════
// Si-5: importFromSketchup — SketchUp 활성 모델 → PlannerState 역추적
// ═══════════════════════════════════════════════════════════════

export type LayoutShape = 'I' | 'L' | 'U';
export type ImportedModuleKind = 'door' | 'drawer' | 'open';

export interface ImportedModuleEntry {
  id: string;
  kind: ImportedModuleKind;
  width: number;
  moduleType?: 'storage' | 'sink' | 'cook' | 'hood' | 'drawer';
}

/** mcp-server /api/sketchup/import 응답의 data 필드 (ReconstructedPlannerData 미러). */
export interface ImportedPlannerData {
  category: CabinetCategory;
  width: number;
  height: number;
  depth: number;
  toeKickH: number;
  moldingH: number;
  finishLeftW: number;
  finishRightW: number;
  layoutShape: LayoutShape;
  secondaryW?: number;
  secondaryD?: number;
  secondaryStartSide?: 'left' | 'right';
  tertiaryW?: number;
  tertiaryD?: number;
  lowerModules: ImportedModuleEntry[];
  upperModules: ImportedModuleEntry[];
  lowerCount: number;
  upperCount: number;
  distributorStart: number | null;
  distributorEnd: number | null;
  ventStart: number | null;
  material: MaterialTone;
  confidence: number;
  warnings: string[];
}

export type ImportFromSketchupResult =
  | { ok: true; data: ImportedPlannerData }
  | { ok: false; code: string; message: string; status?: number };

export interface ImportFromSketchupOptions {
  /** mhyrr 호스트 (디자이너 PC 위치) */
  sketchupHost?: string;
  sketchupPort?: number;
  /** mhyrr 가용성 사전 확인 (기본 true) */
  ping?: boolean;
  mcpServerUrl?: string;
}

/**
 * Si-5: SketchUp 활성 모델의 가구를 planner PlannerState 형식으로 가져옴.
 *
 * 동작:
 *   1. mcp-server POST /api/sketchup/import 호출
 *   2. mcp-server 가 mhyrr eval_ruby (DUMP_ENTITIES) → parseEntities → reconstructPlannerData
 *   3. ImportedPlannerData 반환
 *
 * 사용 예 (App.tsx):
 *   const result = await importFromSketchup({});
 *   if (result.ok) {
 *     setPlanner((p) => ({ ...p, ...applyImportedData(result.data) }));
 *   } else {
 *     toast.error(`${result.code}: ${result.message}`);
 *   }
 */
export async function importFromSketchup(
  opts: ImportFromSketchupOptions = {},
): Promise<ImportFromSketchupResult> {
  const url = `${resolveMcpUrl(opts.mcpServerUrl)}/api/sketchup/import`;

  // 1) Supabase 세션
  const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr || !session?.access_token) {
    return {
      ok: false,
      code: 'AUTH_REQUIRED',
      message: '로그인이 필요합니다.',
    };
  }

  // 2) 요청 body
  const body = {
    host: opts.sketchupHost,
    port: opts.sketchupPort,
    ping: opts.ping ?? true,
  };

  // 3) fetch
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

  if (!res.ok || json?.ok !== true) {
    return {
      ok: false,
      code: json?.code ?? `HTTP_${res.status}`,
      message: json?.error ?? json?.message ?? `import 실패 (HTTP ${res.status})`,
      status: res.status,
    };
  }

  return { ok: true, data: json.data as ImportedPlannerData };
}

// ═══════════════════════════════════════════════════════════════
// Phase 3a: 수동 매핑 UI 보조 — entities + 자동 추론 suggestions
// ═══════════════════════════════════════════════════════════════

export interface RawEntity {
  id: number;
  name: string;
  type: 'group' | 'component';
  bounds: { min: [number, number, number]; max: [number, number, number] };
  transformation: number[];
  material_name: string | null;
}

export type SuggestedPartType =
  | 'module-body' | 'module-door' | 'toekick' | 'molding-top'
  | 'finish-side' | 'countertop' | 'utility' | 'unknown';

export interface EntitySuggestion {
  type: SuggestedPartType;
  confidence: number;
  suggestedPartId: string;
  suggestedModuleType?: 'storage' | 'sink' | 'cook' | 'hood' | 'drawer';
  suggestedColorKey: 'body' | 'accent' | 'shadow' | 'trim';
}

export interface FetchSceneResult {
  ok: boolean;
  host?: string;
  port?: number;
  count?: number;
  entities?: RawEntity[];
  suggestions?: EntitySuggestion[];
  error?: string;
}

/**
 * Phase 3a: SketchUp 활성 모델의 raw entities + 자동 추론 결과 가져옴.
 * 수동 매핑 UI 가 사용 — 사용자가 entity 별로 type 분류 후 mark.
 */
export async function fetchSketchupScene(
  opts: { sketchupHost?: string; sketchupPort?: number; mcpServerUrl?: string } = {},
): Promise<FetchSceneResult> {
  const params = new URLSearchParams();
  if (opts.sketchupHost) params.set('host', opts.sketchupHost);
  if (opts.sketchupPort) params.set('port', String(opts.sketchupPort));
  const url = `${resolveMcpUrl(opts.mcpServerUrl)}/api/sketchup/scene?${params.toString()}`;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return { ok: false, error: 'AUTH_REQUIRED' };

  try {
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${session.access_token}` } });
    const json = await res.json();
    if (!res.ok || !json.ok) return { ok: false, error: json.error ?? `HTTP ${res.status}` };
    return {
      ok: true,
      host: json.host,
      port: json.port,
      count: json.count,
      entities: json.entities,
      suggestions: json.suggestions,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
