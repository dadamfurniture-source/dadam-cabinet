/**
 * CAD 산출물 (CAD 베타 PR16b) — 동결 스냅샷의 조립 명세로 지은 GLB 를 받아 버킷 `cad` 에 보관한다.
 *
 * 표 · 버킷: database/design-cad-artifacts.sql (관리자 읽기 정책만 — 쓰기는 이 워커가 service_role 로만).
 *
 *   GET  /designs/:designId/cad-assembly        — 최신 동결 스냅샷의 명세 + 그 해시 (관리자). 플래너가 이 명세 그대로 GLB 를 짓는다
 *   POST /snapshots/:snapshotId/cad-artifacts?kind=cad|exterior  — GLB 본문 (관리자)
 *   GET  /snapshots/:snapshotId/cad-artifacts   — 목록 + 1시간 서명 URL (관리자)
 *
 * 동결본 인정: GLB 루트 노드 extras.assemblyHash 가 SHA-256(키 정렬 직렬화(bom_payload.assembly)) 와 같아야 한다.
 *   직렬화는 js/planner/planner-export.js plannerExportStableJson 과 같은 규칙 (stableJson) — 시험이 둘을 맞춰 본다.
 *   kind 와 GLB extras.vis 도 맞아야 한다 (cad ↔ 'all', exterior ↔ 'exterior').
 * 같은 스냅샷 · 같은 종류 · 같은 파일(sha256)은 한 번만 — 다시 올리면 기존 행을 돌려준다.
 *
 * 외관(exterior)은 고객 확인서 3D 보기에 싣는다 (2026-10-24 사장님) — 고객 화면에 partId 를 보이지 않으므로
 *   planner-export-cad/2 이상 (노드 part-N · module-N, extras 없음) 만 받는다. 따낸 판의 모양은 그대로.
 *   공개 확인서(GET /public/confirm)는 customerExteriorUrl 로 그 스냅샷의 최신 외관 GLB 서명 URL 을 싣는다.
 */
import { ForbiddenError, NotFoundError, ValidationError, ConflictError, DbError, selectOne, selectMany, insertOneIgnoreConflict } from './supabase.js';
import { isMissingRelation } from './work-order-data.js';
import { isAdmin } from './reports/admin.js';
import { sha256Hex } from './util/hash.js';
import { createSignedUrls, SIGNED_URL_TTL_SEC } from './storage.js';

export const CAD_BUCKET = 'cad';
export const CAD_KINDS = Object.freeze({ cad: 'all', exterior: 'exterior' });
// 크기 한도 — 외관 1MB 는 계획(PR16 완료 기준). 전체는 워커 요청 보호용 (지금 픽스처 GLB 는 수백 KB)
export const CAD_MAX_BYTES = Object.freeze({ cad: 20 * 1024 * 1024, exterior: 1024 * 1024 });
// 고객용 외관 GLB 를 내는 만든 쪽 버전 (planner-export.js PLANNER_EXPORT_CAD_VERSION). /1 외관은 partId 가 들어 있다
export const CUSTOMER_EXTERIOR_GENERATORS = Object.freeze(['planner-export-cad/2']);

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'

/** 키 정렬 직렬화 — planner-export.js plannerExportStableJson 과 같은 규칙 (undefined 키는 빼고, 배열 안 undefined 는 null). */
export function stableJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined ? 'null' : stableJson(x))).join(',') + ']';
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}';
}

export async function assemblyHashOf(assembly) {
  return sha256Hex(stableJson(assembly));
}

/** 바이트 SHA-256 → 소문자 hex */
export async function bytesSha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * GLB(바이너리 glTF 2.0) → 첫 청크 JSON. 머리 12바이트(magic · version · length) + 청크(length · type · data).
 * @param {ArrayBuffer|Uint8Array} buf
 */
export function glbJson(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8.byteLength < 20) throw new ValidationError('GLB 파일이 아닙니다 (너무 짧음)');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new ValidationError('GLB 파일이 아닙니다 (glTF 머리 없음)');
  if (dv.getUint32(4, true) !== 2) throw new ValidationError('glTF 2.0 GLB 만 받습니다');
  if (dv.getUint32(8, true) !== u8.byteLength) throw new ValidationError('GLB 길이가 머리와 다릅니다');
  const len = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== CHUNK_JSON || 20 + len > u8.byteLength) throw new ValidationError('GLB 첫 청크가 JSON 이 아닙니다');
  try {
    return JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + len)));
  } catch {
    throw new ValidationError('GLB JSON 청크를 해석할 수 없습니다');
  }
}

