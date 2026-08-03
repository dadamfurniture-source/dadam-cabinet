/**
 * 작업지시서 — 공장 A4 인쇄용.
 *
 * 서버 렌더인 이유:
 *   1) 공장은 계정이 없다. 링크 하나로 열려야 실무가 굴러간다.
 *   2) 인쇄물은 동결된 문서다. 프론트 리팩터나 ?v= 캐시 스큐가 과거
 *      작업지시서의 내용을 바꾸면 안 된다.
 *
 * ★ 금액을 표시하지 않는다. 고객확인서와의 결정적 차이.
 */

import { esc, num, ymd, tr, thead, documentShell } from './html.js';
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

const MODULE_POS = { upper: '상부', lower: '하부' };

function itemLabel(item, index) {
  return (
    item.labelName ||
    CATEGORY_NAMES[item.categoryId || item.category] ||
    item.name ||
    `품목 ${index + 1}`
  );
}

/** 표지 — 문서 정보 + 품목 요약 + 서명란. */
function coverSheet(doc, snapshot) {
  const design = snapshot.design_payload || {};
  const items = Array.isArray(design.items) ? design.items : [];

  const summaryRows = items
    .map((item, i) =>
      tr(
        [
          esc(itemLabel(item, i)),
          esc(CATEGORY_NAMES[item.categoryId || item.category] || item.categoryId || '-'),
          `${num(item.w)} × ${num(item.h)} × ${num(item.d)}`,
          num(Array.isArray(item.modules) ? item.modules.length : 0),
        ],
        ['', '', 'num', 'num'],
      ),
    )
    .join('');

  return `
<div class="sheet">
  <div class="doc-header">
    <div>
      <h1>작 업 지 시 서</h1>
      <div>${esc(doc.title)}</div>
    </div>
    <div class="doc-meta">
      <div class="doc-no">${esc(doc.doc_no)}</div>
      <div>Rev. ${esc(doc.rev)}</div>
      <div>발행 ${esc(ymd(doc.created_at))}</div>
    </div>
  </div>

  <div class="section-title">기본 정보</div>
  <dl class="kv">
    <dt>고객</dt><dd>${esc(doc.customer_name || doc.customer_name_masked || '-')}</dd>
    <dt>설계 rev</dt><dd>${esc(snapshot.rev)}</dd>
    <dt>품목 수</dt><dd>${num(snapshot.item_count)}</dd>
    <dt>모듈 수</dt><dd>${num(snapshot.module_count)}</dd>
    <dt>부재 수</dt><dd>${num(snapshot.panel_count)}</dd>
    <dt>설계 해시</dt><dd class="doc-no">${esc(String(snapshot.content_hash).slice(0, 12))}</dd>
  </dl>

  <div class="section-title">품목 요약</div>
  <table>
    ${thead(['품목', '분류', 'W × H × D (mm)', '모듈'], ['', '', 'num', 'num'])}
    <tbody>${summaryRows || tr(['품목 없음', '', '', ''])}</tbody>
  </table>

  <div class="section-title">특기사항</div>
  <div class="note" style="min-height:24mm; border:0.4pt solid #999; padding:6pt;">
    ${esc(doc.render_payload?.instructions || '')}
  </div>

  <div class="sign-box no-break">
    <div>제작 담당<br><br></div>
    <div>검수<br><br></div>
    <div>출고<br><br></div>
  </div>
</div>`;
}

/** 아이템별 모듈 명세. */
function moduleSheets(snapshot) {
  const design = snapshot.design_payload || {};
  const items = Array.isArray(design.items) ? design.items : [];
  if (items.length === 0) return '';

  const rows = items
    .flatMap((item, i) => {
      const label = itemLabel(item, i);
      const modules = Array.isArray(item.modules) ? item.modules : [];
      return modules.map((m) =>
        tr(
          [
            esc(label),
            esc(MODULE_POS[m.pos] || m.pos || '-'),
            esc(m.name || m.type || '-'),
            `${num(m.w)} × ${num(m.h)} × ${num(m.d)}`,
            num(m.doorCount || 0),
            esc(
              [
                m.isDrawer ? '서랍' : '',
                m.isEL ? 'EL' : '',
                m.isFixed ? '고정' : '',
                m.isDerived ? '멍장파생' : '',
                m.line || m.orientation ? `라인:${m.line || m.orientation}` : '',
                m.doorFinish ? `마감:${m.doorFinish}` : '',
                m.doorColor ? `색:${m.doorColor}` : '',
              ]
                .filter(Boolean)
                .join(' · '),
            ),
          ],
          ['', '', '', 'num', 'num', ''],
        ),
      );
    })
    .join('');

  return `
<div class="sheet">
  <div class="section-title">모듈 명세</div>
  <table>
    ${thead(['품목', '위치', '모듈', 'W × H × D (mm)', '도어', '비고'], ['', '', '', 'num', 'num', ''])}
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

/** 자재 재단 목록. 여러 장에 걸치므로 thead 반복이 중요하다. */
function materialSheet(snapshot) {
  const materials = Array.isArray(snapshot.bom_payload?.materials)
    ? snapshot.bom_payload.materials
    : [];
  if (materials.length === 0) return '';

  const rows = materials
    .map((m) =>
      tr(
        [
          esc(m.itemLabel || ''),
          esc(m.module || ''),
          esc(m.part || ''),
          esc(m.material || ''),
          num(m.thickness),
          num(m.w),
          num(m.h),
          num(m.qty),
          esc(m.edge || '-'),
          esc([m.finishCode, m.note].filter(Boolean).join(' / ')),
        ],
        ['', '', '', '', 'num', 'num', 'num', 'num', '', ''],
      ),
    )
    .join('');

  return `
<div class="sheet">
  <div class="section-title">자재 재단 목록 (${num(materials.length)}건)</div>
  <table>
    ${thead(
      ['품목', '모듈', '부품', '자재', '두께', '가로', '세로', '수량', '엣지', '비고'],
      ['', '', '', '', 'num', 'num', 'num', 'num', '', ''],
    )}
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

/** 부자재 목록. */
function hardwareSheet(snapshot) {
  const hardware = Array.isArray(snapshot.hardware_payload?.hardware)
    ? snapshot.hardware_payload.hardware
    : [];
  if (hardware.length === 0) return '';

  const rows = hardware
    .map((h) =>
      tr(
        [
          esc(h.category || ''),
          esc(h.item || ''),
          esc(h.manufacturer || ''),
          esc(h.spec || ''),
          num(h.qty),
          esc(h.unit || ''),
          esc(h.note || ''),
        ],
        ['', '', '', '', 'num', '', ''],
      ),
    )
    .join('');

  return `
<div class="sheet">
  <div class="section-title">부자재 목록 (${num(hardware.length)}건)</div>
  <table>
    ${thead(['분류', '품목', '제조사', '규격', '수량', '단위', '비고'], ['', '', '', '', 'num', '', ''])}
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

export function renderWorkOrder(doc, snapshot, { toolbar = true } = {}) {
  const body = [
    toolbar ? PRINT_TOOLBAR : '',
    coverSheet(doc, snapshot),
    moduleSheets(snapshot),
    materialSheet(snapshot),
    hardwareSheet(snapshot),
  ].join('\n');

  return documentShell({
    title: `작업지시서 ${doc.doc_no}`,
    css: PRINT_CSS,
    body,
  });
}
