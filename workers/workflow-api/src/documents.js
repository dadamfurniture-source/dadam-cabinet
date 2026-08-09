/**
 * 문서 발행 / 조회 / 고객 열람 · 승인.
 *
 * append-only 다. 재발행하면 새 rev 를 만들고 구 문서는 삭제하지 않고
 * status='superseded' + superseded_by 로 연결한다 (감사 추적 보존).
 * 이미 승인된 문서는 status='approved' 를 유지하고 superseded_by 만 채운다.
 */

import {
  ValidationError,
  ConflictError,
  NotFoundError,
  GoneError,
  ForbiddenError,
  assertDesignOwner,
  insertOne,
  selectOne,
  selectMany,
  updateById,
} from './supabase.js';
import { sha256Hex } from './util/hash.js';
import { getSnapshot, latestHash } from './snapshots.js';
import {
  generateShareToken,
  hashShareToken,
  hashAccessPin,
  hashIp,
  buildShareUrl,
  shareExpiryIso,
  checkAccessible,
  verifyPin,
  maskName,
} from './share.js';
import { renderCustomerConfirmation } from './templates/customer-confirmation.js';
import { renderWorkOrder } from './templates/work-order.js';

export const DOC_TYPES = ['customer_confirmation', 'work_order'];
const DOC_TYPE_CODE = { customer_confirmation: 'CC', work_order: 'WO' };

function todayCompact() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

/** 'DD-20260803-A1B2-CC-r1' */
function buildDocNo(designId, docType, rev) {
  const short = String(designId).replace(/-/g, '').slice(0, 4).toUpperCase();
  return `DD-${todayCompact()}-${short}-${DOC_TYPE_CODE[docType]}-r${rev}`;
}

async function nextDocRev(env, designId, docType) {
  const rows = await selectMany(env, 'design_documents', {
    design_id: `eq.${designId}`,
    doc_type: `eq.${docType}`,
    select: 'rev',
    order: 'rev.desc',
    limit: '1',
  });
  return rows && rows.length ? Number(rows[0].rev) + 1 : 1;
}

/** 문서 발행. customer_confirmation 이면 평문 토큰을 함께 돌려준다 (1회만). */
export async function issueDocument(env, { user, body }) {
  const docType = body.doc_type;
  if (!DOC_TYPES.includes(docType)) {
    throw new ValidationError(`doc_type 은 ${DOC_TYPES.join(' 또는 ')} 여야 합니다`);
  }
  if (!body.snapshot_id) throw new ValidationError('snapshot_id 가 필요합니다');

  // getSnapshot 이 소유권까지 확인한다
  const snapshot = await getSnapshot(env, { snapshotId: body.snapshot_id, user });
  const designId = snapshot.design_id;

  const rev = await nextDocRev(env, designId, docType);
  const docNo = buildDocNo(designId, docType, rev);

  const customerName =
    typeof body.customer_name === 'string' ? body.customer_name.trim() : '';

  const renderPayload = {
    quote: snapshot.quote_payload,
    instructions: typeof body.instructions === 'string' ? body.instructions : '',
    issued_by: user.email || null,
  };

  const row = {
    design_id: designId,
    snapshot_id: snapshot.id,
    doc_type: docType,
    rev,
    doc_no: docNo,
    status: 'issued',
    title: (typeof body.title === 'string' && body.title.trim()) || snapshot.design_title || '무제 설계',
    customer_name: customerName || null,
    customer_name_masked: customerName ? maskName(customerName) : null,
    render_payload: renderPayload,
    totals: snapshot.quote_payload
      ? {
          subtotal: snapshot.quote_payload.subtotal,
          vat: snapshot.quote_payload.vat,
          total: snapshot.quote_payload.total,
        }
      : {},
    content_hash: await sha256Hex(`${snapshot.content_hash}|${docType}|${rev}`),
    created_by: user.id,
  };

  let plainToken = null;
  if (docType === 'customer_confirmation') {
    plainToken = generateShareToken();
    row.share_token_hash = await hashShareToken(env, plainToken);
    row.expires_at = shareExpiryIso(env, body.valid_days);
    if (body.access_pin) {
      // PIN 해시는 document id 를 섞는데 아직 id 가 없다 → 삽입 후 갱신한다
      row.access_pin_hash = 'pending';
    }
  }

  const created = await insertOne(env, 'design_documents', row);

  // PIN 해시를 실제 id 로 다시 계산
  let finalDoc = created;
  if (docType === 'customer_confirmation' && body.access_pin) {
    finalDoc = await updateById(env, 'design_documents', created.id, {
      access_pin_hash: await hashAccessPin(env, created.id, body.access_pin),
    });
  }

  // 이전 문서 supersede
  if (body.supersedes) {
    await supersedeDocument(env, { user, documentId: body.supersedes, replacementId: created.id });
  }

  return {
    document: finalDoc,
    share_token: plainToken,
    share_url: plainToken ? buildShareUrl(env, plainToken) : null,
  };
}