/** 장면 루트 노드 extras (planner-export.js plannerExportCadScene 의 root.userData) */
export function glbRootExtras(json) {
  const scene = json && Array.isArray(json.scenes) ? json.scenes[json.scene || 0] : null;
  const idx = scene && Array.isArray(scene.nodes) ? scene.nodes[0] : null;
  const node = idx != null && Array.isArray(json.nodes) ? json.nodes[idx] : null;
  return (node && node.extras) || null;
}

/**
 * GLB 가 이 동결 명세로 지은 것인지 본다. 맞으면 { extras, parts } — 아니면 409/422.
 * @param {Uint8Array} bytes
 * @param {object} assembly  스냅샷 bom_payload.assembly
 * @param {'cad'|'exterior'} kind
 */
export async function verifyCadGlb(bytes, assembly, kind) {
  const json = glbJson(bytes);
  const extras = glbRootExtras(json);
  if (!extras || extras.schema !== 'dadam.assembly/1' || extras.source !== 'dadam.assembly') {
    throw new ValidationError('조립 명세로 지은 CAD GLB 가 아닙니다 (루트 extras 없음)');
  }
  if ((extras.vis || 'all') !== CAD_KINDS[kind]) {
    throw new ValidationError(`GLB 종류가 다릅니다 — kind=${kind} 인데 GLB 는 vis=${extras.vis || 'all'}`);
  }
  const want = await assemblyHashOf(assembly);
  if (extras.assemblyHash !== want) {
    throw new ConflictError('GLB 의 명세 해시가 동결 스냅샷과 다릅니다 — 동결 명세로 다시 지어 주세요', { expected: want, got: extras.assemblyHash || null });
  }
  if (kind === 'exterior') {
    // 고객용 — 만든 쪽 버전 · 루트 밖 extras 없음 · 이름에 partId 없음
    if (!CUSTOMER_EXTERIOR_GENERATORS.includes(extras.generator)) {
      throw new ValidationError(`고객용 외관 GLB 가 아닙니다 (generator ${extras.generator || '-'}) — 플래너를 새로 고친 뒤 다시 지어 주세요`);
    }
    const root = json.nodes[json.scenes[json.scene || 0].nodes[0]];
    const leak = (json.nodes || []).some((n) => n && n !== root && ((n.extras && Object.keys(n.extras).length) || !/^(module|part)-\d+(\/\d+)?$/.test(String(n.name || ''))));
    if (leak) throw new ValidationError('외관 GLB 에 내부 이름 · extras 가 있습니다 — 고객 화면에 실을 수 없습니다');
    const parts = (json.nodes || []).filter((n) => /^part-\d+$/.test(String(n.name || ''))).length;
    const modules = (json.nodes || []).filter((n) => /^module-\d+$/.test(String(n.name || ''))).length;
    return { extras, parts, modules, assemblyHash: want };
  }
  const parts = (json.nodes || []).filter((n) => n && n.extras && n.extras.rowPartId).length;
  const modules = (json.nodes || []).filter((n) => n && /^module·/.test(String(n.name || ''))).length;
  return { extras, parts, modules, assemblyHash: want };
}

/** 버킷 안 경로 — 고객용(exterior)은 `exterior/` 접두사 (design-cad-artifacts.sql) */
export function cadPathOf({ designId, snapshotId, kind, sha256 }) {
  const name = `${kind}-${String(sha256).slice(0, 16)}.glb`;
  return kind === 'exterior' ? `exterior/${designId}/${snapshotId}/${name}` : `${designId}/${snapshotId}/${name}`;
}

async function assertAdmin(env, user) {
  if (!(await isAdmin(env, user))) throw new ForbiddenError('관리자만 할 수 있습니다');
}

async function frozenSnapshot(env, snapshotId) {
  const snap = await selectOne(env, 'design_snapshots', { id: `eq.${snapshotId}`, select: 'id,design_id,rev,content_hash,bom_payload' });
  if (!snap) throw new NotFoundError('스냅샷을 찾을 수 없습니다');
  const assembly = snap.bom_payload && snap.bom_payload.assembly;
  if (!assembly || assembly.schema !== 'dadam.assembly/1') {
    throw new ConflictError('이 스냅샷에는 조립 명세가 없습니다 — 설계를 다시 동결해 주세요');
  }
  return { snap, assembly };
}

/** 최신 동결 스냅샷(rev 가 가장 큰 것)의 명세 + 해시 (관리자 — 남의 설계도 연다) */
export async function getFrozenAssembly(env, { designId, user }) {
  await assertAdmin(env, user);
  const latest = await selectOne(env, 'design_snapshots', { design_id: `eq.${designId}`, select: 'id', order: 'rev.desc' });
  if (!latest) throw new NotFoundError('이 설계는 아직 동결한 스냅샷이 없습니다');
  const { snap, assembly } = await frozenSnapshot(env, latest.id);
  return {
    snapshot_id: snap.id, design_id: snap.design_id, rev: snap.rev, content_hash: snap.content_hash,
    assembly, assembly_hash: await assemblyHashOf(assembly),
  };
}

