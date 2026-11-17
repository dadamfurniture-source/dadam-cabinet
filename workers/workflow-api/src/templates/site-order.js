/**
 * 철거 지시서 · 납품 지시서 — 현장 A4 인쇄용
 * (2026-11-17 사장님 「각 작업자에게 보낼 작업지시서 각 작업에 작성되어서 확인」 · 「철거 · 납품 지시서를 새로 · 따로 발행」).
 *
 *   철거 (demolition_order): 현장 정보 · 반입 경로 + 일정 · 사무실 메모 + 현장 사진 + 철거 확인 (철거 후 사진)
 *   납품 (delivery_order):   현장 정보 · 반입 경로 + 일정 · 사무실 메모 + 싣는 품목 목록 + 납품 확인 (수량 · 하차 후 사진)
 *
 * 설치 지시서(installation-order.js)와 같은 현장 문서다 — 현장 정보 칸 · 모듈 명세 · 일정 표를 그 틀에서 그대로 가져다 쓴다
 * (주소 · 연락처를 여는 판정이 한 곳에만 있다 — siteBlock). 자재 재단 목록 · 금액 · 공유 링크가 없다.
 *
 * 사무실 메모(opts.memo)는 문서에 고정하지 않는다 — 그 작업 줄에 적어 둔 글(work_jobs.sheet_memo)을 인쇄할 때 읽어 넣는다.
 * 현장 사진(opts.sitePhotos — 철거 지시서만)도 고정하지 않는다 — 팩토리가 그 설계에 올려 둔 현장사진을 열 때 읽어 온
 *   1시간 서명 주소 (work/job-sheet.js sitePhotosOf). 작업자 보기에서는 주소와 같은 때에만 싣는다 (worker.siteOpen —
 *   처리방침 「5. 제3자 제공」 시공 작업자 줄: 수락한 때부터 작업이 끝나고 7일까지).
 * 확인 항목은 발행 때 문서에 고정한 목록(work/check-items.js v3 — 철거 · 납품 역할)에서 온다.
 */

import { esc, num, ymd, tr, thead, documentShell } from './html.js';
import { PRINT_TOOLBAR } from './print-css.js';
import { siteBlock, moduleSheet, scheduleSheet, itemLabel, isLineRow, SITE_CSS } from './installation-order.js';
import { materialsOf, isOutsourcedTopRow } from '../work-order-data.js';
import { checkListOfDoc, itemsFor, itemApplies } from '../work/check-items.js';

/** 문서 종류 → 이름 · 확인 역할 · 확인 칸 제목 */
export const SITE_ORDERS = Object.freeze({
  demolition_order: Object.freeze({ title: '철거 지시서', role: 'demolition', checks: '철거 확인', photos: true }),
  delivery_order: Object.freeze({ title: '납품 지시서', role: 'delivery', checks: '납품 확인', photos: false }),
});

const SITE_ORDER_CSS =
  SITE_CSS +
  `
      .site-photos { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6pt; margin: 4pt 0 8pt; }
      .site-photos figure { margin: 0; border: 0.4pt solid #000; padding: 4pt; text-align: center; font-size: 8.5pt; break-inside: avoid; }
      .site-photos img { display: block; max-width: 100%; max-height: 100mm; object-fit: contain; margin: 0 auto 2pt; }
    `;

/**
 * 이 문서 · 이 보기에 실을 현장 사진 주소 — 싣지 않는 문서(납품)거나 작업자 보기에서 현장이 닫혀 있으면 null
 * (주소 · 연락처와 같은 판정 — siteBlock). 실을 수 있는데 사진이 없으면 빈 목록.
 */
function photoUrls(kind, photos, worker) {
  if (!kind.photos || (worker && worker.siteOpen !== true)) return null;
  return (Array.isArray(photos) ? photos : []).map((p) => (p && typeof p.url === 'string' ? p.url : '')).filter(Boolean);
}

/** 현장 사진 장 (철거 지시서) — 팩토리가 그 설계에 올려 둔 현장사진. 사진이 없으면 장을 만들지 않는다 (표지에 「없음」 한 줄) */
function photoSheet(urls) {
  if (!urls || !urls.length) return '';
  return `
<div class="sheet">
  <h2>현장 사진 <span class="hint">철거할 자리 — 팩토리가 설계에 올려 둔 사진</span></h2>
  <div class="site-photos">${urls.map((u, i) => `<figure><img src="${esc(u)}" alt="현장 사진 ${i + 1}">현장 사진 ${i + 1}</figure>`).join('')}</div>
</div>`;
}

/** 확인 칸 — 그 역할의 항목 (필수 · 사진 표시). 목록이 없는 문서면 그리지 않는다 */
function checksBlock(doc, snapshot, kind) {
  const list = itemsFor(checkListOfDoc(doc), kind.role, 'order').filter((x) => x.paper !== 'sign' && itemApplies(x, null, snapshot));
  if (!list.length) return '';
  return `<h2>${esc(kind.checks)}</h2><div class="freetext">${list.map((x) => `${esc(x.label)}${x.must ? '' : ' <span class="muted">(권장)</span>'}${x.photo === 'need' ? ' <span class="muted">· 사진</span>' : ''} ☐`).join(' &nbsp; ')}</div>`;
}

