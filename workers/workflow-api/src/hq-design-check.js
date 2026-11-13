/**
 * 다담 본사 › 설계 · 학습 점검 — 간편 플래너 웹판 설계가 저장되고, 학습 자료로 모이고, 검토되는 길을 본사가 본다 (DB 0067).
 *
 *   GET  /hq/design-check            한눈에 — 업체별 저장 · 가는 길의 수 · 지난 7일 실패 · 점검 기록 · 마지막 수집
 *   GET  /hq/design-check/reviews    검토 줄 (?state=waiting 기다림 | done 검토함) — 설계 구성 · 장소(시 · 군 · 구까지) · 사진(1시간짜리 주소)
 *   POST /hq/design-check/reviews    { company_id, draft_id, grade, reasons } 검토 — 양질 good · 보통 normal · 제외 exclude
 *   POST /hq/design-check/run        지금 점검 — 시험 설계 하나로 저장 → 읽기 → 학습 묶음 → 수집 → 내보내기 막힘
 *   cron runDailyDesignCheck         매일 07:00 한 번 — 막힌 날만 본사 대표 · 실장에게 알림, 30일 지난 실패 기록 지우기
 *
 * 보는 사람 · 쓰는 사람: 다담 본사(platform) active 대표 · 실장 (hq-companies.js assertPlatformMoney). 아니면 403 not_platform.
 * 검토는 dataset_reviews 에 그 묶음의 표본마다 한 줄 — DB 지킴이가 표본에 반영한다 (제외 = reject, 등급 · 까닭 · 본 rev 는 attrs).
 *   설계 이름은 검토 화면에만 싣는다 (학습 자료에는 들어가지 않는다 — dataset-api planner-web.js). 주소는 시 · 군 · 구까지만.
 * 점검용 시험 설계(probe-selfcheck)는 다담 공장에 하나만 둔다 — 지우지 못하므로(0046) 같은 줄을 고쳐 쓴다.
 *   목록 · 수 · 추천에 안 보이고(planner-drafts.js isProbeId) 학습 자료에도 안 들어간다(dataset-api) — 「내보내기 막힘」이 정상이다.
 * 0067 적용 전이면 화면 길은 409 db_pending, 매일 점검은 조용히 건너뛴다.
 */

import {
  ConflictError,
  MONEY_ROLES,
  NotFoundError,
  ValidationError,
  hqCompanyId,
  insertMany,
  insertOne,
  platformCompanyId,
  restDelete,
  selectMany,
  selectOne,
} from './supabase.js';
import { isMissingRelation } from './work-order-data.js';
import { createSignedUrls } from './storage.js';
import { assertPlatformMoney } from './hq-companies.js';
import { DRAFT_ID_RE, PHOTOS_BUCKET, isProbeId, saveDraftIn } from './planner-drafts.js';
import { PHOTO_CONSENT_KIND, putLearnIn } from './planner-learn.js';
import { notifyRoles } from './push/outbox.js';
import { buildMessage } from './push/messages.js';

export const CHECK_KIND = 'planner_learning';
export const PROBE_DRAFT_ID = 'probe-selfcheck';
/** 매일 점검 — 07:00 KST (UTC 22:00) */
export const DAILY_CHECK_UTC = Object.freeze({ hour: 22, minute: 0 });
export const REVIEW_GRADES = Object.freeze(['good', 'normal', 'exclude']);
export const REVIEW_REASONS = Object.freeze(['dimension', 'incomplete', 'photo_blur', 'test']);
/** dataset-api planner-web.js 가 쓰는 원본 표 이름 · 묶음 키 머리 */
export const WEB_SRC_TABLE = 'planner_drafts';
const GROUP_RE = /^planner-web:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([A-Za-z0-9][A-Za-z0-9-]{3,80})$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ISSUE_KEEP_DAYS = 30;
/** 수집(10분마다)이 이만큼 안 돌았거나, 묶음이 이만큼 수집을 기다리면 막힌 것으로 본다 (분) */
export const INGEST_STALE_MIN = 30;
export const REVIEW_LIST_MAX = 30;
const ROW_LIMIT = '5000';
const DAY_MS = 86400 * 1000;

