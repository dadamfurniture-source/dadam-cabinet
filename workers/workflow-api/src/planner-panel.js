/**
 * 간편 플래너 — 여러 업체 공통 줄 (DB 0069 · 2026-11-17 사장님 결정)
 *
 * 「자주 쓴 구성」 카드는 내 설계 줄을 따라 고른다 (플래너 js/genome-lite.js — 원론 = 유전체 임퓨테이션). 여기는 그 참조에 더할
 * **다른 업체의 줄**을 모으고 내려준다. 사장님이 정하신 것:
 *   넘어가는 것은 모듈 구성만 (고객 · 설계 이름 · 메모 · 사진 · 가격 · 어느 업체인지 없음) ·
 *   **나를 빼고 3곳 이상**의 업체에서 나온 줄만 · **프로젝트에 이어진 설계만** 센다 ·
 *   업체가 모이기 전에는 **본사가 고른 설계(씨앗)** 를 모든 업체의 첫 재료로 쓴다. 근거 문장은 약관 제11조.
 *
 *   PUT  /planner/drafts/:id/learn 의 genome   → planner_draft_genome (saveDraftGenome — 학습 묶음과 같이 오지만 따로 둔다)
 *   GET  /planner/panel?item=                  → { pop: [{k, fx, cells:[{l, r, w}], w, seed}] }
 *   POST /hq/planner-panel/rebuild             → { lines, seeds, companies, designs }   지금 다시 묶기 (본사 대표 · 실장)
 *   GET  /hq/planner-seeds                     → { seeds: [설계 id…] }
 *   PUT | DELETE /hq/planner-seeds/:id         → { seed, draft_id }   씨앗 표시 · 빼기 (다담 공장 설계만)
 *   하루 한 번 runDailyPanelRebuild (worker.js cron)
 *
 * 플래너에 내려가는 것은 줄 구성과 무게뿐이다 — 업체 id · 설계 id · 업체 수는 내려가지 않는다 (무게는 내려보내는 줄들 안의 몫으로 바꾼다).
 * 줄 열쇠 = 설비장 차례 + 칸마다 시작 쪽 · 끝 쪽 특수 모듈 (칸 폭은 열쇠에 넣지 않는다 — 폭만 다른 줄은 같은 구성이다).
 * 0069 적용 전이면 409 db_pending (플래너는 내 설계 카드만 낸다). 줄 유전체 받기는 표가 없으면 그 부분만 건너뛴다.
 */

import {
  ConflictError,
  NotFoundError,
  ValidationError,
  hqCompanyId,
  insertMany,
  insertOneIgnoreConflict,
  restDelete,
  selectMany,
  selectOne,
  upsertOne,
} from './supabase.js';
import { isMissingRelation } from './work-order-data.js';
import { DRAFT_ID_RE, isProbeId, isRequestCopyId, plannerCompanyOf } from './planner-drafts.js';
import { assertPlatformMoney } from './hq-companies.js';

/** 나를 빼고 이만큼의 업체가 쓴 줄만 내려준다 (사장님 2026-11-01 「3곳 이상」 · 2026-11-17 「나 빼고」) */
export const PANEL_MIN_COMPANIES = 3;
const KINDS = ['floor', 'upper'];
/** 줄을 가르는 설비장 종류 — 플래너 js/suggest.js ANCHORED 와 같다 */
const FX = ['sink', 'cooktop', 'hood'];
const LIB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,60}$/;
const ITEM_RE = /^[a-z_]{1,40}$/;
const LINES_MAX = 24;
const FX_MAX = 8;
const CELL_IDS_MAX = 20;
const ROW_LIMIT = '5000';
/** 한 번에 내려주는 줄 수 (플래너 recommend comps 와 같은 크기) */
const POP_MAX = 80;

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function dbPending() {
  const err = new ConflictError('DB 0069 적용 전입니다');
  err.code = 'db_pending';
  return err;
}
async function guard(job) {
  try {
    return await job();
  } catch (e) {
    if (isMissingRelation(e)) throw dbPending();
    throw e;
  }
}

const idsOf = (a) =>
  Array.isArray(a) &&
  a.length <= CELL_IDS_MAX &&
  a.every((x) => typeof x === 'string' && LIB_ID_RE.test(x))
    ? a.slice()
    : null;

