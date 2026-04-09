// ═══════════════════════════════════════════════════════════════
// Sink HITL Storage - Supabase 기반 CRUD
// cases, pairs, rules 테이블 접근
// ═══════════════════════════════════════════════════════════════

import { getConfig } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { fetchWithRetry } from '../clients/base-http.client.js';
import type { SinkDesign, SinkDiffPair, SinkDiffOp } from '../schemas/sink-hitl.schemas.js';

const log = createLogger('sink-hitl-storage');

// ─── Supabase REST 헬퍼 ───

function supabaseHeaders(): Record<string, string> {
  const config = getConfig();
  return {
    'apikey': config.supabase.anonKey,
    'Authorization': `Bearer ${config.supabase.anonKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
}

function supabaseUrl(table: string, query = ''): string {
  const config = getConfig();
  return `${config.supabase.url}/rest/v1/${table}${query ? `?${query}` : ''}`;
}

async function supabaseRpc<T>(fn: string, params: Record<string, unknown>): Promise<T> {
  const config = getConfig();
  const response = await fetchWithRetry(
    'supabase-hitl',
    `${config.supabase.url}/rest/v1/rpc/${fn}`,
    {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify(params),
      timeout: config.supabase.timeout,
    },
  );
  return response.json() as Promise<T>;
}

// ─── Case CRUD ───

export async function saveCase(design: SinkDesign): Promise<string> {
  const config = getConfig();
  const row = {
    id: design.id,
    version: design.version,
    env: design.env,
    lower: design.lower,
    upper: design.upper,
    meta: design.meta,
  };

  await fetchWithRetry(
    'supabase-hitl',
    supabaseUrl('sink_hitl_cases'),
    {
      method: 'POST',
      headers: { ...supabaseHeaders(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(row),
      timeout: config.supabase.timeout,
    },
  );

  log.debug({ id: design.id }, 'Case saved to Supabase');
  return design.id;
}

export async function loadCase(id: string): Promise<SinkDesign | null> {
  const config = getConfig();
  try {
    const response = await fetchWithRetry(
      'supabase-hitl',
      supabaseUrl('sink_hitl_cases', `id=eq.${encodeURIComponent(id)}&select=*&limit=1`),
      {
        method: 'GET',
        headers: supabaseHeaders(),
        timeout: config.supabase.timeout,
      },
    );
    const rows = await response.json() as Array<Record<string, unknown>>;
    if (rows.length === 0) return null;
    return rowToDesign(rows[0]);
  } catch {
    return null;
  }
}

export async function listCases(): Promise<string[]> {
  const config = getConfig();
  const response = await fetchWithRetry(
    'supabase-hitl',
    supabaseUrl('sink_hitl_cases', 'select=id&order=created_at.desc&limit=500'),
    {
      method: 'GET',
      headers: supabaseHeaders(),
      timeout: config.supabase.timeout,
    },
  );
  const rows = await response.json() as Array<{ id: string }>;
  return rows.map(r => r.id);
}

// ─── Pair CRUD ───

export async function savePair(pair: SinkDiffPair): Promise<string> {
  const config = getConfig();
  const row = {
    pair_id: pair.pair_id,
    generated_id: pair.generated.id,
    corrected_id: pair.corrected.id,
    diffs: pair.diffs,
    rating: pair.rating,
    comment: pair.comment ?? null,
    layout_type: pair.generated.env.layoutType ?? 'I',
    wall_width: pair.generated.env.width,
  };

  await fetchWithRetry(
    'supabase-hitl',
    supabaseUrl('sink_hitl_pairs'),
    {
      method: 'POST',
      headers: { ...supabaseHeaders(), 'Prefer': 'return=minimal' },
      body: JSON.stringify(row),
      timeout: config.supabase.timeout,
    },
  );

  log.debug({ pair_id: pair.pair_id, rating: pair.rating }, 'Pair saved to Supabase');
  return pair.pair_id;
}

export async function loadPair(pairId: string): Promise<SinkDiffPair | null> {
  const config = getConfig();
  try {
    const response = await fetchWithRetry(
      'supabase-hitl',
      supabaseUrl('sink_hitl_pairs', `pair_id=eq.${encodeURIComponent(pairId)}&select=*`),
      {
        method: 'GET',
        headers: supabaseHeaders(),
        timeout: config.supabase.timeout,
      },
    );
    const rows = await response.json() as Array<Record<string, unknown>>;
    if (rows.length === 0) return null;
    return await rowToPair(rows[0]);
  } catch {
    return null;
  }
}

export async function listPairs(limit = 200): Promise<SinkDiffPair[]> {
  const config = getConfig();
  const response = await fetchWithRetry(
    'supabase-hitl',
    supabaseUrl('sink_hitl_pairs', `select=*&order=created_at.desc&limit=${limit}`),
    {
      method: 'GET',
      headers: supabaseHeaders(),
      timeout: config.supabase.timeout,
    },
  );
  const rows = await response.json() as Array<Record<string, unknown>>;
  const pairs: SinkDiffPair[] = [];
  for (const row of rows) {
    const pair = await rowToPair(row);
    if (pair) pairs.push(pair);
  }
  return pairs;
}

// ─── 고평점 pair 검색 (few-shot 예시용) ───

export interface SimilarPairResult {
  pair_id: string;
  generated: Record<string, unknown>;
  corrected: Record<string, unknown>;
  diffs: SinkDiffOp[];
  rating: number;
}

export async function getHighRatedPairs(
  layoutType: string | null,
  widthMin: number | null,
  widthMax: number | null,
  minRating = 4,
  limit = 3,
): Promise<SimilarPairResult[]> {
  return supabaseRpc<SimilarPairResult[]>('sink_hitl_similar_pairs', {
    p_layout_type: layoutType,
    p_width_min: widthMin,
    p_width_max: widthMax,
    p_min_rating: minRating,
    p_limit: limit,
  });
}

// ─── Rule CRUD ───

export interface SinkHitlRule {
  rule_id: string;
  tag: string;
  description: string | null;
  condition: Record<string, unknown>;
  action: Record<string, unknown>;
  confidence: number;
  sample_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export async function saveRules(rules: Omit<SinkHitlRule, 'created_at' | 'updated_at'>[]): Promise<number> {
  if (rules.length === 0) return 0;
  const config = getConfig();

  const rows = rules.map(r => ({
    rule_id: r.rule_id,
    tag: r.tag,
    description: r.description,
    condition: r.condition,
    action: r.action,
    confidence: r.confidence,
    sample_count: r.sample_count,
    is_active: r.is_active,
    updated_at: new Date().toISOString(),
  }));

  await fetchWithRetry(
    'supabase-hitl',
    supabaseUrl('sink_hitl_rules', 'on_conflict=tag'),
    {
      method: 'POST',
      headers: { ...supabaseHeaders(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
      timeout: config.supabase.timeout,
    },
  );

  log.info({ count: rows.length }, 'Rules upserted to Supabase');
  return rows.length;
}

export async function getActiveRules(): Promise<SinkHitlRule[]> {
  const config = getConfig();
  const response = await fetchWithRetry(
    'supabase-hitl',
    supabaseUrl('sink_hitl_rules', 'is_active=eq.true&order=confidence.desc'),
    {
      method: 'GET',
      headers: supabaseHeaders(),
      timeout: config.supabase.timeout,
    },
  );
  return response.json() as Promise<SinkHitlRule[]>;
}

export async function getAllRules(): Promise<SinkHitlRule[]> {
  const config = getConfig();
  const response = await fetchWithRetry(
    'supabase-hitl',
    supabaseUrl('sink_hitl_rules', 'order=confidence.desc'),
    {
      method: 'GET',
      headers: supabaseHeaders(),
      timeout: config.supabase.timeout,
    },
  );
  return response.json() as Promise<SinkHitlRule[]>;
}

// ─── 통계 ───

export interface SinkHitlStats {
  totalPairs: number;
  totalCases: number;
  avgRating: number;
  avgDiffCount: number;
  lastWeekPairs: number;
  activeRuleCount: number;
  totalRuleCount: number;
}

export async function getStats(): Promise<SinkHitlStats> {
  const stats = await supabaseRpc<SinkHitlStats>('sink_hitl_get_stats', {});
  return {
    totalPairs: Number(stats.totalPairs ?? 0),
    totalCases: Number(stats.totalCases ?? 0),
    avgRating: Number(stats.avgRating ?? 0),
    avgDiffCount: Number(stats.avgDiffCount ?? 0),
    lastWeekPairs: Number(stats.lastWeekPairs ?? 0),
    activeRuleCount: Number(stats.activeRuleCount ?? 0),
    totalRuleCount: Number(stats.totalRuleCount ?? 0),
  };
}

// ─── pair 수 조회 (규칙 마이닝 트리거 판단용) ───

export async function getPairCount(): Promise<number> {
  const config = getConfig();
  const response = await fetchWithRetry(
    'supabase-hitl',
    supabaseUrl('sink_hitl_pairs', 'select=pair_id&limit=0'),
    {
      method: 'HEAD',
      headers: { ...supabaseHeaders(), 'Prefer': 'count=exact' },
      timeout: config.supabase.timeout,
    },
  );
  const range = response.headers.get('content-range');
  if (!range) return 0;
  const match = range.match(/\/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

// ─── ID 생성 ───

export function newPairId(): string {
  const t = Date.now().toString(36);
  const r = Math.floor(Math.random() * 0xffff).toString(36).padStart(3, '0');
  return `${t}-${r}`;
}

// ─── Row → Domain 변환 ───

function rowToDesign(row: Record<string, unknown>): SinkDesign {
  return {
    id: row.id as string,
    timestamp: (row.created_at as string) ?? new Date().toISOString(),
    version: (row.version as string) ?? 'v1',
    env: row.env as SinkDesign['env'],
    lower: row.lower as SinkDesign['lower'],
    upper: row.upper as SinkDesign['upper'],
    meta: row.meta as SinkDesign['meta'],
  };
}

async function rowToPair(row: Record<string, unknown>): Promise<SinkDiffPair | null> {
  const generatedCase = await loadCase(row.generated_id as string);
  const correctedCase = await loadCase(row.corrected_id as string);
  if (!generatedCase || !correctedCase) return null;

  return {
    pair_id: row.pair_id as string,
    timestamp: (row.created_at as string) ?? new Date().toISOString(),
    generated: generatedCase,
    corrected: correctedCase,
    diffs: (row.diffs as SinkDiffOp[]) ?? [],
    rating: row.rating as number,
    comment: (row.comment as string) ?? undefined,
  };
}
