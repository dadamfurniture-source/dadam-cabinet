/**
 * 간편 플래너 웹판 → 학습 데이터 창고 (DB 0067 planner_draft_learn).
 *
 * 웹판 플래너는 설계를 저장한 뒤 학습 묶음({ record, samples })을 workflow-api 로 보낸다 (planner_draft_learn).
 * 여기서는 10분마다 아직 수집 안 한 묶음(pending)을 dataset_samples 로 옮긴다. PC 플래너의 「앱 창고로 올리기」(planner.js)와 따로다.
 *
 * 원칙:
 *   1) 출처 · 묶음 키 · 검토 필요 · 사용 범위 · 동의는 여기서 정한다. 묶음이 보낸 값은 라벨 범위만 검사한다.
 *        source dadam_planner · src_table planner_drafts · group_key planner-web:<업체 id>:<설계 id>
 *        (설계 id 는 업체끼리 겹칠 수 있다 — 업체 id 를 넣는다. PC 올리기의 planner-lite:design:<id> 와도 안 겹친다)
 *   2) 새 표본은 늘 검토 필요(needs_review). 사람이 검토한 표본은 라벨을 건드리지 않는다 —
 *        다만 설계 내용이 그 뒤에 바뀌면 다시 검토 필요로 돌린다 (등급 · 본 rev 는 attrs 에 그대로 남아 「검토한 rev N, 지금 M」을 보인다).
 *   3) 사진은 다담 공장 것과, 사진 제공을 켠 협력업체(company_consents 마지막 줄) 것만. 파일은 복사하지 않고
 *        비공개 버킷 planner-photos 의 자리를 가리킨다. 크기 · 지문은 묶음이 아니라 planner_draft_photos 에서 읽는다.
 *        제공을 끄면 그 업체의 사진 표본을 지운다 (사람이 검토한 것도).
 *   4) 버린 설계 · 점검용 시험 설계(probe-)는 표본을 두지 않는다.
 *   5) 설계 이름 · 메모는 넣지 않는다 (고객 이름 · 주소가 섞일 수 있다).
 *   6) 학습용 내보내기(dataset_exportable)는 앱 설계로 이어지고(app_state.designId → design_id) 그 수주가 시공 완료일 때만 — 정본 그대로.
 *   7) 한 묶음이 실패해도 나머지는 계속한다. 실패는 그 줄에 적고(ingest_error · ingest_tries) 정한 수까지만 다시 해 본다
 *        (묶음이 바뀌면 DB 지킴이가 수를 처음으로 돌린다).
 *
 * import 가 없다 — 쓰는 것(select · upsert · patch · remove · count)은 h 로 받는다 (planner.js 와 같은 방식, 시험이 가짜를 넣는다).
 */

export const WEB_SRC_TABLE = 'planner_drafts';
export const WEB_PHOTOS_BUCKET = 'planner-photos';
export const WEB_CONSENT_KIND = 'planner_photo_learning';
export const WEB_CONSENT_STATE = 'company_consents';
/** 한 번에 옮기는 묶음 수 (묶음 하나가 1MB 까지) · 한 묶음을 다시 해 보는 수 */
export const WEB_BATCH = 20;
export const WEB_MAX_TRIES = 5;
const PROBE_PREFIX = 'probe-';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DRAFT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{3,80}$/;
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9-]{3,80}\.(jpg|png|webp)$/;
const ATTRS_MAX = 64 * 1024;
const RECORD_MAX = 512 * 1024;
// 라벨 범위 — planner.js 와 같은 목록 (시험이 두 파일을 견준다)
const MEDIA = ['photo', 'render3d', 'generated'];
const PHASE = ['before', 'after', 'in_progress', 'unknown'];
const SPACE = ['kitchen', 'dining', 'living', 'bedroom', 'bathroom', 'entrance', 'balcony', 'dressing', 'utility', 'corridor', 'study', 'unknown'];
const FURNITURE = ['sink', 'builtin', 'fridge', 'storage', 'none', 'unknown'];
const SHAPE = ['I', 'L', 'U', 'island', 'unknown'];
/** 사람 검토가 attrs 에 적는 칸 — 다시 수집해도 그대로 둔다 (0067 apply_dataset_review_grade · 기존 apply_dataset_review) */
const REVIEW_KEYS = ['grade', 'grade_reasons', 'reviewed_rev', 'original', 'rejected', 'reject_note', 'pii_found'];

