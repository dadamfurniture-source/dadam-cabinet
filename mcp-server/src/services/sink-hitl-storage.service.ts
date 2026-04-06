// ═══════════════════════════════════════════════════════════════
// Sink HITL Storage - 파일 기반 CRUD (docs/design-rules/sink-hitl/)
// Phase 1-2: 파일시스템, Phase 3+: Supabase로 이관 가능
// ═══════════════════════════════════════════════════════════════

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SinkDesign, SinkDiffPair } from '../schemas/sink-hitl.schemas.js';

// ─── 루트 경로 해석 ───
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// mcp-server/src/services → 프로젝트 루트까지 3단계 상위
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const DATA_DIR = path.join(ROOT_DIR, 'docs', 'design-rules', 'sink-hitl');

export const sinkHitlPaths = {
  root: DATA_DIR,
  cases: path.join(DATA_DIR, 'cases'),
  pairs: path.join(DATA_DIR, 'pairs'),
  rules: path.join(DATA_DIR, 'rules'),
  metrics: path.join(DATA_DIR, 'metrics'),
};

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

// ─── Case CRUD ───

export async function saveCase(design: SinkDesign): Promise<string> {
  await ensureDir(sinkHitlPaths.cases);
  const filename = `case-${design.id}.json`;
  const filepath = path.join(sinkHitlPaths.cases, filename);
  await fs.writeFile(filepath, JSON.stringify(design, null, 2), 'utf8');
  return filepath;
}

export async function loadCase(id: string): Promise<SinkDesign | null> {
  const filepath = path.join(sinkHitlPaths.cases, `case-${id}.json`);
  try {
    const raw = await fs.readFile(filepath, 'utf8');
    return JSON.parse(raw) as SinkDesign;
  } catch {
    return null;
  }
}

export async function listCases(): Promise<string[]> {
  await ensureDir(sinkHitlPaths.cases);
  const files = await fs.readdir(sinkHitlPaths.cases);
  return files.filter(f => f.startsWith('case-') && f.endsWith('.json'));
}

// ─── Pair CRUD ───

export async function savePair(pair: SinkDiffPair): Promise<string> {
  await ensureDir(sinkHitlPaths.pairs);
  const filename = `pair-${pair.pair_id}.json`;
  const filepath = path.join(sinkHitlPaths.pairs, filename);
  await fs.writeFile(filepath, JSON.stringify(pair, null, 2), 'utf8');
  return filepath;
}

export async function loadPair(pairId: string): Promise<SinkDiffPair | null> {
  const filepath = path.join(sinkHitlPaths.pairs, `pair-${pairId}.json`);
  try {
    const raw = await fs.readFile(filepath, 'utf8');
    return JSON.parse(raw) as SinkDiffPair;
  } catch {
    return null;
  }
}

export async function listPairs(): Promise<SinkDiffPair[]> {
  await ensureDir(sinkHitlPaths.pairs);
  const files = await fs.readdir(sinkHitlPaths.pairs);
  const pairs: SinkDiffPair[] = [];
  for (const f of files) {
    if (!f.startsWith('pair-') || !f.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(sinkHitlPaths.pairs, f), 'utf8');
      pairs.push(JSON.parse(raw) as SinkDiffPair);
    } catch {
      /* skip corrupted */
    }
  }
  return pairs;
}

// ─── 통계 ───

export interface SinkHitlStats {
  totalPairs: number;
  totalCases: number;
  avgRating: number;
  avgDiffCount: number;
  lastWeekPairs: number;
}

export async function getStats(): Promise<SinkHitlStats> {
  const pairs = await listPairs();
  const cases = await listCases();

  const now = Date.now();
  const weekAgo = now - 7 * 24 * 3600 * 1000;

  let ratingSum = 0;
  let diffSum = 0;
  let lastWeek = 0;
  for (const p of pairs) {
    ratingSum += p.rating;
    diffSum += p.diffs.length;
    if (new Date(p.timestamp).getTime() >= weekAgo) lastWeek += 1;
  }

  return {
    totalPairs: pairs.length,
    totalCases: cases.length,
    avgRating: pairs.length ? ratingSum / pairs.length : 0,
    avgDiffCount: pairs.length ? diffSum / pairs.length : 0,
    lastWeekPairs: lastWeek,
  };
}

// ─── ID 생성 ───

export function newPairId(): string {
  const t = Date.now().toString(36);
  const r = Math.floor(Math.random() * 0xffff).toString(36).padStart(3, '0');
  return `${t}-${r}`;
}