function dbPending() {
  const err = new ConflictError('DB 0067 적용 전입니다');
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

export const webGroupKey = (companyId, draftId) => `planner-web:${companyId}:${draftId}`;
/** 묶음 키 → { companyId, draftId } (웹판 묶음이 아니면 null) */
export function groupOf(groupKey) {
  const m = GROUP_RE.exec(String(groupKey || ''));
  return m ? { companyId: m[1].toLowerCase(), draftId: m[2] } : null;
}

/** 주소 → 시 · 군 · 구까지 (앞 두 마디). 그 뒤(동 · 번지 · 건물)는 싣지 않는다 */
export function regionOf(address) {
  const parts = String(address || '').trim().split(/\s+/).filter(Boolean);
  return parts.length >= 2 ? parts.slice(0, 2).join(' ') : '';
}

/** 날짜 (KST) — YYYY-MM-DD */
export function kstDate(ms) {
  return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
/** 이 cron 시각이 매일 점검하는 1분인가 */
export function isDailyCheckTime(ms) {
  const t = new Date(ms);
  return t.getUTCHours() === DAILY_CHECK_UTC.hour && t.getUTCMinutes() === DAILY_CHECK_UTC.minute;
}

const widthOf = (m) => {
  if (m && Number.isFinite(m.W) && m.W > 0) return Math.round(m.W);
  const tail = /-(\d{3,4})(?:-[A-Z])?$/.exec(String((m && m.libId) || ''));
  return tail ? Number(tail[1]) : null;
};
/** 설계 레코드 → 화면이 그릴 구성 — 공간마다 길이 · 줄마다 모듈(id · 폭). 그림용 요약이다 (치수 규칙 아님) */
export function compositionOf(record) {
  const walls = record && record.design && Array.isArray(record.design.walls) ? record.design.walls : [];
  return walls.slice(0, 6).map((w) => ({
    name: typeof w.name === 'string' ? w.name.slice(0, 20) : '',
    length: Number.isFinite(w.length) ? Math.round(w.length) : null,
    lines: Object.fromEntries(
      Object.entries((w && w.lines) || {})
        .filter(([, list]) => Array.isArray(list) && list.length)
        .slice(0, 5)
        .map(([k, list]) => [
          k,
          list.slice(0, 30).map((m) => ({ id: typeof (m && m.libId) === 'string' ? m.libId.slice(0, 40) : '', w: widthOf(m) })),
        ])
    ),
  }));
}

const inList = (ids) => `in.(${ids.map((id) => `"${id}"`).join(',')})`;
const chunks = (list, n) => {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
};

// ── 한눈에 ─────────────────────────────────────────────────

/** GET /hq/design-check */
export async function designCheckSummary(env, { user }) {
  await assertPlatformMoney(env, user);
  return guard(async () => {
    const since = new Date(Date.now() - 7 * DAY_MS).toISOString();
    const design = { src_table: `eq.${WEB_SRC_TABLE}`, image_url: 'is.null' };
    const [companies, drafts, learn, issues, consents, samples, exportable, checks, state] = await Promise.all([
      selectMany(env, 'companies', { kind: 'in.(hq,partner)', select: 'id,kind,name,plan,status', limit: ROW_LIMIT }),
      selectMany(env, 'planner_drafts', { discarded_at: 'is.null', select: 'company_id,id,updated_at', limit: ROW_LIMIT }),
      selectMany(env, 'planner_draft_learn', { select: 'company_id,draft_id,pending,ingest_error', limit: ROW_LIMIT }),
      selectMany(env, 'planner_save_issues', { created_at: `gte.${since}`, select: 'company_id,stage,code,source', limit: ROW_LIMIT }),
      selectMany(env, 'company_consents', { kind: `eq.${PHOTO_CONSENT_KIND}`, select: 'company_id,granted,created_at', order: 'created_at.asc', limit: ROW_LIMIT }),
      selectMany(env, 'dataset_samples', { ...design, select: 'sample_id,needs_review,design_id,grade:attrs->>grade', limit: ROW_LIMIT }),
      selectMany(env, 'dataset_exportable', { ...design, select: 'sample_id', limit: ROW_LIMIT }),
      selectMany(env, 'system_checks', { kind: `eq.${CHECK_KIND}`, select: 'id,cause,run_date,ok,steps,created_at', order: 'created_at.desc', limit: '8' }),
      selectMany(env, 'dataset_ingest_state', { src_table: `eq.${WEB_SRC_TABLE}`, select: 'last_run,last_count,last_error', limit: '1' }),
    ]);
    const live = (drafts || []).filter((d) => !isProbeId(d.id));
    const bundles = (learn || []).filter((l) => !isProbeId(l.draft_id));
    const consentOf = new Map();
    (consents || []).forEach((c) => consentOf.set(c.company_id, c.granted === true)); // 차례대로 — 마지막 줄이 남는다
    const by = new Map();
    const row = (id) => {
      if (!by.has(id)) by.set(id, { drafts: 0, last_saved: null, bundles: 0, pending: 0, failed: 0, issues: 0 });
      return by.get(id);
    };
    for (const d of live) {
      const r = row(d.company_id);
      r.drafts += 1;
      if (!r.last_saved || d.updated_at > r.last_saved) r.last_saved = d.updated_at;
    }
    for (const l of bundles) {
      const r = row(l.company_id);
      r.bundles += 1;
      if (l.pending === true) r.pending += 1;
      if (l.ingest_error) r.failed += 1;
    }
    const codes = new Map();
    for (const i of issues || []) {
      if (i.company_id) row(i.company_id).issues += 1;
      const key = `${i.stage}:${i.code}`;
      codes.set(key, (codes.get(key) || 0) + 1);
    }
    const list = (companies || [])
      .filter((c) => by.has(c.id) || c.kind === 'hq')
      .map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        plan: c.plan || null,
        photos: c.kind === 'hq' ? 'always' : consentOf.get(c.id) === true ? 'on' : 'off',
        ...(by.get(c.id) || { drafts: 0, last_saved: null, bundles: 0, pending: 0, failed: 0, issues: 0 }),
      }))
      .sort((a, b) => (a.kind === 'hq' ? -1 : b.kind === 'hq' ? 1 : (b.last_saved || '').localeCompare(a.last_saved || '')));
    const gradeN = (g) => (samples || []).filter((s) => s.grade === g).length;
    return {
      companies: list,
      funnel: {
        drafts: live.length,
        bundles: bundles.length,
        pending: bundles.filter((l) => l.pending === true).length,
        failed: bundles.filter((l) => l.ingest_error).length,
        samples: (samples || []).length,
        waiting: (samples || []).filter((s) => s.needs_review === true).length,
        good: gradeN('good'),
        normal: gradeN('normal'),
        exclude: gradeN('exclude'),
        linked: (samples || []).filter((s) => s.design_id).length,
        exportable: (exportable || []).length,
      },
      issues: {
        days: 7,
        total: (issues || []).length,
        by_code: [...codes.entries()]
          .map(([key, n]) => ({ stage: key.split(':')[0], code: key.split(':')[1], n }))
          .sort((a, b) => b.n - a.n)
          .slice(0, 6),
      },
      checks: (checks || []).map((c) => ({ id: c.id, cause: c.cause, run_date: c.run_date, ok: c.ok === true, steps: Array.isArray(c.steps) ? c.steps : [], created_at: c.created_at })),
      ingest: (state && state[0]) || { last_run: null, last_count: null, last_error: null },
    };
  });
}

