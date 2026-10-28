/**
 * 간편 플래너 → 학습 데이터 창고 (2026-10-28 사장님 "2번" — 앱 창고로 올리기 · "ERP 수주번호 연결" · "설계 모음에서 단추로").
 *
 * 간편 플래너(dadam-planner-lite — 사장님 PC 의 로컬 도구)가 **관리자 계정 토큰**으로 부른다 (worker.js 가 verifyAdmin 을 먼저 지난다):
 *   POST /planner/state   {designId}                         → 그 설계 묶음의 표본 [{sample_id, image_sha256, label_source}]
 *   POST /planner/photo   {designId, fileName, sample, file} → 사진 한 장: 비공개 버킷 design-images 의 planner-lite/<설계>/<파일> + 표본 한 줄
 *   POST /planner/design  {designId, orderNo?, completed?, record, keep}
 *                                                           → 설계 한 줄(그림 없음) · 수주번호 → orders.design_id 를 묶음 전체에 ·
 *                                                             keep 에 없는 표본 지움 (사진 파일도) · 시공 완료 확인 (planner_completions)
 *
 * 원칙 (ingest.js 와 같다):
 *   1) 출처 · 묶음 키는 여기서 정한다 — source dadam_planner, group_key planner-lite:design:<id>. 플래너가 보낸 라벨은 범위만 검사.
 *   2) **사람이 검수한 표본(label_source human)은 덮어쓰지도 지우지도 않는다.** 플래너가 보내는 라벨은 늘 structured —
 *      창고의 human 은 관리자 검수(dataset_reviews 트리거)만 단다.
 *   3) 학습용 내보내기(dataset_exportable)는 수주가 시공 완료일 때 — 앱 정본 그대로. 수주번호가 없거나 못 찾으면 design_id 는 비워
 *      창고 저장 · 검수만 된다. 앱 전에 끝난 현장(수주 없음)은 관리자가 플래너에서 「시공 완료 확인」을 켜면
 *      planner_completions 에 한 줄 (0009, 사장님 2026-10-28) — 창고에 남는 시공 완료 사진이 한 장 이상일 때만. 끄면 지운다.
 *   4) 사진은 design-images 의 planner-lite/ 아래 — 고객 폴더(auth.uid)가 아니라 관리자만 읽는다 (design-images_select_admin).
 *      관리자 검수 화면 · 야간 내보내기가 이미 이 버킷을 서명한다 (storage-urls.js PRIVATE_BUCKETS).
 *
 * import 하던 것(select · upsert · patch · remove · putObject · removeObjects)은 h 로 받는다 — 시험이 가짜를 넣는다.
 */

export const PLANNER_BUCKET = 'design-images';
export const PLANNER_PREFIX = 'planner-lite';
export const PLANNER_SRC_TABLE = 'planner_lite';
/** 시공 완료 확인 (database/migrations/0009_planner_completions.sql) */
export const COMPLETION_TABLE = 'planner_completions';
const DESIGN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{3,80}$/;
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9-]{3,80}\.(jpg|png|webp)$/;
/** ERP 수주번호 (workflow-api orders.js buildOrderNo: SO-YYYYMMDD-XXXX) — 넉넉히 */
const ORDER_NO_RE = /^[A-Za-z0-9][A-Za-z0-9-]{2,39}$/;
const PHOTO_MAX = 15 * 1024 * 1024;
const ATTRS_MAX = 64 * 1024;
const RECORD_MAX = 512 * 1024;
const KEEP_MAX = 500;
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const MEDIA = ['photo', 'render3d', 'generated'];
const PHASE = ['before', 'after', 'in_progress', 'unknown'];
const SPACE = ['kitchen', 'dining', 'living', 'bedroom', 'bathroom', 'entrance', 'balcony', 'dressing', 'utility', 'corridor', 'study', 'unknown'];
const FURNITURE = ['sink', 'builtin', 'fridge', 'storage', 'none', 'unknown'];
const SHAPE = ['I', 'L', 'U', 'island', 'unknown'];

const bad = (message) => Object.assign(new Error(message), { status: 400 });
const pick = (v, list, dflt) => (list.includes(v) ? v : dflt);
export const plannerGroupKey = (designId) => `planner-lite:design:${designId}`;

function designIdOf(b) {
  const id = b && b.designId;
  if (!DESIGN_ID_RE.test(String(id || ''))) throw bad('설계 id 형식이 아닙니다');
  return id;
}

/** 바이트 앞머리로 형식 — 확장자를 믿지 않는다 */
export function sniff(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'webp';
  return null;
}