async function uploadObject(env, path, bytes) {
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${CAD_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'model/gltf-binary',
      // 경로에 파일 sha256 이 들어 있다 — 같은 경로면 같은 파일이라 덮어써도 된다 (행 기록 전에 끊겼다 다시 올릴 때)
      'x-upsert': 'true',
    },
    body: bytes,
  });
  if (!res.ok) throw new DbError(`Storage upload ${res.status}: ${await res.text()}`, res.status);
}

async function withUrl(env, row) {
  const urls = await createSignedUrls(env, CAD_BUCKET, [row.path]);
  return Object.assign({}, row, { url: urls.get(row.path) || null, url_expires_in: SIGNED_URL_TTL_SEC });
}

/**
 * GLB 올리기 (관리자). 동결 명세 해시가 맞아야 보관한다.
 * @returns {{ artifact, reused }}
 */
export async function uploadCadArtifact(env, { snapshotId, user, kind, bytes }) {
  await assertAdmin(env, user);
  if (!Object.prototype.hasOwnProperty.call(CAD_KINDS, kind)) throw new ValidationError('kind 는 cad 또는 exterior 입니다');
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || new ArrayBuffer(0));
  if (!u8.byteLength) throw new ValidationError('GLB 본문이 비었습니다');
  if (u8.byteLength > CAD_MAX_BYTES[kind]) {
    throw new ValidationError(`GLB 가 너무 큽니다 (${u8.byteLength} 바이트, ${kind} 한도 ${CAD_MAX_BYTES[kind]})`);
  }
  const { snap, assembly } = await frozenSnapshot(env, snapshotId);
  const { extras, parts, modules, assemblyHash } = await verifyCadGlb(u8, assembly, kind);
  const sha256 = await bytesSha256(u8);

  const existing = await selectOne(env, 'design_cad_artifacts', { snapshot_id: `eq.${snap.id}`, kind: `eq.${kind}`, sha256: `eq.${sha256}`, select: '*' });
  if (existing) return { artifact: await withUrl(env, existing), reused: true };

  const path = cadPathOf({ designId: snap.design_id, snapshotId: snap.id, kind, sha256 });
  await uploadObject(env, path, u8);
  const row = {
    design_id: snap.design_id, snapshot_id: snap.id, content_hash: snap.content_hash, assembly_hash: assemblyHash,
    kind, path, bytes: u8.byteLength, sha256,
    generator_version: extras.generator || null, rules_version: extras.rulesVersion || assembly.rulesVersion || null,
    parts, modules, created_by: user.id,
  };
  const inserted = await insertOneIgnoreConflict(env, 'design_cad_artifacts', row);
  // 동시에 같은 파일을 올렸으면 먼저 들어간 행을 돌려준다
  const saved = inserted || (await selectOne(env, 'design_cad_artifacts', { snapshot_id: `eq.${snap.id}`, kind: `eq.${kind}`, sha256: `eq.${sha256}`, select: '*' }));
  return { artifact: await withUrl(env, saved || row), reused: !inserted };
}

/**
 * 고객 확인서 3D 보기 — 그 스냅샷의 최신 고객용 외관 GLB 서명 URL (1시간). 없으면 null.
 *   표가 없는 DB(SQL 전)도 null. 관리자가 플래너에서 📤 동결본 GLB 를 눌러야 생긴다.
 */
export async function customerExteriorUrl(env, snapshotId) {
  let row;
  try {
    row = await selectOne(env, 'design_cad_artifacts', {
      snapshot_id: `eq.${snapshotId}`, kind: 'eq.exterior',
      generator_version: `in.(${CUSTOMER_EXTERIOR_GENERATORS.join(',')})`,
      select: 'path,created_at', order: 'created_at.desc',
    });
  } catch (err) {
    if (isMissingRelation(err)) return null;
    throw err;
  }
  if (!row) return null;
  const urls = await createSignedUrls(env, CAD_BUCKET, [row.path]);
  return urls.get(row.path) || null;
}

/** 목록 + 서명 URL (관리자). 최신 순. */
export async function listCadArtifacts(env, { snapshotId, user }) {
  await assertAdmin(env, user);
  const rows = (await selectMany(env, 'design_cad_artifacts', { snapshot_id: `eq.${snapshotId}`, select: '*', order: 'created_at.desc' })) || [];
  const urls = await createSignedUrls(env, CAD_BUCKET, rows.map((r) => r.path));
  return rows.map((r) => Object.assign({}, r, { url: urls.get(r.path) || null, url_expires_in: SIGNED_URL_TTL_SEC }));
}