// ── 검토 줄 ────────────────────────────────────────────────

/** GET /hq/design-check/reviews?state=waiting|done */
export async function listDesignReviews(env, { user, query }) {
  await assertPlatformMoney(env, user);
  const done = !!query && query.state === 'done';
  return guard(async () => {
    const rows =
      (await selectMany(env, 'dataset_samples', {
        src_table: `eq.${WEB_SRC_TABLE}`,
        image_url: 'is.null',
        needs_review: done ? 'is.false' : 'is.true',
        ...(done ? { label_source: 'eq.human' } : {}),
        select: 'sample_id,group_key,space,furniture,layout_shape,attrs,design_id,updated_at',
        order: 'updated_at.desc',
        limit: String(REVIEW_LIST_MAX),
      })) || [];
    const groups = rows.map((r) => ({ row: r, key: groupOf(r.group_key) })).filter((g) => g.key);
    if (!groups.length) return { state: done ? 'done' : 'waiting', items: [] };

    const companyIds = [...new Set(groups.map((g) => g.key.companyId))];
    const [companies, drafts, photos, sites] = await Promise.all([
      selectMany(env, 'companies', { id: `in.(${companyIds.join(',')})`, select: 'id,name,kind', limit: ROW_LIMIT }),
      Promise.all(
        companyIds.map((cid) =>
          selectMany(env, 'planner_drafts', {
            company_id: `eq.${cid}`,
            id: inList(groups.filter((g) => g.key.companyId === cid).map((g) => g.key.draftId)),
            select: 'company_id,id,name,item,rev,summary,updated_at,discarded_at',
            limit: ROW_LIMIT,
          })
        )
      ).then((lists) => lists.flatMap((l) => l || [])),
      Promise.all(
        chunks(groups.map((g) => g.row.group_key), 15).map((keys) =>
          selectMany(env, 'dataset_samples', {
            group_key: inList(keys),
            image_url: 'not.is.null',
            select: 'sample_id,group_key,image_url,phase,media,kind:attrs->>kind',
            limit: ROW_LIMIT,
          })
        )
      ).then((lists) => lists.flatMap((l) => l || [])),
      (() => {
        const ids = [...new Set(groups.map((g) => g.row.design_id).filter((id) => UUID_RE.test(String(id || ''))))];
        return ids.length ? selectMany(env, 'design_site_info', { design_id: `in.(${ids.join(',')})`, select: 'design_id,address', limit: ROW_LIMIT }) : [];
      })(),
    ]);
    const companyOf = new Map((companies || []).map((c) => [c.id, c]));
    const draftOf = new Map(drafts.map((d) => [webGroupKey(d.company_id, d.id), d]));
    const regionBy = new Map((sites || []).map((s) => [s.design_id, regionOf(s.address)]));
    // 사진 주소 — 비공개 버킷이라 1시간짜리 서명 주소로 (묶음 키의 업체 · 설계 자리에 있는 것만)
    const pathOf = (p) => {
      const g = groupOf(p.group_key);
      const m = /\/planner-photos\/([^?#]+)$/.exec(String(p.image_url || ''));
      const path = m ? decodeURIComponent(m[1]) : '';
      return g && path.startsWith(`${g.companyId}/${g.draftId}/`) && !path.includes('..') ? path : null;
    };
    const paths = [...new Set(photos.map(pathOf).filter(Boolean))];
    let signed = new Map();
    if (paths.length) {
      try {
        signed = await createSignedUrls(env, PHOTOS_BUCKET, paths);
      } catch {
        signed = new Map(); // 주소를 못 만들면 사진 없이 보인다
      }
    }
    const items = groups.map(({ row, key }) => {
      const d = draftOf.get(row.group_key) || null;
      const c = companyOf.get(key.companyId) || null;
      const a = row.attrs && typeof row.attrs === 'object' ? row.attrs : {};
      const comp = compositionOf(a.record);
      return {
        company_id: key.companyId,
        draft_id: key.draftId,
        company: c ? c.name : '',
        company_kind: c ? c.kind : null,
        name: d ? d.name || '' : '',
        gone: !d || !!d.discarded_at,
        item: d ? d.item : null,
        space: row.space,
        furniture: row.furniture,
        layout_shape: row.layout_shape,
        region: regionBy.get(row.design_id) || '',
        rev_now: d ? d.rev : null,
        rev_bundle: a.web && Number.isInteger(a.web.rev) ? a.web.rev : null,
        reviewed_rev: Number.isInteger(a.reviewed_rev) ? a.reviewed_rev : null,
        grade: REVIEW_GRADES.includes(a.grade) ? a.grade : null,
        reasons: Array.isArray(a.grade_reasons) ? a.grade_reasons.filter((r) => REVIEW_REASONS.includes(r)) : [],
        linked: !!row.design_id,
        completed: !!(d && d.summary && d.summary.completed === true),
        walls: comp,
        modules: comp.reduce((s, w) => s + Object.values(w.lines).reduce((n, l) => n + l.length, 0), 0),
        photos: photos
          .filter((p) => p.group_key === row.group_key)
          .map((p) => ({ url: signed.get(pathOf(p)) || null, kind: p.kind || null, phase: p.phase, media: p.media }))
          .filter((p) => p.url)
          .slice(0, 12),
        photo_count: photos.filter((p) => p.group_key === row.group_key).length,
        updated_at: row.updated_at,
      };
    });
    return { state: done ? 'done' : 'waiting', items };
  });
}

/** POST /hq/design-check/reviews { company_id, draft_id, grade, reasons } */
export async function writeDesignReview(env, { user, body }) {
  await assertPlatformMoney(env, user);
  const b = body || {};
  if (!UUID_RE.test(String(b.company_id || '')) || !DRAFT_ID_RE.test(String(b.draft_id || ''))) throw new ValidationError('설계를 찾을 수 없습니다', { field: 'draft_id' });
  if (!REVIEW_GRADES.includes(b.grade)) throw new ValidationError('등급이 필요합니다', { field: 'grade' });
  const reasons = Array.isArray(b.reasons) ? [...new Set(b.reasons)] : [];
  if (reasons.some((r) => !REVIEW_REASONS.includes(r))) throw new ValidationError('모르는 까닭입니다', { field: 'reasons' });
  if (b.grade === 'good' && reasons.length) throw new ValidationError('양질에는 까닭을 달지 않습니다', { field: 'reasons' });
  const gk = webGroupKey(String(b.company_id).toLowerCase(), b.draft_id);
  return guard(async () => {
    const samples = (await selectMany(env, 'dataset_samples', { group_key: `eq.${gk}`, src_table: `eq.${WEB_SRC_TABLE}`, select: 'sample_id,attrs', limit: '1000' })) || [];
    if (!samples.length) throw new NotFoundError('검토할 설계가 없습니다 — 아직 수집 전이거나 빠진 설계입니다');
    const design = samples.find((s) => s.sample_id === gk);
    const web = design && design.attrs && design.attrs.web;
    const srcRev = web && Number.isInteger(web.rev) && web.rev >= 1 ? web.rev : null;
    await insertMany(
      env,
      'dataset_reviews',
      samples.map((s) => ({
        sample_id: s.sample_id,
        reviewer: user.id,
        verdict: b.grade === 'exclude' ? 'reject' : 'confirm',
        grade: b.grade,
        reasons,
        src_rev: srcRev,
      }))
    );
    return { reviewed: samples.length, grade: b.grade, reasons, src_rev: srcRev };
  });
}

// ── 점검 ───────────────────────────────────────────────────

const noteOf = (e) => String((e && (e.code || e.message)) || '오류').slice(0, 120);

/**
 * 점검 걸음 — 시험 설계 하나로 길을 끝까지 가 본다. 던지지 않는다 (걸음마다 됨 · 안 됨).
 * @returns {Promise<{ok: boolean, steps: {key: string, label: string, ok: boolean, ms: number, note: string}[]}>}
 */
export async function runCheckSteps(env, { userId = null, nowMs = Date.now() } = {}) {
  const steps = [];
  const step = async (key, label, fn, skip) => {
    if (skip) {
      steps.push({ key, label, ok: false, ms: 0, note: '앞 걸음이 막혀 건너뜀' });
      return false;
    }
    const t = Date.now();
    try {
      const note = await fn();
      steps.push({ key, label, ok: true, ms: Date.now() - t, note: String(note || '').slice(0, 120) });
      return true;
    } catch (e) {
      steps.push({ key, label, ok: false, ms: Date.now() - t, note: noteOf(e) });
      return false;
    }
  };
  const stamp = new Date(nowMs).toISOString();
  let company = null;
  let rev = 0;
  const saved = await step('save', '설계 저장', async () => {
    const hq = await hqCompanyId(env);
    company = await selectOne(env, 'companies', { id: `eq.${hq}`, select: 'id,kind,name,plan,status' });
    if (!company) throw new Error('다담 공장을 찾지 못했습니다');
    const project = { format: 'dadam.planner-lite/1', id: PROBE_DRAFT_ID, name: '점검용 시험 설계', item: 'sink', walls: [], checkedAt: stamp };
    const r = await saveDraftIn(env, { company, canManage: true, userId, body: { project } }, { internal: true });
    rev = r.rev;
    return `rev ${rev}`;
  });
  const read = await step(
    'read',
    '설계 읽기',
    async () => {
      const d = await selectOne(env, 'planner_drafts', { company_id: `eq.${company.id}`, id: `eq.${PROBE_DRAFT_ID}`, select: 'rev,model' });
      if (!d || d.rev !== rev || !d.model || d.model.checkedAt !== stamp) throw new Error('방금 저장한 설계가 그대로 읽히지 않습니다');
      return `rev ${d.rev}`;
    },
    !saved
  );
  await step(
    'learn',
    '학습 묶음 받기',
    async () => {
      const r = await putLearnIn(
        env,
        { company, canManage: true, userId, params: { id: PROBE_DRAFT_ID }, body: { rev, bundle: { record: { probe: true, checkedAt: stamp }, samples: [] } } },
        { internal: true }
      );
      if (r.saved !== true) throw new Error('묶음이 저장되지 않았습니다');
      return '묶음 저장';
    },
    !saved || !read
  );
  await step('ingest', '학습 자료로 수집', async () => {
    const state = await selectMany(env, 'dataset_ingest_state', { src_table: `eq.${WEB_SRC_TABLE}`, select: 'last_run,last_error', limit: '1' });
    const s = state && state[0];
    if (!s || !s.last_run) throw new Error('수집이 아직 한 번도 돌지 않았습니다');
    const ago = Math.round((nowMs - Date.parse(s.last_run)) / 60000);
    if (!(ago <= INGEST_STALE_MIN)) throw new Error(`마지막 수집이 ${ago}분 전입니다`);
    const stuckBefore = new Date(nowMs - INGEST_STALE_MIN * 60000).toISOString();
    const stuck = (await selectMany(env, 'planner_draft_learn', { pending: 'is.true', updated_at: `lt.${stuckBefore}`, select: 'draft_id', limit: '200' })) || [];
    const waiting = stuck.filter((r) => !isProbeId(r.draft_id)).length;
    if (waiting) throw new Error(`${INGEST_STALE_MIN}분 넘게 수집을 기다리는 묶음 ${waiting}개`);
    return s.last_error ? `마지막 수집 ${ago}분 전 · 일부 묶음 오류` : `마지막 수집 ${ago}분 전`;
  });
  await step(
    'export_block',
    '시험 설계는 내보내기에서 막힘',
    async () => {
      const gk = webGroupKey(company.id, PROBE_DRAFT_ID);
      const rows = (await selectMany(env, 'dataset_samples', { group_key: `eq.${gk}`, select: 'sample_id', limit: '1' })) || [];
      if (rows.length) throw new Error('시험 설계가 학습 자료에 들어가 있습니다');
      return '학습 자료에 없음 (정상)';
    },
    !company
  );
  return { ok: steps.every((s) => s.ok), steps };
}

/** POST /hq/design-check/run — 사람이 누른 점검 (기록 한 줄) */
export async function runDesignCheck(env, { user }) {
  await assertPlatformMoney(env, user);
  return guard(async () => {
    const nowMs = Date.now();
    // 표가 있는지 먼저 — 없으면 걸음을 밟지 않고 409 db_pending
    await selectMany(env, 'system_checks', { kind: `eq.${CHECK_KIND}`, select: 'id', limit: '1' });
    const r = await runCheckSteps(env, { userId: user.id, nowMs });
    const row = await insertOne(env, 'system_checks', { kind: CHECK_KIND, cause: 'manual', run_date: kstDate(nowMs), ok: r.ok, steps: r.steps, run_by: user.id });
    return { id: row ? row.id : null, ok: r.ok, steps: r.steps, created_at: row ? row.created_at : new Date(nowMs).toISOString() };
  });
}

/**
 * 매일 점검 (cron — 매분 불리고 07:00 KST 한 번만 돈다). 던지지 않는다.
 *   기록은 날마다 한 줄 (DB 부분 유니크) — 같은 날 두 번 돌아도 알림은 한 번. 막힌 날만 본사 대표 · 실장에게 알린다.
 *   같이: 30일 지난 저장 실패 기록 지우기.
 */
export async function runDailyDesignCheck(env, { nowMs } = {}) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  if (!isDailyCheckTime(now)) return { ran: false };
  try {
    const runDate = kstDate(now);
    const had = await selectMany(env, 'system_checks', { kind: `eq.${CHECK_KIND}`, cause: 'eq.daily', run_date: `eq.${runDate}`, select: 'id', limit: '1' });
    if (had && had.length) return { ran: false, dup: true };
    const r = await runCheckSteps(env, { userId: null, nowMs: now });
    let row = null;
    try {
      row = await insertOne(env, 'system_checks', { kind: CHECK_KIND, cause: 'daily', run_date: runDate, ok: r.ok, steps: r.steps });
    } catch (e) {
      if (e instanceof ConflictError) return { ran: false, dup: true };
      throw e;
    }
    try {
      await restDelete(env, 'planner_save_issues', { created_at: `lt.${new Date(now - ISSUE_KEEP_DAYS * DAY_MS).toISOString()}` });
    } catch (e) {
      console.warn('design check: issue cleanup failed', e && e.statusCode ? e.statusCode : 'error');
    }
    if (!r.ok) {
      const m = buildMessage('system_check_failed', { failed: r.steps.filter((s) => !s.ok).length });
      if (m) await notifyRoles(env, { companyId: await platformCompanyId(env), roles: MONEY_ROLES, kind: 'system_check_failed', ...m, refId: row ? row.id : null });
    }
    return { ran: true, ok: r.ok };
  } catch (e) {
    if (!isMissingRelation(e)) console.error('design check failed:', e && e.statusCode ? e.statusCode : 'error');
    return { ran: false, error: true };
  }
}