function base64Bytes(s) {
  if (typeof s !== 'string' || !s || s.length > Math.ceil(PHOTO_MAX / 3) * 4 + 8) throw bad('사진이 없거나 너무 큽니다 (15MB 까지)');
  let bin;
  try { bin = atob(s); } catch { throw bad('사진이 base64 가 아닙니다'); }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** 고객 이름 · 주소가 섞일 수 있는 칸은 빼고, 크기를 자른다 */
function cleanAttrs(a) {
  const o = a && typeof a === 'object' && !Array.isArray(a) ? { ...a } : {};
  delete o.note;
  delete o.name;
  if (JSON.stringify(o).length > ATTRS_MAX) throw bad('표본 attrs 가 너무 큽니다');
  return o;
}

/** 사진 표본 한 줄 — 플래너 dataset-export.js sampleOf 모양을 받아 출처 · 묶음 · 그림 주소를 여기서 정한다 */
export function photoRow(env, designId, sample, file, sha256) {
  const gk = plannerGroupKey(designId);
  if (!sample || typeof sample !== 'object') throw bad('표본이 없습니다');
  if (typeof sample.sample_id !== 'string' || !sample.sample_id.startsWith(`${gk}:photo:`) || sample.sample_id.length > 200) {
    throw bad('표본 id 가 이 설계 묶음이 아닙니다');
  }
  const userUploaded = sample.license === 'user-uploaded';
  if (userUploaded && sample.consent !== true) throw bad('고객이 올린 사진은 학습 동의가 있어야 합니다');
  const int = (v) => (Number.isInteger(v) && v > 0 && v <= 20000 ? v : null);
  return {
    sample_id: sample.sample_id,
    source: 'dadam_planner',
    group_key: gk,
    image_url: `${env.SUPABASE_URL}/storage/v1/object/public/${PLANNER_BUCKET}/${PLANNER_PREFIX}/${designId}/${file}`,
    image_sha256: sha256,
    width: int(sample.width),
    height: int(sample.height),
    media: pick(sample.media, MEDIA, 'photo'),
    phase: pick(sample.phase, PHASE, 'unknown'),
    space: pick(sample.space, SPACE, 'unknown'),
    furniture: pick(sample.furniture, FURNITURE, 'unknown'),
    layout_shape: pick(sample.layout_shape, SHAPE, 'unknown'),
    attrs: cleanAttrs(sample.attrs),
    label_source: 'structured',
    confidence: null,
    // 고객이 올린 것(SEGAN 학습 허용)은 사람 검수 전엔 학습 금지 — 앱 규칙 그대로
    needs_review: userUploaded ? true : sample.needs_review === true,
    license: userUploaded ? 'user-uploaded' : 'restricted-internal',
    consent: userUploaded ? true : null,
    src_table: PLANNER_SRC_TABLE,
    src_updated_at: typeof sample.attrs?.addedAt === 'string' ? sample.attrs.addedAt : null,
    taxonomy_version: '1.1',
  };
}

/** 설계 한 줄 — 그림 없는 구조 레코드 (같은 묶음의 사진이 상속한다, dataset-schema.sql) */
export function designRow(designId, record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw bad('설계 레코드가 없습니다');
  const r = { ...record };
  delete r.name;   // 설계 이름에 고객 이름 · 주소가 섞일 수 있다 (플래너도 빼고 보낸다)
  if (JSON.stringify(r).length > RECORD_MAX) throw bad('설계 레코드가 너무 큽니다');
  return {
    sample_id: plannerGroupKey(designId),
    source: 'dadam_planner',
    group_key: plannerGroupKey(designId),
    image_url: null,
    image_sha256: null,
    width: null,
    height: null,
    media: 'floorplan',
    phase: 'unknown',
    space: 'kitchen',
    furniture: 'sink',
    layout_shape: pick(r.layout_shape, SHAPE, 'unknown'),
    attrs: { record: r },
    label_source: 'structured',
    confidence: null,
    needs_review: false,
    license: 'restricted-internal',
    consent: null,
    src_table: PLANNER_SRC_TABLE,
    src_updated_at: typeof r.design?.updatedAt === 'string' ? r.design.updatedAt : null,
    taxonomy_version: '1.1',
  };
}

async function groupRows(env, gk, h) {
  return h.select(env, `dataset_samples?select=sample_id,image_url,image_sha256,label_source,media,kind:attrs->>kind&group_key=eq.${encodeURIComponent(gk)}&limit=1000`);
}

/** 0009 를 DB 에 적용하기 전 — 표가 없다 (PostgREST PGRST205 · Postgres 42P01) */
const missingTable = (e) => /PGRST205|42P01/.test(String((e && e.message) || ''));

/**
 * 시공 완료 확인 — want 가 참이고 창고에 남는 시공 완료 사진(attrs.kind complete · media photo)이 있으면 한 줄, 아니면 지운다.
 * confirmed_at 은 처음 켠 때 그대로 둔다 (upsert 는 보낸 칸만 고친다).
 * @returns {{confirmed:boolean, photos:number, why?:'no_complete_photo'|'db_pending'}}
 */
async function setCompletion(env, gk, want, remaining, h, who) {
  const photos = remaining.filter((r) => r.kind === 'complete' && r.media === 'photo').length;
  try {
    if (want && photos > 0) {
      await h.upsert(env, COMPLETION_TABLE, [{ group_key: gk, complete_photos: photos, confirmed_by: who.id, updated_at: new Date().toISOString() }], 'group_key');
      return { confirmed: true, photos };
    }
    await h.remove(env, `${COMPLETION_TABLE}?group_key=eq.${encodeURIComponent(gk)}`);
    return want ? { confirmed: false, photos, why: 'no_complete_photo' } : { confirmed: false, photos };
  } catch (e) {
    if (missingTable(e)) return { confirmed: false, photos, why: 'db_pending' };
    throw e;
  }
}

/** POST /planner/state */
export async function plannerState(env, b, h) {
  const designId = designIdOf(b);
  const rows = await groupRows(env, plannerGroupKey(designId), h);
  return { samples: rows.map((r) => ({ sample_id: r.sample_id, image_sha256: r.image_sha256, label_source: r.label_source })) };
}

/** POST /planner/photo — 사진 한 장 (파일 + 표본) */
export async function plannerPhoto(env, b, h) {
  const designId = designIdOf(b);
  const file = String((b && b.fileName) || '');
  if (!FILE_RE.test(file)) throw bad('사진 파일 이름 형식이 아닙니다');
  const bytes = base64Bytes(b.file);
  if (bytes.length > PHOTO_MAX) throw bad('사진이 너무 큽니다 (15MB 까지)');
  const kind = sniff(bytes);
  if (!kind || kind !== file.split('.').pop()) throw bad('사진 형식이 파일 이름과 다릅니다 (JPEG · PNG · WEBP)');
  const sha = await sha256Hex(bytes);
  const row = photoRow(env, designId, b.sample, file, sha);
  const locked = (await groupRows(env, plannerGroupKey(designId), h)).some((r) => r.sample_id === row.sample_id && r.label_source === 'human');
  if (locked) return { sample_id: row.sample_id, skipped: 'human' };
  await h.putObject(env, PLANNER_BUCKET, `${PLANNER_PREFIX}/${designId}/${file}`, bytes, MIME[kind]);
  await h.upsert(env, 'dataset_samples', [row], 'sample_id');
  return { sample_id: row.sample_id, image_sha256: sha };
}

/** POST /planner/design — 설계 한 줄 · 수주 잇기 · 빠진 표본 지우기 · 시공 완료 확인. who = verifyAdmin 을 지난 관리자 */
export async function plannerDesign(env, b, h, who) {
  const designId = designIdOf(b);
  const gk = plannerGroupKey(designId);
  const orderNo = b.orderNo == null || b.orderNo === '' ? null : String(b.orderNo).trim();
  if (orderNo !== null && !ORDER_NO_RE.test(orderNo)) throw bad('수주번호 형식이 아닙니다 (예: SO-20261027-AB12)');
  const keep = Array.isArray(b.keep) ? b.keep.filter((s) => typeof s === 'string' && s.startsWith(`${gk}:`)).slice(0, KEEP_MAX) : [];
  const row = designRow(designId, Object.assign({}, b.record, { order_no: orderNo }));
  const rows = await groupRows(env, gk, h);
  const human = new Set(rows.filter((r) => r.label_source === 'human').map((r) => r.sample_id));
  if (!human.has(row.sample_id)) await h.upsert(env, 'dataset_samples', [row], 'sample_id');
  // 수주번호 → 앱 설계 (orders.design_id NOT NULL). 못 찾으면 비운다 — 창고 저장 · 검수만
  let order = null;
  if (orderNo) {
    const o = await h.select(env, `orders?select=design_id,status&order_no=eq.${encodeURIComponent(orderNo)}&limit=1`);
    order = o.length ? { found: true, status: o[0].status } : { found: false, status: null };
    await h.patch(env, `dataset_samples?group_key=eq.${encodeURIComponent(gk)}`, { design_id: o.length ? o[0].design_id : null });
  } else {
    await h.patch(env, `dataset_samples?group_key=eq.${encodeURIComponent(gk)}`, { design_id: null });
  }
  // 플래너에서 지운 사진 — 표본과 파일을 같이 (사람 검수 표본은 남긴다)
  const keepSet = new Set(keep.concat([row.sample_id]));
  const gone = rows.filter((r) => !keepSet.has(r.sample_id) && !human.has(r.sample_id));
  if (gone.length) {
    await h.remove(env, `dataset_samples?sample_id=in.(${gone.map((r) => `"${r.sample_id.replace(/"/g, '')}"`).join(',')})`);
    const prefix = `/storage/v1/object/public/${PLANNER_BUCKET}/`;
    const paths = gone.map((r) => String(r.image_url || '')).filter((u) => u.includes(prefix)).map((u) => u.split(prefix)[1]).filter((p) => p.startsWith(`${PLANNER_PREFIX}/${designId}/`));
    if (paths.length) await h.removeObjects(env, PLANNER_BUCKET, paths);
  }
  // 시공 완료 확인 — 보낸 때만 (completed 가 없으면 건드리지 않는다)
  let completion = null;
  if (typeof b.completed === 'boolean') {
    if (b.completed && !(who && who.id)) throw bad('시공 완료 확인은 관리자 계정으로만 합니다');
    const goneSet = new Set(gone.map((r) => r.sample_id));
    completion = await setCompletion(env, gk, b.completed, rows.filter((r) => !goneSet.has(r.sample_id)), h, who);
  }
  return { sample_id: row.sample_id, removed: gone.length, locked: human.size, order, completion };
}
