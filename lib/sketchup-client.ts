// ═══════════════════════════════════════════════════════════════
// SketchUp Client — Planner → mcp-server → SketchUp 빌드
//
// @deprecated W4-6 (2026-05): legacy Next.js 측 클라이언트.
// dadamfurniture.com 의 production iframe (planner-vite Vite 빌드, /planner/embed/)
// 은 planner-vite/src/lib/sketchup-client.ts 사용. 본 파일은 components/planner
// (legacy) + app/embed, app/planner Next.js 라우트에서만 사용.
//
// W4-6 시 송신 직전 V1→V2 변환 (mcp-server 가 V2 만 받음).
// planner-vite 와 코드 중복 — 향후 통합 또는 삭제 권장.
//
// detail design 페이지의 planner 가 만든 CabinetPart[] 를 mcp-server 의
// /api/sketchup/build 라우트로 전송하여 디자이너 PC 의 SketchUp 에
// 자동으로 3D 모델을 빌드한다.
//
// 사전 조건 (디자이너 PC):
//   1. SketchUp + mhyrr/sketchup-mcp 확장 기동 (127.0.0.1:9876 listen)
//   2. mcp-server 기동 (기본 http://localhost:3200)
//   3. dadamfurniture.com 로그인 (JWT 토큰 발급)
//   4. 위 3가지가 같은 머신 또는 같은 LAN
//
// mcp-server URL 우선순위:
//   1) buildOpts.mcpServerUrl 명시
//   2) process.env.NEXT_PUBLIC_MCP_SERVER_URL
//   3) http://localhost:3200 (기본값)
// ═══════════════════════════════════════════════════════════════

import { auth } from './supabase';
import type {
  CabinetCategory,
  CabinetPart,
  CabinetPartV2,
  MaterialTone,
} from './planner';

/**
 * W4-6: V1 (Y-up center radians) → V2 (Z-up corner degrees) 부품 변환.
 * planner-vite/src/lib/coords.ts 의 migratePartV1ToV2 와 동일 logic.
 *
 *   좌표축: V1 Y-up (x=가로, y=수직, z=깊이) → V2 Z-up (x=가로, y=깊이, z=수직)
 *   기준점: 박스 중심 → 박스 최소 모서리
 *   회전: rotationY radians → rotationZDeg degrees (부호 보존)
 */
function migratePartV1ToV2(p: CabinetPart): CabinetPartV2 {
  // V1 (x, y, z) center → V2 (x, z, y) center (Y-up→Z-up 축 교환)
  const centerX = p.x;
  const centerY = p.z;
  const centerZ = p.y;
  // V2 치수: V1 의 (width, height, depth) 가 의미는 같지만 V2 (width, depth, height) 매핑.
  // V1 width=+x extent, height=+y(수직), depth=+z(깊이)
  // V2 width=+x extent, depth=+y(깊이), height=+z(수직)
  // 같은 박스 모양 — V2.depth = V1.depth (planner Y-up z extent), V2.height = V1.height.
  const sizeX = p.width;
  const sizeY = p.depth;
  const sizeZ = p.height;
  return {
    id: p.id,
    label: p.label,
    x: centerX - sizeX / 2,
    y: centerY - sizeY / 2,
    z: centerZ - sizeZ / 2,
    width: sizeX,
    depth: sizeY,
    height: sizeZ,
    rotationZDeg: p.rotationY != null ? (p.rotationY * 180) / Math.PI : undefined,
    colorKey: p.colorKey,
    wireframe: p.wireframe,
    essential: p.essential,
    moduleType: p.moduleType,
    isDoor: p.isDoor,
    parentModuleId: p.parentModuleId,
    doorIndex: p.doorIndex,
    openDirection: p.openDirection,
  };
}

const DEFAULT_MCP_SERVER_URL = 'http://localhost:3200';

export interface ExportToSketchupOptions {
  parts: CabinetPart[];
  category: CabinetCategory;
  materialTone: MaterialTone;
  /** 빌드 전 SketchUp 의 active_entities 비우기 (기본 true) */
  clearExisting?: boolean;
  /** START_OP/COMMIT_OP 로 트랜잭션 래핑 — Ctrl+Z 1회 롤백 (기본 true) */
  transactional?: boolean;
  /** mcp-server URL override (env 우선) */
  mcpServerUrl?: string;
  /** mhyrr 호스트/포트 (mcp-server 가 통신할 SketchUp 위치) */
  sketchupHost?: string;
  sketchupPort?: number;
}

export interface ExportToSketchupResult {
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

export interface ExportToSketchupError {
  ok: false;
  code: string;
  message: string;
  status?: number;
  details?: unknown;
}

function resolveMcpUrl(override?: string): string {
  if (override) return override.replace(/\/$/, '');
  const env = process.env.NEXT_PUBLIC_MCP_SERVER_URL;
  if (env) return env.replace(/\/$/, '');
  return DEFAULT_MCP_SERVER_URL;
}

/**
 * planner 의 DerivedCabinet → SketchUp 빌드 트리거.
 *
 * 사용 예:
 *   const { derived, planner } = ...;
 *   const result = await exportToSketchup({
 *     parts: derived.parts,
 *     category: planner.presetId,
 *     materialTone: planner.material,
 *   });
 *   if (result.ok) toast(`✓ ${result.componentCount}개 컴포넌트 빌드 완료`);
 *   else            toast(`✗ ${result.message}`);
 */
export async function exportToSketchup(
  opts: ExportToSketchupOptions,
): Promise<ExportToSketchupResult | ExportToSketchupError> {
  const url = `${resolveMcpUrl(opts.mcpServerUrl)}/api/sketchup/build`;

  // 1) JWT 토큰
  const { session, error: sessionErr } = await auth.getSession();
  if (sessionErr || !session?.access_token) {
    return {
      ok: false,
      code: 'AUTH_REQUIRED',
      message: '로그인이 필요합니다. (Supabase 세션 없음)',
      details: sessionErr,
    };
  }

  // 2) 요청 body — mcp-server 의 sketchupBuildSchema 호환
  // W4-6: mcp-server 가 W4-4 부터 V2 (Z-up corner mm degrees) 만 받음.
  // legacy components/planner 가 여전히 V1 (Y-up center mm radians) 출력하므로
  // 송신 직전에 변환. planner-vite 의 coords.ts/migratePartV1ToV2 와 동일 logic.
  const partsV2 = opts.parts.map(migratePartV1ToV2);
  const body = {
    schemaVersion: 'v2' as const,
    parts: partsV2,
    category: opts.category,
    materialTone: opts.materialTone,
    clearExisting: opts.clearExisting ?? true,
    transactional: opts.transactional ?? true,
    host: opts.sketchupHost,
    port: opts.sketchupPort,
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

  // 4) 응답 파싱
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
      details: json,
    };
  }

  // 5) 성공
  return {
    ok: true,
    componentCount: json.componentCount,
    summary: json.summary,
  };
}

/**
 * mhyrr 가용성 확인 — 빌드 전 ping 권장.
 * 디자이너 PC 의 SketchUp + mhyrr 가 살아있는지 빠르게 체크.
 */
export async function pingSketchupBridge(
  mcpServerUrl?: string,
): Promise<{ ok: true; rttMs: number } | { ok: false; message: string }> {
  const url = `${resolveMcpUrl(mcpServerUrl)}/api/sketchup/ping`;
  const { session } = await auth.getSession();
  if (!session?.access_token) {
    return { ok: false, message: '로그인이 필요합니다.' };
  }
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const json = await res.json();
    if (res.ok && json.ok) return { ok: true, rttMs: json.rttMs };
    return { ok: false, message: json.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
