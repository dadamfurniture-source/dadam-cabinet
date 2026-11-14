/**
 * 간편 플래너 웹판 — 학습 묶음 받기 · 저장 실패 기록 · 사진 제공 동의 (DB 0067)
 *
 * 설계 저장(POST /planner/drafts, src/planner-drafts.js)과 따로 도는 길이다. 여기가 안 돼도 설계 저장은 그대로다.
 *
 *   PUT  /planner/drafts/:id/learn   { rev, bundle } → { saved, rev }     그 설계의 학습 묶음 (플래너가 저장한 뒤 보낸다)
 *   POST /planner/drafts/report      { stage, code, status?, draftId?, rev? } → { ok }   화면이 본 실패
 *   GET  /planner/photo-consent      → { granted, fixed, at, can_change, terms }
 *   PUT  /planner/photo-consent      { granted, terms_version } → 같은 모양 (팩토리 대표만)
 *   POST /planner/signals            { kind, item, line, cards, draftId?, pick?, placed?, missed?, by? } → { ok }   자주 쓴 구성 카드가 쓰였나
 *
 * 묶음은 플래너 server/dataset-export.js designPayload 의 { record, samples } 모양 — 여기서는 크기 · 모양만 보고 그대로 둔다.
 *   무엇을 학습 자료로 쓸지(검토 필요 · 사용 범위 · 사진 동의)는 수집하는 쪽(dataset-api)이 정한다. 보낸 값을 믿지 않는다.
 * 실패 기록에는 글을 적지 않는다 (단계 · 코드 · 상태뿐 — 설계 이름 · 고객 정보가 섞이지 않게).
 * 화면 신호(카드를 보임 · 누름 · 지나침)도 글 칸이 없다 — 모듈 구성(조각)과 수뿐이고, 보낸 값을 그대로 넣지 않고 아는 칸만 다시 짓는다.
 * 사진 제공: 다담 공장 것은 늘 제공, 협력업체는 대표가 켠 뒤에만. 기록은 쌓기만 하고 지금 값은 마지막 줄이다.
 * 0067 적용 전이면 409 db_pending.
 */

import {
  AuthError,
  ConflictError,
  DbError,
  ForbiddenError,
  NotFoundError,
  TooLargeError,
  ValidationError,
  insertOne,
  selectMany,
  selectOne,
  updateBy,
} from './supabase.js';
import { isMissingRelation } from './work-order-data.js';
import { DRAFT_ID_RE, isProbeId, plannerCompanyOf, stableJson } from './planner-drafts.js';

/** 묶음 한 벌 (DB 0067 bundle 상한과 같다) · 설계 레코드 (dataset-api planner.js RECORD_MAX 와 같다) · 사진 표본 수 */
export const LEARN_MAX_BYTES = 1024 * 1024;
export const LEARN_RECORD_MAX_BYTES = 512 * 1024;
export const LEARN_SAMPLES_MAX = 300;
export const ISSUE_STAGES = Object.freeze(['save', 'learn', 'photo', 'open']);
export const ISSUE_CODE_RE = /^[a-z0-9_]{1,40}$/;
/** 한 사람이 한 시간에 남길 수 있는 화면 실패 기록 — 넘으면 받되 적지 않는다 */
export const REPORTS_PER_HOUR = 60;
export const PHOTO_CONSENT_KIND = 'planner_photo_learning';
/** 사진 제공 동의 글 — 화면은 이 글을 그대로 보인다 (글을 바꾸면 version 도 바꾼다) */
export const PHOTO_CONSENT_TERMS = Object.freeze({
  version: '2026-11-14',
  text:
    '이 팩토리가 플래너에 올린 현장사진 · 시공 완료 사진을 SEGAN 운영사가 설계 품질 검토와 AI 학습 자료로 쓰도록 제공합니다. ' +
    '고객 이름 · 주소 · 연락처는 제공하지 않고, 사진의 촬영 위치 정보는 올릴 때 지워집니다. ' +
    '고객에게 사진 활용을 알리고 허락받은 사진만 올려 주세요. 사람 얼굴이나 고객을 알아볼 수 있는 것이 찍힌 사진은 올리지 마세요. ' +
    '제공은 언제든 끌 수 있고, 끄면 새로 제공하지 않으며 이미 제공한 사진도 학습 자료에서 뺍니다.',
});