const pick = (v, list, dflt) => (list.includes(v) ? v : dflt);
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const q = (s) => encodeURIComponent(s);
export const webGroupKey = (companyId, draftId) => `planner-web:${companyId}:${draftId}`;
export const isProbeDraft = (id) => typeof id === 'string' && id.startsWith(PROBE_PREFIX);
/** 표가 아직 없다 (0067 적용 전) — PostgREST PGRST205 · Postgres 42P01 · 없는 칸 42703 */
const missingTable = (e) => /PGRST20[45]|42P01|42703/.test(String((e && e.message) || ''));

/** 키 차례를 맞춘 JSON — 「내용이 같나」 (DB jsonb 는 키 차례를 바꾼다) */
export function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (isObject(v)) {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** 설계 레코드 — 이름 · 사진 기록(메모가 든다) · 연출 기록 원본은 빼고 넣는다 */
export function cleanRecord(record) {
  if (!isObject(record)) throw new Error('설계 레코드가 없습니다');
  const r = { ...record };
  delete r.name;
  if (isObject(r.design)) {
    const d = { ...r.design };
    ['name', 'photos', 'segan', 'archivedAt'].forEach((k) => delete d[k]);
    r.design = d;
  }
  if (JSON.stringify(r).length > RECORD_MAX) throw new Error('설계 레코드가 너무 큽니다');
  return r;
}

function cleanAttrs(a) {
  const o = isObject(a) ? { ...a } : {};
  delete o.note;
  delete o.name;
  delete o.judgeNote;
  if (JSON.stringify(o).length > ATTRS_MAX) throw new Error('표본 attrs 가 너무 큽니다');
  return o;
}

const reviewKept = (attrs) => {
  const out = {};
  if (isObject(attrs)) REVIEW_KEYS.forEach((k) => { if (attrs[k] !== undefined) out[k] = attrs[k]; });
  return out;
};

/**
 * 설계 한 줄 (그림 없음).
 * @param {{companyId: string, draftId: string, rev: number, record: object, designId: string|null, companyKind: string, old: object|null}} o
 */
export function webDesignRow(o) {
  const gk = webGroupKey(o.companyId, o.draftId);
  const record = cleanRecord(o.record);
  const old = o.old || null;
  const human = !!old && old.label_source === 'human';
  const changed = !old || stableJson((old.attrs || {}).record) !== stableJson(record);
  return {
    sample_id: gk,
    source: 'dadam_planner',
    group_key: gk,
    image_url: null,
    image_sha256: null,
    width: null,
    height: null,
    media: 'floorplan',
    phase: 'unknown',
    space: human ? old.space : pick(record.space, SPACE, 'kitchen'),
    furniture: human ? old.furniture : pick(record.furniture, FURNITURE, 'sink'),
    layout_shape: human ? old.layout_shape : pick(record.layout_shape, SHAPE, 'unknown'),
    attrs: { ...reviewKept(old && old.attrs), record, web: { rev: o.rev, company_kind: o.companyKind === 'hq' ? 'hq' : 'partner' } },
    label_source: human ? 'human' : 'structured',
    confidence: human ? 1 : null,
    // 사람이 본 뒤에 내용이 바뀌면 다시 검토 — 안 바뀌었으면 검토 결과 그대로
    needs_review: human && !changed ? old.needs_review === true : true,
    license: 'restricted-internal',
    consent: null,
    src_table: WEB_SRC_TABLE,
    src_updated_at: isObject(record.design) && typeof record.design.updatedAt === 'string' ? record.design.updatedAt : null,
    taxonomy_version: '1.1',
    design_id: UUID_RE.test(String(o.designId || '')) ? o.designId : null,
  };
}

/**
 * 사진 표본 한 줄 — 파일 자리 · 크기 · 지문은 planner_draft_photos 줄(file)에서.
 * @param {{companyId: string, draftId: string, sample: object, file: {file: string, sha256: string, width: number|null, height: number|null}, companyKind: string, designId: string|null, old: object|null}} o
 */
export function webPhotoRow(env, o) {
  const gk = webGroupKey(o.companyId, o.draftId);
  const s = isObject(o.sample) ? o.sample : {};
  const old = o.old || null;
  const human = !!old && old.label_source === 'human';
  const int = (v) => (Number.isInteger(v) && v > 0 && v <= 20000 ? v : null);
  return {
    sample_id: `${gk}:photo:${o.file.file.replace(/\.(jpg|png|webp)$/, '')}`,
    source: 'dadam_planner',
    group_key: gk,
    image_url: `${env.SUPABASE_URL}/storage/v1/object/authenticated/${WEB_PHOTOS_BUCKET}/${o.companyId}/${o.draftId}/${o.file.file}`,
    image_sha256: o.file.sha256,
    width: int(o.file.width),
    height: int(o.file.height),
    media: human ? old.media : pick(s.media, MEDIA, 'photo'),
    phase: human ? old.phase : pick(s.phase, PHASE, 'unknown'),
    space: human ? old.space : pick(s.space, SPACE, 'unknown'),
    furniture: human ? old.furniture : pick(s.furniture, FURNITURE, 'unknown'),
    layout_shape: human ? old.layout_shape : pick(s.layout_shape, SHAPE, 'unknown'),
    attrs: { ...cleanAttrs(s.attrs), ...reviewKept(old && old.attrs) },
    label_source: human ? 'human' : 'structured',
    confidence: human ? 1 : null,
    needs_review: human ? old.needs_review === true : true,
    license: 'restricted-internal',
    // 협력업체 사진은 업체 대표가 제공을 켠 것 (company_consents) — 다담 공장 것은 동의 칸이 없다
    consent: o.companyKind === 'hq' ? null : true,
    src_table: WEB_SRC_TABLE,
    src_updated_at: null,
    taxonomy_version: '1.1',
    design_id: UUID_RE.test(String(o.designId || '')) ? o.designId : null,
  };
}

async function photosAllowed(env, h, company) {
  if (company.kind === 'hq') return true;
  const rows = await h.select(
    env,
    `company_consents?company_id=eq.${company.id}&kind=eq.${WEB_CONSENT_KIND}&select=granted&order=created_at.desc&limit=1`
  );
  return !!rows[0] && rows[0].granted === true;
}

async function removeSamples(env, h, ids) {
  for (let i = 0; i < ids.length; i += 40) {
    await h.remove(env, `dataset_samples?sample_id=in.(${ids.slice(i, i + 40).map((id) => `"${id}"`).map(q).join(',')})`);
  }
  return ids.length;
}

const learnKey = (row) => `planner_draft_learn?company_id=eq.${row.company_id}&draft_id=eq.${q(row.draft_id)}`;

/** 묶음 하나 → 표본. @returns {{written: number, deleted: number, skipped: number}} */
export async function ingestOne(env, h, row) {
  if (!UUID_RE.test(String(row.company_id || '')) || !DRAFT_ID_RE.test(String(row.draft_id || ''))) throw new Error('묶음 열쇠가 이상합니다');
  const gk = webGroupKey(row.company_id, row.draft_id);
  const out = { written: 0, deleted: 0, skipped: 0 };
  const existing = await h.select(
    env,
    `dataset_samples?group_key=eq.${q(gk)}&select=sample_id,label_source,media,phase,space,furniture,layout_shape,attrs,needs_review&limit=1000`
  );
  const old = new Map(existing.map((r) => [r.sample_id, r]));
  const [draft] = await h.select(
    env,
    `planner_drafts?company_id=eq.${row.company_id}&id=eq.${q(row.draft_id)}&select=id,rev,app_state,discarded_at`
  );
  const done = { ingested_sha256: row.bundle_sha256, ingested_rev: row.rev, ingested_at: new Date().toISOString(), ingest_error: null };
  // 지문이 그대로일 때만 수집 끝으로 적는다 — 그 사이 묶음이 바뀌었으면 다음 실행이 다시 읽는다
  const mark = () => h.patch(env, `${learnKey(row)}&bundle_sha256=eq.${row.bundle_sha256}`, done);

  if (!draft || draft.discarded_at || isProbeDraft(row.draft_id)) {
    out.deleted += await removeSamples(env, h, [...old.keys()]);
    await mark();
    return out;
  }
  const [company] = await h.select(env, `companies?id=eq.${row.company_id}&select=id,kind`);
  if (!company) throw new Error('업체를 찾지 못했습니다');
  const bundle = isObject(row.bundle) ? row.bundle : {};
  const designId = isObject(draft.app_state) ? draft.app_state.designId : null;
  const rows = [
    webDesignRow({ companyId: row.company_id, draftId: row.draft_id, rev: row.rev, record: bundle.record, designId, companyKind: company.kind, old: old.get(gk) || null }),
  ];
  const samples = Array.isArray(bundle.samples) ? bundle.samples : [];
  if (samples.length && (await photosAllowed(env, h, company))) {
    const files = await h.select(
      env,
      `planner_draft_photos?company_id=eq.${row.company_id}&draft_id=eq.${q(row.draft_id)}&deleted_at=is.null&select=file,sha256,width,height&limit=1000`
    );
    const byFile = new Map(files.map((f) => [f.file, f]));
    const seen = new Set();
    for (const s of samples) {
      const name = isObject(s) && typeof s.file === 'string' && FILE_RE.test(s.file) ? s.file : null;
      const file = name ? byFile.get(name) : null;
      // 저장소에 없는 파일 · 같은 파일 두 번은 넣지 않는다
      if (!file || seen.has(name)) { out.skipped += 1; continue; }
      seen.add(name);
      const sampleId = `${gk}:photo:${name.replace(/\.(jpg|png|webp)$/, '')}`;
      rows.push(webPhotoRow(env, { companyId: row.company_id, draftId: row.draft_id, sample: s, file, companyKind: company.kind, designId, old: old.get(sampleId) || null }));
    }
  } else {
    out.skipped += samples.length;
  }
  out.written += await h.upsert(env, 'dataset_samples', rows, 'sample_id');
  const keep = new Set(rows.map((r) => r.sample_id));
  out.deleted += await removeSamples(env, h, [...old.keys()].filter((id) => !keep.has(id)));
  await mark();
  return out;
}

/**
 * 사진 제공을 켜고 끈 업체를 따라간다 (company_consents 는 쌓기만 — 만든 때로 증분).
 *   끔 → 그 업체의 사진 표본을 지운다 · 켬 → 그 업체 묶음을 다시 수집 대상으로 (수집 표시를 비운다)
 */
export async function sweepConsents(env, h) {
  const [st] = await h.select(env, `dataset_ingest_state?src_table=eq.${WEB_CONSENT_STATE}&select=watermark`);
  const from = (st && st.watermark) || '1970-01-01T00:00:00Z';
  const rows = await h.select(
    env,
    `company_consents?kind=eq.${WEB_CONSENT_KIND}&created_at=gt.${q(from)}&select=company_id,granted,created_at&order=created_at.asc&limit=500`
  );
  const out = { changed: 0, revoked: 0, granted: 0 };
  if (!rows.length) return out;
  const last = new Map();
  rows.forEach((r) => last.set(r.company_id, r)); // 차례대로 — 업체마다 마지막 줄이 남는다
  for (const r of last.values()) {
    if (!UUID_RE.test(String(r.company_id || ''))) continue;
    out.changed += 1;
    if (r.granted === true) {
      await h.patch(env, `planner_draft_learn?company_id=eq.${r.company_id}`, { ingested_sha256: null, ingested_rev: null, ingested_at: null });
      out.granted += 1;
    } else {
      await h.remove(env, `dataset_samples?src_table=eq.${WEB_SRC_TABLE}&group_key=like.${q(`planner-web:${r.company_id}:*`)}&image_url=not.is.null`);
      out.revoked += 1;
    }
  }
  await h.upsert(env, 'dataset_ingest_state', [{ src_table: WEB_CONSENT_STATE, watermark: rows[rows.length - 1].created_at, last_run: new Date().toISOString(), last_count: out.changed, last_error: null }], 'src_table');
  return out;
}

/**
 * 아직 수집 안 한 묶음을 옮긴다 (10분마다 · POST /ingest).
 * @returns {{table: string, read?: number, written?: number, deleted?: number, skipped?: number, failed?: number, consents?: object, pending_db?: boolean, error?: string}}
 */
export async function ingestPlannerWeb(env, h) {
  const out = { table: WEB_SRC_TABLE, read: 0, written: 0, deleted: 0, skipped: 0, failed: 0 };
  let rows;
  try {
    out.consents = await sweepConsents(env, h);
    rows = await h.select(
      env,
      `planner_draft_learn?select=company_id,draft_id,rev,bundle,bundle_sha256,ingest_tries&pending=is.true&ingest_tries=lt.${WEB_MAX_TRIES}&order=updated_at.asc&limit=${WEB_BATCH}`
    );
  } catch (e) {
    if (missingTable(e)) return { table: WEB_SRC_TABLE, pending_db: true };
    return { table: WEB_SRC_TABLE, error: String((e && e.message) || e).slice(0, 300) };
  }
  out.read = rows.length;
  let lastError = null;
  for (const row of rows) {
    try {
      const r = await ingestOne(env, h, row);
      out.written += r.written;
      out.deleted += r.deleted;
      out.skipped += r.skipped;
    } catch (e) {
      out.failed += 1;
      lastError = String((e && e.message) || e).slice(0, 300);
      try {
        await h.patch(env, learnKey(row), { ingest_error: lastError, ingest_tries: (Number(row.ingest_tries) || 0) + 1 });
      } catch { /* 다음 실행이 다시 읽는다 */ }
    }
  }
  try {
    await h.upsert(env, 'dataset_ingest_state', [{ src_table: WEB_SRC_TABLE, last_run: new Date().toISOString(), last_count: out.written, last_error: lastError }], 'src_table');
  } catch { /* 상태 줄은 다음 실행이 다시 적는다 */ }
  return out;
}

/**
 * GET /planner/funnel — 웹판 설계가 학습 자료까지 가는 길의 수 (관리자 화면).
 * @returns {object} 0067 적용 전이면 { pending_db: true }
 */
export async function plannerFunnel(env, h) {
  const design = `dataset_samples?src_table=eq.${WEB_SRC_TABLE}&image_url=is.null`;
  try {
    const [drafts, bundles, pending, failed, samples, waiting, good, normal, excluded, photos, exportable, state] = await Promise.all([
      h.count(env, `planner_drafts?discarded_at=is.null&id=not.like.${q(`${PROBE_PREFIX}*`)}`),
      h.count(env, `planner_draft_learn?draft_id=not.like.${q(`${PROBE_PREFIX}*`)}`),
      h.count(env, `planner_draft_learn?pending=is.true&draft_id=not.like.${q(`${PROBE_PREFIX}*`)}`),
      h.count(env, 'planner_draft_learn?ingest_error=not.is.null'),
      h.count(env, design),
      h.count(env, `${design}&needs_review=is.true`),
      h.count(env, `${design}&attrs->>grade=eq.good`),
      h.count(env, `${design}&attrs->>grade=eq.normal`),
      h.count(env, `${design}&attrs->>grade=eq.exclude`),
      h.count(env, `dataset_samples?src_table=eq.${WEB_SRC_TABLE}&image_url=not.is.null`),
      h.count(env, `dataset_exportable?src_table=eq.${WEB_SRC_TABLE}&image_url=is.null`),
      h.select(env, `dataset_ingest_state?src_table=eq.${WEB_SRC_TABLE}&select=last_run,last_count,last_error`),
    ]);
    return {
      drafts,
      bundles,
      pending,
      failed,
      samples,
      waiting_review: waiting,
      grades: { good, normal, exclude: excluded },
      photos,
      exportable,
      last_run: (state[0] && state[0].last_run) || null,
      last_count: state[0] ? state[0].last_count : null,
      last_error: (state[0] && state[0].last_error) || null,
    };
  } catch (e) {
    if (missingTable(e)) return { pending_db: true };
    throw e;
  }
}
