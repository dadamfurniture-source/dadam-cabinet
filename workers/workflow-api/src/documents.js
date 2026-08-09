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
  updateBy,
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
import { renderInstallationOrder } from './templates/installation-order.js';
import { getSiteInfo, listSchedulesForDoc } from './site-info.js';

// CD-4: 설치 작업지시서 추가. 여기만 고치면 안 된다 —
// DB 의 design_documents_doc_type_check 와 renderDocument 분기(아래)가 함께 맞아야 한다.
export const DOC_TYPES = ['customer_confirmation', 'work_order', 'installation_order'];
const DOC_TYPE_CODE = { customer_confirmation: 'CC', work_order: 'WO', installation_order: 'IO' };

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

  // CD-4: 설치 작업지시서는 발행 시점의 현장 정보·일정을 **문서 안에 동결**한다.
  // 주소가 나중에 바뀌어도 이미 나간 지시서의 내용은 그대로여야 한다.
  // (현장 정보는 설계에 붙어 있고 스냅샷에는 없다 — 주소 수정이 설계 rev 를
  //  올리면 안 되기 때문이다)
  if (docType === 'installation_order') {
    renderPayload.site_info = await getSiteInfo(env, designId);
    renderPayload.schedules = await listSchedulesForDoc(env, designId);
  }

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

  // 같은 종류의 이전 리비전을 자동으로 대체 처리한다.
  //
  // 예전엔 클라이언트가 body.supersedes 를 보낼 때만 돌았는데 어떤 화면도 그 필드를
  // 보내지 않았다. 그래서 확인서를 재발행해도 **구 공유 링크가 계속 살아 있었고**,
  // 고객이 옛 금액의 확인서를 그대로 열 수 있었다. share.js 의 superseded → 410
  // 분기도 도달할 수 없는 죽은 코드였다. (루프 실주행에서 잡힘)
  //
  // 재발행은 본질적으로 구 리비전을 대체하므로 옵션이 아니라 기본 동작이어야 한다.
  const superseded = await supersedePriorRevisions(env, {
    designId,
    docType,
    newDocId: created.id,
    newRev: rev,
  });

  // 다른 종류의 문서를 명시적으로 대체하려는 경우는 그대로 지원한다
  if (body.supersedes) {
    await supersedeDocument(env, { user, documentId: body.supersedes, replacementId: created.id });
  }

  return {
    document: finalDoc,
    superseded_count: superseded.total,
    // 그중 공유 링크가 실제로 닫힌 수 (승인·반려된 문서는 열람 가능하게 남는다)
    superseded_closed_count: superseded.closed,
    share_token: plainToken,
    share_url: plainToken ? buildShareUrl(env, plainToken) : null,
  };
}

/**
 * 같은 설계·같은 종류의 **이전 리비전**을 전부 대체 처리한다.
 *
 * 상태 처리 규칙: 고객이 이미 결정한 문서(승인/수정요청)는 **상태를 보존**하고
 * `superseded_by` 만 채운다. 그 결정 자체가 감사 기록이라 'superseded' 로 덮으면
 * "고객이 승인했다"·"고객이 반려했다"는 사실이 사라진다.
 * 결정이 없는 문서만 status='superseded' 로 바꿔 공유 링크를 410 으로 만든다.
 */
export async function supersedePriorRevisions(env, { designId, docType, newDocId, newRev }) {
  const base = {
    design_id: `eq.${designId}`,
    doc_type: `eq.${docType}`,
    rev: `lt.${newRev}`,
    superseded_by: 'is.null',
  };

  const decided = await updateBy(
    env,
    'design_documents',
    { ...base, decision: 'not.is.null' },
    { superseded_by: newDocId },
  );
  const undecided = await updateBy(
    env,
    'design_documents',
    { ...base, decision: 'is.null' },
    { superseded_by: newDocId, status: 'superseded' },
  );

  // PostgREST 가 갱신된 행을 돌려줄 때만 정확히 셀 수 있다
  // (restHeaders 의 기본 Prefer 가 return=representation 이라 배열이 온다).
  // 못 세는 상황이면 **0 으로 속이지 않고 null** 을 준다 —
  // 0 은 "대체된 것이 없다"는 뜻이라 옛 링크가 살아 있다는 오해를 부른다.
  const a = Array.isArray(decided) ? decided.length : null;
  const b = Array.isArray(undecided) ? undecided.length : null;
  if (a === null || b === null) return { total: null, closed: null };

  // total  = 대체된 문서 수
  // closed = 그중 **공유 링크가 실제로 닫힌** 수 (status='superseded' 로 바뀐 것).
  //   고객이 승인·반려한 문서는 상태를 보존하므로 링크가 계속 열린다 —
  //   그 문서가 고객이 확인한 원본이고, 수주의 근거이기 때문이다.
  //   둘을 구분하지 않으면 "옛 링크가 닫혔다" 는 잘못된 안내를 하게 된다.
  return { total: a + b, closed: b };
}

/** 구 문서를 대체 처리. 승인 이력은 지우지 않는다. */
export async function supersedeDocument(env, { user, documentId, replacementId }) {
  const doc = await selectOne(env, 'design_documents', { id: `eq.${documentId}`, select: '*' });
  if (!doc) throw new NotFoundError('대체할 문서를 찾을 수 없습니다');
  await assertDesignOwner(env, doc.design_id, user.id);

  const patch = { superseded_by: replacementId };
  // 고객이 이미 결정한 문서(승인/수정요청)는 상태를 유지한다.
  // 예전엔 'approved' 만 봤는데, 그러면 **반려된 문서가 'superseded' 로 덮여**
  // "고객이 수정을 요청했다"는 기록이 사라진다. 승인만큼이나 중요한 이력이다.
  // 상태만 바꾼다. share_token_hash 는 그대로 둔다 — 아래 revokeDocument 주석 참조.
  if (!doc.decision) patch.status = 'superseded';

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
  if (doc.doc_type === 'installation_order') return renderInstallationOrder(doc, snapshot, opts);
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