/** 표지 — 문서 머리 · 사무실 메모 · 현장 정보 · 반입 경로 · 품목 요약 · 확인 칸. photos = photoUrls 의 값 (다음 장에 싣는 사진) */
function coverSheet(doc, snapshot, site, worker, kind, memo, photos) {
  const design = snapshot.design_payload || {};
  const items = Array.isArray(design.items) ? design.items : [];
  const s = site || {};
  const text = typeof memo === 'string' ? memo.trim() : '';
  const summaryRows = items
    .map((item, i) => tr([esc(itemLabel(item, i)), `${num(item.w)} × ${num(item.h)} × ${num(item.d)}`, `${(Array.isArray(item.modules) ? item.modules : []).length}개`]))
    .join('');
  return `
<div class="sheet">
  <h1>${esc(kind.title)}</h1>
  <table class="meta">
    <tbody>
      ${tr(['문서번호', esc(doc.doc_no), '발행일', ymd(doc.created_at)])}
      ${tr(['고객', esc(worker ? worker.orderLabel : doc.customer_name || doc.customer_name_masked || '-'), '설계 Rev', `r${snapshot.rev}`])}
    </tbody>
  </table>

  ${text ? `<h2>사무실 메모</h2><div class="freetext">${esc(text)}</div>` : ''}

  ${siteBlock(s, worker)}

  ${s.notes ? `<h2>특기 사항</h2><div class="freetext">${esc(s.notes)}</div>` : ''}

  ${photos ? `<h2>현장 사진</h2><div class="freetext muted">${photos.length ? `${photos.length}장 — 다음 장` : '없음'}</div>` : ''}

  <h2>품목</h2>
  <table>
    ${thead(['품목', 'W × H × D (mm)', '모듈 수'])}
    <tbody>${summaryRows || tr(['-', '-', '-'])}</tbody>
  </table>

  ${checksBlock(doc, snapshot, kind)}
</div>`;
}

/**
 * 싣는 품목 (납품) — 모듈 명세(설치 지시서와 같은 표) 뒤에 줄 부재 · 상판.
 *   줄 부재 = 품목에 한 번 붙는 판 (걸레받이 · 몰딩 · 마감재 …), 석재 상판은 상판 업체가 싣는다 (비고에 적는다).
 */
function loadSheet(snapshot) {
  const lines = materialsOf(snapshot).filter(isLineRow);
  const rows = lines
    .map((m) => tr([esc(m.part || ''), `${esc(m.material || '')} ${num(m.thickness)}T`, `${num(m.w)} × ${num(m.h)}`, num(m.qty), isOutsourcedTopRow(m) ? '상판 업체' : esc(m.note || '')], ['', '', 'num', 'num', '']))
    .join('');
  if (!rows) return '';
  return `
<div class="sheet">
  <h2>줄 부재 <span class="hint">모듈과 같이 싣는 것</span></h2>
  <table>
    ${thead(['부품', '자재', '가로 × 세로', '수량', '비고'])}
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

/**
 * @param {object} doc      design_documents 행 (doc_type demolition_order | delivery_order)
 * @param {object} snapshot 동결본
 * @param {{toolbar?:boolean, site?:object, schedules?:object[], worker?:{orderLabel:string, siteOpen:boolean}, memo?:string, sitePhotos?:{url:string}[]}} [opts]
 *   worker = 작업자 보기 (가린 주문 이름, 주소 · 연락처 · 현장 사진은 siteOpen 일 때만) · memo = 그 작업 줄의 사무실 메모 ·
 *   sitePhotos = 현장 사진 서명 주소 (철거 지시서만 그린다)
 */
export function renderSiteOrder(doc, snapshot, { toolbar = true, site = null, schedules = null, worker = null, memo = '', sitePhotos = null } = {}) {
  const kind = SITE_ORDERS[doc.doc_type];
  if (!kind) throw new Error(`현장 지시서가 아닌 문서입니다: ${doc.doc_type}`);
  const w = worker && worker.orderLabel ? worker : null;
  const rp = doc.render_payload || {};
  const photos = photoUrls(kind, sitePhotos, w);
  const body = [
    toolbar ? PRINT_TOOLBAR : '',
    coverSheet(doc, snapshot, site || rp.site_info, w, kind, memo, photos),
    photoSheet(photos),
    doc.doc_type === 'delivery_order' ? moduleSheet(snapshot).replace('<h2>설치 모듈 명세</h2>', '<h2>싣는 품목 — 모듈</h2>') : '',
    doc.doc_type === 'delivery_order' ? loadSheet(snapshot) : '',
    scheduleSheet(schedules || rp.schedules, w),
  ]
    .filter(Boolean)
    .join('\n');
  return documentShell({ title: `${kind.title} ${doc.doc_no}`, css: SITE_ORDER_CSS, body });
}