/** 구 문서를 대체 처리. 승인 이력은 지우지 않는다. */
export async function supersedeDocument(env, { user, documentId, replacementId }) {
  const doc = await selectOne(env, 'design_documents', { id: `eq.${documentId}`, select: '*' });
  if (!doc) throw new NotFoundError('대체할 문서를 찾을 수 없습니다');
  await assertDesignOwner(env, doc.design_id, user.id);

  const patch = { superseded_by: replacementId };
  // 승인된 문서는 감사 추적을 위해 상태를 유지하고, 그 외에는 superseded 로 바꾼다.
  // 상태만 바꾼다. share_token_hash 는 그대로 둔다 — 아래 revokeDocument 주석 참조.
  if (doc.status !== 'approved') patch.status = 'superseded';

  return updateById(env, 'design_documents', documentId, patch);
}

export async function revokeDocument(env, { user, documentId }) {
  const doc = await selectOne(env, 'design_documents', { id: `eq.${documentId}`, select: '*' });
  if (!doc) throw new NotFoundError('문서를 찾을 수 없습니다');
  await assertDesignOwner(env, doc.design_id, user.id);

  // ★ share_token_hash 를 NULL 로 지우지 않는다.
  //   지우면 openSharedDocument 의 토큰 조회가 아예 실패해서 404 가 나가고,
  //   checkAccessible 의 revoked/superseded → 410 분기가 죽은 코드가 된다.
  //   고객 입장에서 404 는 "링크를 다시 확인하세요"(오타 의심)로 읽히지만,
  //   실제로는 담당자가 회수한 것이므로 410 "재발급을 요청하세요" 가 맞다.
  //   접근 차단은 status 검사가 하므로 해시를 남겨도 안전하다
  //   (해시는 역산 불가하고, 토큰은 32바이트 랜덤이라 재사용 충돌도 없다).
  return updateById(env, 'design_documents', documentId, { status: 'revoked' });
}

/**
 * 문서 목록. 각 문서가 최신 스냅샷 기준으로 낡았는지(stale) 계산해서 붙인다.
 * ★ 판정은 content_hash 비교로만 한다 — designs.updated_at 은 트리거가 오염시킨다.
 */
export async function listDocuments(env, { designId, user }) {
  await assertDesignOwner(env, designId, user.id);

  const [docs, newest] = await Promise.all([
    selectMany(env, 'design_documents', {
      design_id: `eq.${designId}`,
      select:
        'id,doc_type,rev,doc_no,status,title,customer_name_masked,totals,expires_at,' +
        'first_viewed_at,view_count,decision,decided_at,signer_name,superseded_by,' +
        'snapshot_id,created_at',
      order: 'created_at.desc',
      limit: '100',
    }),
    latestHash(env, designId),
  ]);

  if (!docs || docs.length === 0) return [];

  // 문서가 참조하는 스냅샷들의 해시를 한 번에 가져온다
  const snapshotIds = [...new Set(docs.map((d) => d.snapshot_id))];
  const snapshots = await selectMany(env, 'design_snapshots', {
    id: `in.(${snapshotIds.join(',')})`,
    select: 'id,rev,content_hash',
  });
  const hashById = new Map((snapshots || []).map((s) => [s.id, s]));

  return docs.map((d) => {
    const snap = hashById.get(d.snapshot_id);
    return {
      ...d,
      snapshot_rev: snap ? snap.rev : null,
      stale: Boolean(newest && snap && snap.content_hash !== newest),
      has_share_link: d.doc_type === 'customer_confirmation' && d.status === 'issued',
    };
  });
}

export async function getDocumentForOwner(env, { documentId, user }) {
  const doc = await selectOne(env, 'design_documents', { id: `eq.${documentId}`, select: '*' });
  if (!doc) throw new NotFoundError('문서를 찾을 수 없습니다');
  await assertDesignOwner(env, doc.design_id, user.id);
  const snapshot = await selectOne(env, 'design_snapshots', {
    id: `eq.${doc.snapshot_id}`,
    select: '*',
  });
  if (!snapshot) throw new NotFoundError('문서가 참조하는 스냅샷이 없습니다');
  return { doc, snapshot };
}

export function renderDocument(doc, snapshot, opts = {}) {
  if (doc.doc_type === 'work_order') return renderWorkOrder(doc, snapshot, opts);
  return renderCustomerConfirmation(doc, snapshot, opts);
}

// ===== 공개(비로그인) 경로 =====

async function logAccess(env, documentId, event, request) {
  try {
    await insertOne(env, 'document_access_log', {
      document_id: documentId,
      event,
      ip_hash: await hashIp(env, request),
      user_agent: (request.headers.get('User-Agent') || '').slice(0, 500),
    });
  } catch (e) {
    // 로그 실패가 열람을 막아서는 안 된다
    console.error('access log failed:', e && e.message);
  }
}

/**
 * 공유 토큰으로 문서를 연다.
 * 토큰 자체는 해시 조회라 타이밍 공격이 무의미하다.
 */