const enc = new TextEncoder();
const bytesOf = (v) => enc.encode(JSON.stringify(v)).length;
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

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

/** 묶음 지문 — 키 차례를 맞춘 JSON 의 SHA-256 (DB 가 키 차례를 바꿔도 같은 묶음은 같은 지문) */
export async function bundleSha256(bundle) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(stableJson(bundle)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 묶음 모양 · 크기 — { record: 객체, samples: 객체 배열 } */
export function bundleOf(body) {
  const bundle = body && body.bundle;
  if (!isObject(bundle) || !isObject(bundle.record)) throw new ValidationError('bundle.record 가 필요합니다', { field: 'bundle' });
  const samples = bundle.samples === undefined ? [] : bundle.samples;
  if (!Array.isArray(samples) || samples.length > LEARN_SAMPLES_MAX || samples.some((s) => !isObject(s))) {
    throw new ValidationError('bundle.samples 는 객체 배열이어야 합니다', { field: 'bundle' });
  }
  if (bytesOf(bundle.record) > LEARN_RECORD_MAX_BYTES) throw new TooLargeError('설계 레코드가 너무 큽니다');
  const out = { record: bundle.record, samples };
  if (bytesOf(out) > LEARN_MAX_BYTES) throw new TooLargeError('학습 묶음이 너무 큽니다');
  return out;
}

/**
 * PUT /planner/drafts/:id/learn { rev, bundle }
 *   saved false 인 때: stale (더 새 묶음이 이미 있다 · 설계가 그 뒤에 또 저장됐다) · same (같은 묶음)
 * @param {{internal?: boolean}} [opts] internal — 본사 점검이 쓰는 시험 설계(probe-)도 받는다
 */
export async function putLearn(env, { user, params, body }, opts = {}) {
  const { company, canManage } = await plannerCompanyOf(env, user);
  return putLearnIn(env, { company, canManage, userId: user.id, params, body }, opts);
}

/**
 * 묶음 받기의 속 — 업체를 직접 받는다 (본사 점검은 사람 없이 — userId null).
 * @param {{company: {id: string}, canManage: boolean, userId: string|null, params: object, body: object}} o
 */
export async function putLearnIn(env, { company, canManage, userId, params, body }, opts = {}) {
  const user = { id: userId || null };
  const id = String((params && params.id) || '');
  if (!DRAFT_ID_RE.test(id)) throw new ValidationError('설계 id 형식이 아닙니다', { field: 'id' });
  if (isProbeId(id) && opts.internal !== true) throw new ValidationError('쓸 수 없는 설계 id 입니다', { field: 'id' });
  const rev = body && body.rev;
  if (!Number.isInteger(rev) || rev < 1) throw new ValidationError('rev 가 필요합니다', { field: 'rev' });
  const bundle = bundleOf(body);
  const sha = await bundleSha256(bundle);
  return guard(async () => {
    const draft = await selectOne(env, 'planner_drafts', {
      company_id: `eq.${company.id}`,
      id: `eq.${id}`,
      select: 'id,rev,created_by,discarded_at',
    });
    if (!draft || draft.discarded_at) throw new NotFoundError('그 설계가 없습니다');
    if (!(canManage || (draft.created_by && draft.created_by === user.id))) {
      throw new ForbiddenError('설계를 만든 사람이나 대표 · 실장만 보냅니다', 'not_draft_editor');
    }
    if (rev > draft.rev) throw new ValidationError('저장된 설계보다 앞선 rev 입니다', { field: 'rev' });
    if (rev < draft.rev) return { saved: false, stale: true, rev: draft.rev };
    const key = { company_id: `eq.${company.id}`, draft_id: `eq.${id}` };
    let stored = await selectOne(env, 'planner_draft_learn', { ...key, select: 'rev,bundle_sha256' });
    if (!stored) {
      try {
        await insertOne(env, 'planner_draft_learn', { company_id: company.id, draft_id: id, rev, bundle, bundle_sha256: sha, sent_by: user.id });
        return { saved: true, rev };
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
        // 같은 때 다른 요청이 먼저 넣었다 — 그 줄을 보고 아래로
        stored = await selectOne(env, 'planner_draft_learn', { ...key, select: 'rev,bundle_sha256' });
        if (!stored) throw e;
      }
    }
    if (stored.rev > rev) return { saved: false, stale: true, rev: stored.rev };
    if (stored.rev === rev && stored.bundle_sha256 === sha) return { saved: false, same: true, rev };
    await updateBy(env, 'planner_draft_learn', key, { rev, bundle, bundle_sha256: sha, sent_by: user.id });
    return { saved: true, rev };
  });
}

// ── 저장 실패 기록 ─────────────────────────────────────────

/** 오류 하나 → 기록할 코드 (글은 적지 않는다). 적지 않을 것은 null — 로그인 끝 · 표가 아직 없음 */
export function issueCodeOf(e) {
  if (!e || e instanceof AuthError || e.code === 'db_pending') return null;
  if (typeof e.code === 'string' && ISSUE_CODE_RE.test(e.code)) return e.code;
  if (e instanceof ValidationError) return 'validation';
  if (e instanceof ForbiddenError) return 'forbidden';
  if (e instanceof NotFoundError) return 'not_found';
  if (e instanceof TooLargeError) return 'too_large';
  if (e instanceof ConflictError) return 'conflict';
  if (e instanceof DbError) return 'db_error';
  return 'error';
}

const statusOf = (v) => (Number.isInteger(v) && v >= 100 && v <= 599 ? v : null);
const draftIdOf = (v) => (typeof v === 'string' && DRAFT_ID_RE.test(v) ? v : null);
const revOf = (v) => (Number.isInteger(v) && v >= 0 ? v : null);

/**
 * 서버가 본 실패 한 줄 — 던지지 않는다 (기록이 안 돼도 원래 오류가 그대로 나간다).
 * @param {{stage: string, error: any, draftId?: string, rev?: number}} o
 * @returns {Promise<boolean>} 적었나
 */
export async function noteIssue(env, user, o) {
  try {
    const code = issueCodeOf(o && o.error);
    if (!code || !ISSUE_STAGES.includes(o.stage) || !user || !user.id) return false;
    let companyId = null;
    try {
      companyId = (await plannerCompanyOf(env, user)).company.id;
    } catch {
      companyId = null; // 팩토리 구성원이 아닌 사람의 실패도 남긴다 (업체 칸은 비운다)
    }
    await insertOne(env, 'planner_save_issues', {
      company_id: companyId,
      user_id: user.id,
      draft_id: draftIdOf(o.draftId),
      source: 'server',
      stage: o.stage,
      code,
      status: statusOf(o.error.statusCode) || 500,
      rev: revOf(o.rev),
    });
    return true;
  } catch {
    return false;
  }
}

/** POST /planner/drafts/report { stage, code, status?, draftId?, rev? } — 화면이 본 실패 (연결 끊김처럼 서버가 못 본 것) */
export async function reportIssue(env, { user, body }) {
  const b = body || {};
  if (!ISSUE_STAGES.includes(b.stage)) throw new ValidationError('stage 가 필요합니다', { field: 'stage' });
  if (typeof b.code !== 'string' || !ISSUE_CODE_RE.test(b.code)) throw new ValidationError('code 형식이 아닙니다', { field: 'code' });
  let companyId = null;
  try {
    companyId = (await plannerCompanyOf(env, user)).company.id;
  } catch (e) {
    if (!(e instanceof ForbiddenError)) throw e;
  }
  return guard(async () => {
    const since = new Date(Date.now() - 3600 * 1000).toISOString();
    const recent =
      (await selectMany(env, 'planner_save_issues', {
        user_id: `eq.${user.id}`,
        created_at: `gte.${since}`,
        select: 'id',
        limit: String(REPORTS_PER_HOUR),
      })) || [];
    if (recent.length >= REPORTS_PER_HOUR) return { ok: true, dropped: true };
    await insertOne(env, 'planner_save_issues', {
      company_id: companyId,
      user_id: user.id,
      draft_id: draftIdOf(b.draftId),
      source: 'client',
      stage: b.stage,
      code: b.code,
      status: statusOf(b.status),
      rev: revOf(b.rev),
    });
    return { ok: true };
  });
}

// ── 화면 신호 — 자주 쓴 구성 카드 ───────────────────────────

/** 받는 신호 — 카드를 보임 · 누름 · 지나침. DB 0067 이 받는 fill_all 은 쓰지 않는다 (「한 번에 채우기」 단추를 만들지 않았다) */
export const SIGNAL_KINDS = Object.freeze(['suggest_shown', 'suggest_accepted', 'suggest_skipped']);
export const SIGNAL_LINES = Object.freeze(['floor', 'upper']);
/** 지나친 까닭 — 카드 대신 무엇으로 줄을 채웠나 (fill = 빈 폭 채우기 · 자동계산, manual = 모듈을 직접 놓음) */
export const SIGNAL_SKIP_BY = Object.freeze(['fill', 'manual']);
export const SIGNAL_CARDS_MAX = 3;
export const SIGNAL_TOKENS_MAX = 40;
/** 한 사람이 한 시간에 남길 수 있는 신호 — 넘으면 받되 적지 않는다 */
export const SIGNALS_PER_HOUR = 120;
/** DB 0067 planner_signals_payload_check 와 같다 */
export const SIGNAL_PAYLOAD_MAX_BYTES = 8192;
const SIGNAL_ITEM_RE = /^[a-z_]{1,40}$/;
/** 카드 구성의 조각 — 플래너 js/suggest.js compKeyOf 가 내는 것만: 모듈 id · 설비장 자리(@sink) · 보통 도어장 사이(*) */
const SIGNAL_TOKEN_RE = /^(?:\*|@[a-z]{1,20}|[A-Za-z0-9][A-Za-z0-9-]{1,59})$/;

const countOf = (v, max) => (Number.isInteger(v) && v >= 0 && v <= max ? v : null);

/** 카드 하나 { key: 'a|b|c', n } → { key: [조각…], n }. 모양이 아니면 null — 글을 통째로 적지 않고 조각마다 본다 */
function signalCardOf(c) {
  if (!isObject(c) || typeof c.key !== 'string' || !c.key || c.key.length > SIGNAL_TOKENS_MAX * 61) return null;
  const tokens = c.key.split('|');
  if (tokens.length > SIGNAL_TOKENS_MAX || !tokens.every((t) => SIGNAL_TOKEN_RE.test(t))) return null;
  return { key: tokens, n: countOf(c.n, 9999) || 0 };
}

/**
 * POST /planner/signals — 자주 쓴 구성 카드가 쓰였나 (2026-11-14 사장님 「카드 쓰임 기록」)
 *   suggest_shown     카드를 보였다          { line, cards }
 *   suggest_accepted  카드를 눌렀다          + pick (몇 번째 카드) · placed (놓은 모듈 수) · missed (자리가 없어 못 놓은 수)
 *   suggest_skipped   카드를 두고 다르게 채움  + by (fill · manual)
 * 누가(업체 · 사람) · 어느 설계(id) · 품목 · 줄 · 카드의 모듈 구성과 설계 수만 적는다. 설계 이름 · 고객 정보 · 치수는 없다.
 */
export async function recordSignal(env, { user, body }) {
  const b = body || {};
  if (!SIGNAL_KINDS.includes(b.kind)) throw new ValidationError('kind 가 필요합니다', { field: 'kind' });
  if (!SIGNAL_LINES.includes(b.line)) throw new ValidationError('line 이 필요합니다', { field: 'line' });
  if (typeof b.item !== 'string' || !SIGNAL_ITEM_RE.test(b.item)) throw new ValidationError('item 형식이 아닙니다', { field: 'item' });
  if (!Array.isArray(b.cards) || !b.cards.length || b.cards.length > SIGNAL_CARDS_MAX) throw new ValidationError('cards 가 필요합니다', { field: 'cards' });
  const cards = b.cards.map(signalCardOf);
  if (cards.some((c) => !c)) throw new ValidationError('cards 형식이 아닙니다', { field: 'cards' });
  const payload = { line: b.line, cards };
  if (b.kind === 'suggest_accepted') {
    const pick = countOf(b.pick, cards.length - 1);
    if (pick === null) throw new ValidationError('pick 이 필요합니다', { field: 'pick' });
    Object.assign(payload, { pick, placed: countOf(b.placed, 999), missed: countOf(b.missed, 999) });
  }
  if (b.kind === 'suggest_skipped') payload.by = SIGNAL_SKIP_BY.includes(b.by) ? b.by : null;
  if (bytesOf(payload) > SIGNAL_PAYLOAD_MAX_BYTES) throw new ValidationError('cards 가 너무 큽니다', { field: 'cards' });
  const draftId = draftIdOf(b.draftId);
  if (draftId && isProbeId(draftId)) return { ok: true, dropped: true }; // 점검용 시험 설계는 적지 않는다
  const { company } = await plannerCompanyOf(env, user);
  return guard(async () => {
    const since = new Date(Date.now() - 3600 * 1000).toISOString();
    const recent =
      (await selectMany(env, 'planner_signals', {
        user_id: `eq.${user.id}`,
        created_at: `gte.${since}`,
        select: 'id',
        limit: String(SIGNALS_PER_HOUR),
      })) || [];
    if (recent.length >= SIGNALS_PER_HOUR) return { ok: true, dropped: true };
    await insertOne(env, 'planner_signals', { company_id: company.id, user_id: user.id, draft_id: draftId, kind: b.kind, item: b.item, payload });
    return { ok: true };
  });
}

// ── 사진 제공 동의 ─────────────────────────────────────────

/** 업체의 지금 동의 — 마지막 줄 (없으면 null) */
export async function latestPhotoConsent(env, companyId) {
  const rows =
    (await selectMany(env, 'company_consents', {
      company_id: `eq.${companyId}`,
      kind: `eq.${PHOTO_CONSENT_KIND}`,
      select: 'granted,terms_version,created_at',
      order: 'created_at.desc',
      limit: '1',
    })) || [];
  return rows[0] || null;
}

function consentView(company, role, row) {
  if (company.kind === 'hq') return { granted: true, fixed: true, at: null, can_change: false, terms: PHOTO_CONSENT_TERMS };
  return {
    granted: !!row && row.granted === true,
    fixed: false,
    at: row ? row.created_at : null,
    can_change: role === 'owner',
    terms: PHOTO_CONSENT_TERMS,
  };
}

/** GET /planner/photo-consent — 다담 공장은 늘 제공 (fixed) */
export async function getPhotoConsent(env, { user }) {
  const { company, role } = await plannerCompanyOf(env, user);
  if (company.kind === 'hq') return consentView(company, role, null);
  return guard(async () => consentView(company, role, await latestPhotoConsent(env, company.id)));
}

/** PUT /planner/photo-consent { granted, terms_version } — 팩토리 대표만. 켤 때는 본 글의 version 이 지금 것과 같아야 한다 */
export async function putPhotoConsent(env, { user, body }) {
  const { company, role } = await plannerCompanyOf(env, user);
  if (company.kind === 'hq') throw new ValidationError('다담 공장은 늘 제공합니다 — 바꿀 것이 없습니다');
  if (role !== 'owner') throw new ForbiddenError('팩토리 대표만 바꿉니다', 'not_owner');
  const granted = body && body.granted;
  if (typeof granted !== 'boolean') throw new ValidationError('granted 가 필요합니다', { field: 'granted' });
  if (granted && body.terms_version !== PHOTO_CONSENT_TERMS.version) {
    const err = new ConflictError('동의 글이 바뀌었습니다 — 다시 읽고 켜 주세요');
    err.code = 'terms_changed';
    throw err;
  }
  return guard(async () => {
    const now = await latestPhotoConsent(env, company.id);
    const same = now ? now.granted === granted && (!granted || now.terms_version === PHOTO_CONSENT_TERMS.version) : granted === false;
    if (same) return consentView(company, role, now);
    const row = await insertOne(env, 'company_consents', {
      company_id: company.id,
      kind: PHOTO_CONSENT_KIND,
      granted,
      terms_version: PHOTO_CONSENT_TERMS.version,
      actor: user.id,
    });
    return consentView(company, role, row || { granted, terms_version: PHOTO_CONSENT_TERMS.version, created_at: new Date().toISOString() });
  });
}