/**
 * 줄 유전체 — 보낸 값을 그대로 두지 않고 아는 칸만 다시 짓는다. 모양이 아니면 null.
 *   [{ k: 'floor'|'upper', fx: [설비 종류…], cells: [{ l: [모듈 id…], r: [모듈 id…], w: 칸 폭 }] }]  (칸 수 = 설비장 수 + 1)
 */
export function genomeLinesOf(v) {
  if (!Array.isArray(v) || v.length > LINES_MAX) return null;
  const out = [];
  for (const ln of v) {
    if (!isObject(ln) || !KINDS.includes(ln.k)) return null;
    if (!Array.isArray(ln.fx) || ln.fx.length > FX_MAX || !ln.fx.every((f) => FX.includes(f)))
      return null;
    if (!Array.isArray(ln.cells) || ln.cells.length !== ln.fx.length + 1) return null;
    const cells = [];
    for (const c of ln.cells) {
      if (!isObject(c)) return null;
      const l = idsOf(c.l);
      const r = idsOf(c.r);
      if (!l || !r) return null;
      cells.push({
        l,
        r,
        w: Number.isFinite(c.w) && c.w >= 0 && c.w < 100000 ? Math.round(c.w) : 0,
      });
    }
    out.push({ k: ln.k, fx: ln.fx.slice(), cells });
  }
  return out;
}

/** 줄 열쇠 — 설비장 차례 + 칸마다 시작 쪽 · 끝 쪽 특수 모듈 */
export const lineKeyOf = (ln) =>
  `${ln.fx.join(',')}#${ln.cells.map((c) => `${c.l.join('+')}/${c.r.join('+')}`).join('|')}`;