export async function openSharedDocument(env, request, { token, pin }) {
  if (!token) throw new ValidationError('공유 토큰이 없습니다');

  const tokenHash = await hashShareToken(env, token);
  const doc = await selectOne(env, 'design_documents', {
    share_token_hash: `eq.${tokenHash}`,
    select: '*',
  });

  if (!doc) {
    await logAccess(env, null, 'not_found', request);
    throw new NotFoundError('링크를 찾을 수 없습니다');
  }

  const access = checkAccessible(doc);
  if (!access.ok) {
    await logAccess(env, doc.id, access.reason === 'expired' ? 'expired' : 'view', request);
    throw new GoneError(
      access.reason === 'expired'
        ? '링크 유효기간이 지났습니다. 담당자에게 재발급을 요청해 주세요.'
        : '더 이상 유효하지 않은 링크입니다. 최신 확인서를 요청해 주세요.',
    );
  }

  const pinResult = await verifyPin(env, doc, pin);
  if (pinResult.patch) {
    await updateById(env, 'design_documents', doc.id, pinResult.patch);
  }
  if (!pinResult.ok) {
    await logAccess(
      env,
      doc.id,
      pinResult.reason === 'pin_locked' ? 'pin_locked' : 'pin_fail',
      request,
    );
    const err = new ForbiddenError(
      pinResult.reason === 'pin_required'
        ? '접근 번호를 입력해 주세요.'
        : pinResult.reason === 'pin_locked'
          ? '접근 시도가 많아 30분간 잠겼습니다.'
          : '접근 번호가 일치하지 않습니다.',
    );
    err.statusCode = pinResult.status;
    err.reason = pinResult.reason;
    throw err;
  }

  const snapshot = await selectOne(env, 'design_snapshots', {
    id: `eq.${doc.snapshot_id}`,
    select: '*',
  });
  if (!snapshot) throw new NotFoundError('문서 내용을 찾을 수 없습니다');

  // 열람 흔적 — 유출 감지에 실용적이다
  await updateById(env, 'design_documents', doc.id, {
    view_count: (doc.view_count || 0) + 1,
    first_viewed_at: doc.first_viewed_at || new Date().toISOString(),
    status: doc.status === 'issued' ? 'viewed' : doc.status,
  });
  await logAccess(env, doc.id, 'view', request);

  return { doc, snapshot };
}

/**
 * 고객 승인/거절 기록.
 * 승인 시점의 문서가 고객이 본 그 문서인지 content_hash 로 재확인한다.
 */
/**
 * CD-6: 수정 요청 사유 코드.
 *
 * 자유 텍스트 메모만으로는 "왜 반려됐는지" 를 집계할 수 없어
 * 승인률 학습의 라벨이 되지 못했다. 코드로 받되 메모는 그대로 병행한다
 * (코드로 안 잡히는 사유가 반드시 나오므로 메모를 없애면 안 된다).
 */
export const DECISION_REASON_CODES = [
  'dimension',   // 치수
  'layout',      // 배치·구성
  'color',       // 색상·마감
  'price',       // 금액
  'schedule',    // 일정·납기
  'other',       // 기타
];

function normalizeReasons(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  for (const raw of input.slice(0, DECISION_REASON_CODES.length)) {
    const code = String(raw || '').trim();
    if (DECISION_REASON_CODES.includes(code)) seen.add(code);
  }
  return [...seen];
}

export async function recordDecision(env, request, { token, pin, decision, signerName, memo, reasons }) {
  if (!['approved', 'rejected'].includes(decision)) {
    throw new ValidationError('decision 은 approved 또는 rejected 여야 합니다');
  }
  if (!signerName || !String(signerName).trim()) {
    throw new ValidationError('성함을 입력해 주세요');
  }

  const { doc, snapshot } = await openSharedDocument(env, request, { token, pin });

  if (doc.decision) {
    throw new ConflictError('이미 처리된 확인서입니다');
  }

  // 승인은 PIN 이 설정돼 있으면 반드시 통과해야 한다 (openSharedDocument 가 이미 검증)
  const expected = await sha256Hex(`${snapshot.content_hash}|${doc.doc_type}|${doc.rev}`);
  if (expected !== doc.content_hash) {
    throw new ConflictError('문서 내용이 변경되었습니다. 최신 확인서를 요청해 주세요.');
  }

  const updated = await updateById(env, 'design_documents', doc.id, {
    status: decision === 'approved' ? 'approved' : 'rejected',
    decision,
    decided_at: new Date().toISOString(),
    signer_name: String(signerName).trim().slice(0, 100),
    signer_ip_hash: await hashIp(env, request),
    signer_user_agent: (request.headers.get('User-Agent') || '').slice(0, 500),
    render_payload: {
      ...doc.render_payload,
      decision_memo: String(memo || '').slice(0, 2000),
      // CD-6: 집계 가능한 사유 코드. 승인에도 붙을 수 있으나 보통 비어 있다.
      decision_reasons: normalizeReasons(reasons),
    },
  });

  await logAccess(env, doc.id, 'decision', request);
  return { doc: updated, snapshot };
}
