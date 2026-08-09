/**
 * 설치 작업지시서 — 현장 A4 인쇄용.
 *
 * 제작 작업지시서(work-order.js)와 목적이 다르다.
 *   제작: 공장이 **부재를 자르기** 위한 문서 → 자재 재단 목록이 본문
 *   설치: 팀이 **현장에 들어가기** 위한 문서 → 현장 정보와 반입 조건이 본문
 *
 * 그래서 자재 재단 목록을 싣지 않는다. 현장에서 필요한 것은
 * "무엇을 어디에 몇 개 다는가" 와 "어떻게 들어가는가" 다.
 *
 * ★ 금액을 표시하지 않는다 (제작 지시서와 동일).
 * ★ 공유 링크를 만들지 않는다 — 연락처가 들어가는 내부 문서다.
 */

import { esc, num, ymd, ymdhm, tr, thead, documentShell } from './html.js';
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

const SCHEDULE_TYPES = {
  measurement: '실측',
  material_order: '자재발주',
  manufacturing_start: '제작착수',
  manufacturing_end: '제작완료',
  quality_check: '검수',
  delivery: '납품',
  installation: '설치',
  as_visit: 'A/S방문',
};

function itemLabel(item, index) {
  return (
    item.labelName ||
    CATEGORY_NAMES[item.categoryId || item.category] ||
    item.name ||
    `품목 ${index + 1}`
  );
}

/** 미입력을 눈에 띄게 — 현장에서 "빈칸"은 사고로 이어진다. */
function orMissing(v, label) {
  const s = String(v == null ? '' : v).trim();
  return s ? esc(s) : `<span class="missing">${esc(label)} 미입력</span>`;
}

function elevatorText(site) {
  if (site.has_elevator === true) return '있음';
  if (site.has_elevator === false) return '<b>없음 — 사다리차 검토</b>';
  return '<span class="missing">미확인</span>';
}

/** 표지 — 현장 정보가 본문이다. */
function coverSheet(doc, snapshot, site) {
  const design = snapshot.design_payload || {};
  const items = Array.isArray(design.items) ? design.items : [];
  const s = site || {};

  const summaryRows = items
    .map((item, i) => {
      const mods = Array.isArray(item.modules) ? item.modules : [];
      return tr([
        esc(itemLabel(item, i)),
        esc(CATEGORY_NAMES[item.categoryId || item.category] || '-'),
        `${num(item.w)} × ${num(item.h)} × ${num(item.d)}`,
        `${mods.length}개`,
      ]);
    })
    .join('');

  return `
<div class="sheet">
  <h1>설치 작업지시서</h1>
  <table class="meta">
    <tbody>
      ${tr(['문서번호', esc(doc.doc_no), '발행일', ymd(doc.created_at)])}
      ${tr(['고객', esc(doc.customer_name || doc.customer_name_masked || '-'), '설계 Rev', `r${snapshot.rev}`])}
      ${tr(['품목 수', `${items.length}개`, '설계 해시', esc(String(snapshot.content_hash || '').slice(0, 12))])}
    </tbody>
  </table>

  <h2>현장 정보</h2>
  <table class="meta">
    <tbody>
      ${tr(['주소', orMissing([s.address, s.address_detail].filter(Boolean).join(' '), '주소'), '층', orMissing(s.floor, '층')])}
      ${tr(['엘리베이터', elevatorText(s), '비고', esc(s.elevator_note || '-')])}
      ${tr(['연락처', orMissing(s.contact_name ? `${s.contact_name} ${s.contact_phone || ''}`.trim() : '', '연락처'), '', ''])}
    </tbody>
  </table>

  <h2>반입 경로</h2>
  <div class="freetext">${s.access_note ? esc(s.access_note) : '<span class="missing">반입 경로 미입력 — 현장 확인 필요</span>'}</div>

  <h2>시공 순서</h2>
  <div class="freetext">${s.install_order ? esc(s.install_order) : '<span class="missing">시공 순서 미입력</span>'}</div>

  ${s.notes ? `<h2>특기 사항</h2><div class="freetext">${esc(s.notes)}</div>` : ''}

  <h2>설치 품목</h2>
  <table>
    ${thead(['품목', '분류', 'W × H × D (mm)', '모듈 수'])}
    <tbody>${summaryRows || tr(['-', '-', '-', '-'])}</tbody>
  </table>

  <table class="sign">
    <tbody>
      ${tr(['설치 담당', '', '검수', '', '고객 확인', ''])}
    </tbody>
  </table>
</div>`;
}

/** 설치할 모듈 목록 — 자재가 아니라 "다는 것" 기준. */
function moduleSheet(snapshot) {
  const design = snapshot.design_payload || {};
  const items = Array.isArray(design.items) ? design.items : [];
  const rows = [];

  items.forEach((item, i) => {
    const label = itemLabel(item, i);
    (Array.isArray(item.modules) ? item.modules : []).forEach((m) => {
      const notes = [];
      if (m.isDrawer) notes.push(`서랍 ${num(m.drawerCount) || 1}단`);
      if (m.isEL) notes.push('EL');
      if (m.isOpen) notes.push('오픈(가전)');
      if (m.type === 'tall') notes.push('키큰장');
      if (m.totalH) notes.push(`전체H ${num(m.totalH)}`);
      rows.push(
        tr([
          esc(label),
          esc(MODULE_POS[m.pos] || m.pos || '-'),
          esc(m.name || '-'),
          `${num(m.w)} × ${num(m.h)} × ${num(m.d)}`,
          `${num(m.doorCount) || 0}`,
          esc(notes.join(', ') || '-'),
        ])
      );
    });
  });

  return `
<div class="sheet">
  <h2>설치 모듈 명세</h2>
  <p class="hint">H 는 몸통(카카스) 치수입니다. 전체 높이는 비고를 참고하세요.</p>
  <table>
    ${thead(['품목', '위치', '모듈', 'W × H × D (mm)', '도어', '비고'])}
    <tbody>${rows.join('') || tr(['-', '-', '-', '-', '-', '-'])}</tbody>
  </table>
</div>`;
}

/** 일정 — 설치 팀이 알아야 할 앞뒤 공정. */
function scheduleSheet(schedules) {
  const list = Array.isArray(schedules) ? schedules : [];
  if (list.length === 0) return '';

  const rows = list
    .map((s) =>
      tr([
        esc(SCHEDULE_TYPES[s.type] || s.type || '-'),
        ymdhm(s.scheduled_at),
        esc(s.assignee_name || '-'),
        esc(s.location || '-'),
        esc(s.status || '-'),
      ])
    )
    .join('');

  return `
<div class="sheet">
  <h2>관련 일정</h2>
  <table>
    ${thead(['구분', '예정 일시', '담당', '장소', '상태'])}
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

export function renderInstallationOrder(doc, snapshot, { toolbar = true, site = null, schedules = null } = {}) {
  const body = [
    toolbar ? PRINT_TOOLBAR : '',
    coverSheet(doc, snapshot, site || (doc.render_payload || {}).site_info),
    moduleSheet(snapshot),
    scheduleSheet(schedules || (doc.render_payload || {}).schedules),
  ]
    .filter(Boolean)
    .join('\n');

  return documentShell({
    title: `설치 작업지시서 ${doc.doc_no}`,
    css: PRINT_CSS + `
      .missing { color: #c62828; font-weight: 700; }
      .freetext { white-space: pre-wrap; border: 1px solid #ddd; padding: 8px 10px; border-radius: 4px; min-height: 32px; }
      .hint { font-size: 11px; color: #666; margin: 2px 0 6px; }
    `,
    body,
  });
}
