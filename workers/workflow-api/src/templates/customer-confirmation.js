/**
 * 고객 확인서 — 화면 열람 + 인쇄 겸용.
 *
 * 작업지시서와 달리 금액을 표시하고, 고객이 [확인] 을 눌러 승인할 수 있다.
 * 공유 링크로 열리므로 고객명은 마스킹본만 싣는다 (연락처·상세주소는 미포함).
 */

import { esc, krw, num, ymd, ymdhm, tr, thead, documentShell } from './html.js';
import { PRINT_CSS, PRINT_TOOLBAR } from './print-css.js';

const CATEGORY_NAMES = {
  sink: '싱크대',
  island: '아일랜드',
  wardrobe: '붙박이장',
  fridge: '냉장고장',
  shoerack: '신발장',
  vanity: '화장대',
  storage: '수납장',
  warehouse: '창고장',
  door: '도어교체',
  custom: '비규격장',
};

/** 고객이 이해할 수 있는 수준의 사양 요약 — 부재 목록은 넣지 않는다. */
function specSheet(doc, snapshot) {
  const design = snapshot.design_payload || {};
  const items = Array.isArray(design.items) ? design.items : [];

  const rows = items
    .map((item, i) => {
      const specs = item.specs || {};
      const finish = [specs.doorFinishLower, specs.doorColorLower].filter(Boolean).join(' · ');
      return tr(
        [
          esc(item.labelName || CATEGORY_NAMES[item.categoryId] || `품목 ${i + 1}`),
          esc(CATEGORY_NAMES[item.categoryId || item.category] || item.categoryId || '-'),
          `${num(item.w)} × ${num(item.h)} × ${num(item.d)}`,
          esc(finish || '-'),
        ],
        ['', '', 'num', ''],
      );
    })
    .join('');

  return `
  <div class="section-title">설계 사양</div>
  <table>
    ${thead(['품목', '분류', 'W × H × D (mm)', '도어 마감 · 색상'], ['', '', 'num', ''])}
    <tbody>${rows || tr(['품목 없음', '', '', ''])}</tbody>
  </table>`;
}

function quoteSheet(quote) {
  if (!quote || !Array.isArray(quote.items) || quote.items.length === 0) {
    return '<div class="section-title">견적</div><p class="note">견적 항목이 없습니다.</p>';
  }

  const rows = quote.items
    .map((i) =>
      tr(
        [
          esc(i.name),
          esc(i.quantity || ''),
          i.unit_price === null || i.unit_price === undefined ? '-' : krw(i.unit_price),
          krw(i.total),
        ],
        ['', 'num', 'num', 'num'],
      ),
    )
    .join('');

  const skipped =
    Array.isArray(quote.skipped) && quote.skipped.length
      ? `<div class="warn">다음 품목은 별도 협의가 필요합니다: ${esc(
          quote.skipped.map((s) => s.label).join(', '),
        )}</div>`
      : '';

  const range = quote.range
    ? `<p class="note">시공 조건에 따라 최종 금액은 ${krw(quote.range.min)} ~ ${krw(
        quote.range.max,
      )} 범위에서 조정될 수 있습니다.</p>`
    : '';

  return `
  <div class="section-title">견적</div>
  <table>
    ${thead(['항목', '수량', '단가', '금액'], ['', 'num', 'num', 'num'])}
    <tbody>${rows}</tbody>
  </table>
  ${skipped}
  <table class="totals">
    <tbody>
      ${tr(['공급가액', krw(quote.subtotal)], ['', 'num'])}
      ${tr(['부가세 (10%)', krw(quote.vat)], ['', 'num'])}
      <tr class="grand"><td>합계</td><td class="num">${krw(quote.total)}</td></tr>
    </tbody>
  </table>
  ${range}`;
}

/**
 * 결정 스탬프. 이미 처리된 문서에만 나온다 — 인쇄물에도 남아야 하므로
 * no-print 를 붙이지 않는다.
 *
 * 승인 폼(입력/버튼)은 이 문서가 아니라 confirm.html 이 가진다.
 * 문서는 iframe srcdoc 으로 렌더되므로 폼을 안에 두면 부모와 통신해야 하는데,
 * 그 복잡도를 감수할 이유가 없다.
 */
function decisionStamp(doc) {
  if (doc.decision === 'approved') {
    return `<div class="stamp">${esc(ymdhm(doc.decided_at))} · ${esc(
      doc.signer_name || '고객',
    )} 님 확인 완료</div>`;
  }
  if (doc.decision === 'rejected') {
    return `<div class="warn">${esc(ymdhm(doc.decided_at))} · 수정 요청이 접수되었습니다.</div>`;
  }
  return '';
}

export function renderCustomerConfirmation(doc, snapshot, { toolbar = true } = {}) {
  const quote = doc.render_payload?.quote || snapshot.quote_payload;
  const validUntil = doc.expires_at ? ymd(doc.expires_at) : null;

  const body = `
${toolbar ? PRINT_TOOLBAR : ''}
<div class="sheet">
  <div class="doc-header">
    <div>
      <h1>설계 확인서</h1>
      <div>${esc(doc.title)}</div>
    </div>
    <div class="doc-meta">
      <div class="doc-no">${esc(doc.doc_no)}</div>
      <div>Rev. ${esc(doc.rev)}</div>
      <div>발행 ${esc(ymd(doc.created_at))}</div>
    </div>
  </div>

  <dl class="kv">
    <dt>고객</dt><dd>${esc(doc.customer_name_masked || '-')}</dd>
    <dt>품목 수</dt><dd>${num(snapshot.item_count)}</dd>
    <dt>설계 rev</dt><dd>${esc(snapshot.rev)}</dd>
    <dt>유효기간</dt><dd>${esc(validUntil || '-')}</dd>
  </dl>

  ${specSheet(doc, snapshot)}
  ${quoteSheet(quote)}

  <div class="note">
    · 본 확인서는 설계 사양과 예상 금액을 확인하기 위한 문서이며, 계약서가 아닙니다.<br>
    · 실측 결과에 따라 치수와 금액이 조정될 수 있습니다.<br>
    · 유효기간이 지나면 링크가 만료되며, 다시 발급받으실 수 있습니다.
  </div>

  ${decisionStamp(doc)}
</div>`;

  return documentShell({
    title: `설계 확인서 ${doc.doc_no}`,
    css: PRINT_CSS,
    body,
  });
}