const hasSpecial = (ln) => ln.cells.some((c) => c.l.length || c.r.length);
const median = (a) => {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return s.length % 2
    ? s[(s.length - 1) / 2]
    : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

// ── 줄 유전체 받기 ─────────────────────────────────────────

/**
 * 설계의 줄 유전체를 적는다 (학습 묶음 받기에서 부른다). 모양이 아니거나 0069 적용 전이면 false — 묶음 받기는 그대로다.
 * @returns {Promise<boolean>} 적었나
 */
export async function saveDraftGenome(env, { companyId, draftId, rev, item, genome }) {
  const lines = genomeLinesOf(genome);
  if (!lines || !ITEM_RE.test(String(item || ''))) return false;
  try {
    await upsertOne(
      env,
      'planner_draft_genome',
      {
        company_id: companyId,
        draft_id: draftId,
        rev,
        item,
        lines,
        updated_at: new Date().toISOString(),
      },
      'company_id,draft_id'
    );
    return true;
  } catch (e) {
    if (isMissingRelation(e)) return false;
    throw e;
  }
}

// ── 공통 줄 내려주기 ───────────────────────────────────────

/** GET /planner/panel?item= — 나를 빼고 3곳 이상이 쓴 줄 + 씨앗 줄. 업체 · 설계 id · 업체 수는 내려가지 않는다 */
export async function panelOf(env, { user, query }) {
  const { company } = await plannerCompanyOf(env, user);
  const item =
    query && typeof query.item === 'string' && ITEM_RE.test(query.item) ? query.item : null;
  if (!item) throw new ValidationError('item 이 필요합니다', { field: 'item' });
  return guard(async () => {
    const rows =
      (await selectMany(env, 'planner_genome_panel', {
        item: `eq.${item}`,
        select: 'kind,line_key,line,company_ids,seed',
        limit: '500',
      })) || [];
    const byKey = new Map();
    for (const r of rows) {
      const ids = Array.isArray(r.company_ids) ? r.company_ids : [];
      const others = ids.filter((id) => id !== company.id).length; // 나를 빼고
      const lines = isObject(r.line)
        ? genomeLinesOf([{ k: r.kind, fx: r.line.fx, cells: r.line.cells }])
        : null;
      if (!lines) continue;
      const key = `${r.kind}\n${lineKeyOf(lines[0])}`;
      if (r.seed === true) {
        // 씨앗 — 3곳 규칙과 따로. 내가 고른 업체(다담 공장) 자신이면 내 설계라 내려주지 않는다. 같은 줄이 공통 줄로도 있으면 그쪽을 쓴다
        if (others >= 1 && !byKey.has(key)) byKey.set(key, { ...lines[0], w: 1, seed: true });
      } else if (others >= PANEL_MIN_COMPANIES) {
        byKey.set(key, { ...lines[0], w: others, seed: false });
      }
    }
    const pop = [...byKey.values()].sort((a, b) => b.w - a.w).slice(0, POP_MAX);
    // 무게는 내려보내는 줄들 안의 몫으로 — 업체 수 그대로는 내려보내지 않는다
    const total = pop.reduce((s, p) => s + p.w, 0);
    return {
      pop: pop.map((p) => ({ ...p, w: total ? Math.round((1000 * p.w) / total) / 1000 : 0 })),
    };
  });
}

// ── 다시 묶기 ──────────────────────────────────────────────

/**
 * 줄 유전체에서 공통 줄을 다시 묶는다 (표를 비우고 채운다).
 *   세는 설계: 프로젝트에 이어진 것 (designs.source = planner-lite · source_ref = 설계 id · project_id 있음), 버린 설계 · 시험 설계(probe-) ·
 *   제작 의뢰로 받은 사본(pr-) 은 뺀다. 한 설계에 같은 줄이 여러 벽에 있어도 한 번, 업체마다 한 번.
 *   공통 줄 = 3곳 이상 (업체 수 · 칸 폭 가운데값). 씨앗 = 본사가 고른 설계의 줄 (프로젝트에 이어지지 않아도 — 줄 열쇠 앞에 seed: 를 붙여 따로 둔다).
 * @returns {Promise<{lines:number, seeds:number, companies:number, designs:number}>}
 */
export async function runPanelRebuild(env) {
  return guard(async () => {
    const [genomes, discarded, linked, seeds] = await Promise.all([
      selectMany(env, 'planner_draft_genome', {
        select: 'company_id,draft_id,item,lines',
        limit: ROW_LIMIT,
      }),
      selectMany(env, 'planner_drafts', {
        discarded_at: 'not.is.null',
        select: 'company_id,id',
        limit: ROW_LIMIT,
      }),
      selectMany(env, 'designs', {
        source: 'eq.planner-lite',
        project_id: 'not.is.null',
        select: 'company_id,source_ref',
        limit: ROW_LIMIT,
      }),
      selectMany(env, 'planner_genome_seeds', { select: 'company_id,draft_id', limit: ROW_LIMIT }),
    ]);
    const dk = (c, d) => `${c}|${d}`;
    const gone = new Set((discarded || []).map((r) => dk(r.company_id, r.id)));
    const inProject = new Set((linked || []).map((r) => dk(r.company_id, r.source_ref)));
    const seedSet = new Set((seeds || []).map((r) => dk(r.company_id, r.draft_id)));
    const groups = new Map();
    const companies = new Set();
    let designs = 0;
    for (const g of genomes || []) {
      const key = dk(g.company_id, g.draft_id);
      if (isProbeId(g.draft_id) || isRequestCopyId(g.draft_id) || gone.has(key)) continue;
      const counted = inProject.has(key);
      const seed = seedSet.has(key);
      if (!counted && !seed) continue;
      if (!ITEM_RE.test(String(g.item || ''))) continue;
      const lines = genomeLinesOf(g.lines);
      if (!lines) continue;
      if (counted) {
        designs += 1;
        companies.add(g.company_id);
      }
      const seen = new Set();
      for (const ln of lines) {
        if (!hasSpecial(ln)) continue; // 특수 모듈이 없는 줄은 「빈 폭 채우기」와 같다
        const lk = lineKeyOf(ln);
        if (seen.has(`${ln.k}\n${lk}`)) continue;
        seen.add(`${ln.k}\n${lk}`);
        for (const asSeed of [false, true]) {
          if (asSeed ? !seed : !counted) continue;
          const gk = `${g.item}\n${ln.k}\n${asSeed ? 'seed:' : ''}${lk}`;
          let cur = groups.get(gk);
          if (!cur) {
            cur = {
              item: g.item,
              kind: ln.k,
              line_key: `${asSeed ? 'seed:' : ''}${lk}`,
              fx: ln.fx,
              cells: ln.cells.map((c) => ({ l: c.l, r: c.r, ws: [] })),
              companies: new Set(),
              seed: asSeed,
            };
            groups.set(gk, cur);
          }
          cur.companies.add(g.company_id);
          ln.cells.forEach((c, i) => cur.cells[i].ws.push(c.w));
        }
      }
    }
    const builtAt = new Date().toISOString();
    const rows = [...groups.values()]
      .filter((x) => x.seed || x.companies.size >= PANEL_MIN_COMPANIES)
      .filter((x) => x.line_key.length <= 2000)
      .map((x) => ({
        item: x.item,
        kind: x.kind,
        line_key: x.line_key,
        line: { fx: x.fx, cells: x.cells.map((c) => ({ l: c.l, r: c.r, w: median(c.ws) })) },
        company_ids: [...x.companies],
        n: x.companies.size,
        seed: x.seed,
        built_at: builtAt,
      }));
    await restDelete(env, 'planner_genome_panel', { item: 'not.is.null' });
    if (rows.length) await insertMany(env, 'planner_genome_panel', rows);
    return {
      lines: rows.filter((r) => !r.seed).length,
      seeds: rows.filter((r) => r.seed).length,
      companies: companies.size,
      designs,
    };
  });
}

/** POST /hq/planner-panel/rebuild — 지금 다시 묶기 (본사 대표 · 실장) */
export async function rebuildPanel(env, { user }) {
  await assertPlatformMoney(env, user);
  return runPanelRebuild(env);
}

/** 하루 한 번 (cron) — 던지지 않는다 (0069 적용 전이면 조용히 지나간다) */
export async function runDailyPanelRebuild(env) {
  try {
    return await runPanelRebuild(env);
  } catch (e) {
    if (!(e && e.code === 'db_pending'))
      console.error('planner panel rebuild failed', e && e.message);
    return null;
  }
}

// ── 씨앗 (본사가 고른 설계) ────────────────────────────────

async function seedDraftOf(env, params) {
  const id = String((params && params.id) || '');
  if (!DRAFT_ID_RE.test(id) || isProbeId(id) || isRequestCopyId(id))
    throw new ValidationError('설계 id 형식이 아닙니다', { field: 'id' });
  const hq = await hqCompanyId(env);
  return { id, hq };
}

/** GET /hq/planner-seeds — 씨앗으로 고른 설계 id */
export async function listSeeds(env, { user }) {
  await assertPlatformMoney(env, user);
  return guard(async () => {
    const rows =
      (await selectMany(env, 'planner_genome_seeds', {
        select: 'draft_id,created_at',
        order: 'created_at.desc',
        limit: '500',
      })) || [];
    return { seeds: rows.map((r) => r.draft_id) };
  });
}

/** PUT /hq/planner-seeds/:id — 다담 공장 설계를 씨앗으로 (이미 씨앗이면 그대로) */
export async function putSeed(env, { user, params }) {
  await assertPlatformMoney(env, user);
  const { id, hq } = await seedDraftOf(env, params);
  return guard(async () => {
    const draft = await selectOne(env, 'planner_drafts', {
      company_id: `eq.${hq}`,
      id: `eq.${id}`,
      select: 'id,discarded_at',
    });
    if (!draft || draft.discarded_at) throw new NotFoundError('다담 공장의 그 설계가 없습니다');
    await insertOneIgnoreConflict(env, 'planner_genome_seeds', {
      company_id: hq,
      draft_id: id,
      marked_by: user.id,
    });
    return { seed: true, draft_id: id };
  });
}

/** DELETE /hq/planner-seeds/:id — 씨앗 표시를 뺀다 */
export async function deleteSeed(env, { user, params }) {
  await assertPlatformMoney(env, user);
  const { id, hq } = await seedDraftOf(env, params);
  return guard(async () => {
    await restDelete(env, 'planner_genome_seeds', { company_id: `eq.${hq}`, draft_id: `eq.${id}` });
    return { seed: false, draft_id: id };
  });
}
