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
import { modulePosLabel } from './elevation.js';
import { elevationBlock, renderBoxes, specialNotesBox, drawingTitle, LAYOUT2_ELEV_SCALE } from './work-order.js';
import { planSvg } from './countertop-order.js';
import { countertopRequests, hasCountertop } from '../countertop.js';
import { specialNotesOfDoc } from '../work/special-notes.js';
import { materialsOf, isOutsourcedTopRow } from '../work-order-data.js';
import { checkListOfDoc, itemsFor, itemApplies } from '../work/check-items.js';
import { SITE_NOTE } from '../work/reveal.js';
import { fixturePartsOfItem, fixturePartText, designAppliancesOf } from '../fixture-parts.js';

const CATEGORY_NAMES = {
  sink: '싱크대',
  island: '아일랜드',
  wardrobe: '붙박이장',
  fridge: '냉장고장',
  shoerack: '신발장',
  vanity: '화장대',
  storage: '수납장',
  warehouse: '창고장',
  tvcabinet: 'TV장',
  door: '도어교체',
  custom: '비규격장',
};


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

export function itemLabel(item, index) {
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

/**
 * 현장 정보 · 반입 경로 칸 — 설치 지시서 표지와 철거 · 납품 지시서(templates/site-order.js)가 같이 쓴다.
 *   주소 · 연락처를 여는 판정이 한 곳에만 있게 한다 — worker (작업자 보기)면 worker.siteOpen 일 때만, 아니면 안내 문구.
 *   글자 · 빈칸은 설치 지시서 표지에 있던 그대로다 (출력이 바뀌면 안 된다 — test/site-order.test.js 지문).
 */
export function siteBlock(s, worker) {
  return `<h2>현장 정보</h2>
  <table class="meta">
    <tbody>
      ${tr(['주소', worker && !worker.siteOpen ? esc(SITE_NOTE) : orMissing([s.address, s.address_detail].filter(Boolean).join(' '), '주소'), '층', orMissing(s.floor, '층')])}
      ${tr(['엘리베이터', elevatorText(s), '비고', esc(s.elevator_note || '-')])}
      ${tr(['연락처', worker && !worker.siteOpen ? esc(SITE_NOTE) : orMissing(s.contact_name ? `${s.contact_name} ${s.contact_phone || ''}`.trim() : '', '연락처'), '', ''])}
    </tbody>
  </table>

  <h2>반입 경로</h2>
  <div class="freetext">${s.access_note ? esc(s.access_note) : '<span class="missing">반입 경로 미입력 — 현장 확인 필요</span>'}</div>`;
}

/**
 * 표지 — 현장 정보가 본문이다.
 * worker (작업자 포털 — work/checks.js): 고객 칸은 가린 주문 이름. 주소 · 연락처는 worker.siteOpen 일 때만
 *   (수락한 때부터 작업이 끝나고 7일까지 — reveal.js siteOpenFor), 아니면 안내 문구.
 */
/**
 * 설비 — 설계에서 고른 싱크볼 · 수전 · 쿡탑 · 후드 (간편 플래너 specs.fixtureParts, 2026-11-19 사장님 「앱으로 보낼 때 같이」).
 * 고른 상품이 없으면 칸째 없다 (옛 설계 · 고르지 않은 설계의 지시서는 그대로다).
 */
export function fixturePartsBlock(items) {
  const rows = (Array.isArray(items) ? items : []).flatMap((item, i) => fixturePartsOfItem(item).map((p) => tr([esc(itemLabel(item, i)), esc(p.label), esc(fixturePartText(p)), esc(p.vendor || '-')])));
  if (!rows.length) return '';
  return `
  <h2>설비 <span class="hint">설계에서 고른 상품</span></h2>
  <table>
    ${thead(['품목', '구분', '상품', '공급 회사'])}
    <tbody>${rows.join('')}</tbody>
  </table>`;
}

/**
 * 가전 — 설계에 들어갈 가전 (간편 플래너 배치 단계 「가전」 → design.appliances, 2026-11-20 사장님).
 * 설계 가전이 없으면 칸째 없다 (옛 설계 · 고르지 않은 설계의 지시서는 그대로다).
 */
export function designAppliancesBlock(design) {
  const rows = designAppliancesOf(design).map((a) => tr([esc(a.label), esc(a.text), esc(a.combo || a.size || '-'), `${a.qty}`]));
  if (!rows.length) return '';
  return `
  <h2>가전 <span class="hint">설계에 들어갈 가전</span></h2>
  <table>
    ${thead(['품목', '모델', '크기 · 조합', '수량'])}
    <tbody>${rows.join('')}</tbody>
  </table>`;
}

function coverSheet(doc, snapshot, site, worker) {
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
      ${tr(['고객', esc(worker ? worker.orderLabel : doc.customer_name || doc.customer_name_masked || '-'), '설계 Rev', `r${snapshot.rev}`])}
      ${tr(['품목 수', `${items.length}개`, '설계 해시', esc(String(snapshot.content_hash || '').slice(0, 12))])}
    </tbody>
  </table>

  ${specialNotesBox(specialNotesOfDoc(doc), ['install'])}

  ${siteBlock(s, worker)}

  <h2>시공 순서</h2>
  <div class="freetext">${s.install_order ? esc(s.install_order) : '<span class="missing">시공 순서 미입력</span>'}</div>

  ${s.notes ? `<h2>특기 사항</h2><div class="freetext">${esc(s.notes)}</div>` : ''}

  <h2>설치 품목</h2>
  <table>
    ${thead(['품목', '분류', 'W × H × D (mm)', '모듈 수'])}
    <tbody>${summaryRows || tr(['-', '-', '-', '-'])}</tbody>
  </table>${fixturePartsBlock(items)}${designAppliancesBlock(design)}

  ${layout2(doc) ? '' : installChecks(doc, snapshot)}<table class="sign">
    <tbody>
      ${tr(itemsFor(checkListOfDoc(doc), 'install', 'order').filter((x) => x.paper === 'sign').flatMap((x) => [esc(x.label), '']))}
    </tbody>
  </table>
</div>`;
}

/** 설치 확인 칸 — 정본 목록의 서명 아닌 항목 (v1). 조건(콘센트)은 동결본으로 거른다. v0 은 없다 */
function installChecks(doc, snapshot) {
  // 특별 지시 항목(note)은 표지 위 빨간 상자에 있다
  const list = itemsFor(checkListOfDoc(doc), 'install', 'order').filter((x) => !x.note && x.paper !== 'sign' && itemApplies(x, null, snapshot));
  if (!list.length) return '';
  return `<h2>설치 확인</h2><div class="freetext">${list.map((x) => `${esc(x.label)}${x.must ? '' : ' <span class="muted">(권장)</span>'}${x.photo === 'need' ? ' <span class="muted">· 사진</span>' : ''} ☐`).join(' &nbsp; ')}</div>`;
}

/** 설치할 모듈 목록 — 자재가 아니라 "다는 것" 기준. */
export function moduleSheet(snapshot) {
  const design = snapshot.design_payload || {};
  const items = Array.isArray(design.items) ? design.items : [];
  const rows = [];

  items.forEach((item, i) => {
    const label = itemLabel(item, i);
    (Array.isArray(item.modules) ? item.modules : []).forEach((m, mi) => {
      const notes = [];
      if (m.isDrawer) notes.push(`서랍 ${num(m.drawerCount) || 1}단`);
      if (m.isEL) notes.push('EL');
      if (m.isOpen) notes.push('오픈(가전)');
      if (m.type === 'tall') notes.push('키큰장');
      if (m.totalH) notes.push(`전체H ${num(m.totalH)}`);
      rows.push(
        tr([
          esc(label),
          num(mi + 1),
          esc(modulePosLabel(m)),
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
    ${thead(['품목', '번호', '위치', '모듈', 'W × H × D (mm)', '도어', '비고'])}
    <tbody>${rows.join('') || tr(['-', '-', '-', '-', '-', '-', '-'])}</tbody>
  </table>
</div>`;
}

/** 줄 부재 행 — 품목 단위 (엔진 moduleKey `…-ep`, 간편 플래너 「줄 부재」) */
export const isLineRow = (m) => (m.moduleKey && /-ep$/.test(String(m.moduleKey))) || String(m.module || '') === '줄 부재';

/** 간편 플래너에서 온 설계인가 — 플래너가 그려 보내는 그림(배치 평면 · 속 구조 정면도)은 이 설계에만 있다 */
export const isPlannerDesign = (snapshot) => !!(snapshot && snapshot.design_payload && snapshot.design_payload.source === 'planner-lite');
const urlMap = (renderUrls) => (renderUrls instanceof Map ? renderUrls : new Map(Object.entries(renderUrls || {})));

/**
 * 플래너가 그려 보낸 그림 한 장 — 있으면 그림, 없으면 까닭 한 줄 (짐작해서 그리지 않는다).
 *   entry = 발행 때 고정한 줄 { path, stale? } | null · name = 그림 이름 · cap = 그림 아래 글
 */
export function plannerDrawing(entry, renderUrls, { name, cap }) {
  const url = entry && entry.path ? urlMap(renderUrls).get(entry.path) : null;
  if (url) return `<div class="elev-box"><img src="${esc(url)}" alt="${esc(name)}" style="width:100%;height:auto"><div class="elev-cap">${cap}</div></div>`;
  const why = entry && entry.path
    ? `${name} — 그림을 불러올 수 없음`
    : entry && entry.stale
      ? `${name} — 이 설계 판의 그림이 아님 · 플래너에서 다시 보내고 지시서를 다시 내 주세요`
      : `${name} 없음 — 플래너에서 다시 보내고 지시서를 다시 내 주세요`;
  return `<div class="elev-box"><div class="ph">${esc(why)}</div></div>`;
}

/** 배치 평면 (설계에 하나 — 벽 · 가전 자리). 고정한 줄 가운데 그림이 있는 줄, 없으면 다른 판 표시가 있는 줄 */
export function layoutBlock(rp, renderUrls) {
  const list = Array.isArray(rp && rp.layout_renders) ? rp.layout_renders : [];
  const entry = list.find((r) => r && r.path) || list.find((r) => r && r.stale) || null;
  return plannerDrawing(entry, renderUrls, { name: '배치 평면', cap: '배치 평면 (플래너 도면 · mm) — 벽 길이 · 깊이 · 가전 자리' });
}

/** 벽(품목)마다 속 구조 정면도 — 선반 · 세로칸막이 · 서랍 (플래너 도면 그대로) */
export function insideBlocks(items, rp, renderUrls) {
  const list = Array.isArray(rp && rp.inside_renders) ? rp.inside_renders : [];
  return (items || [])
    .map((item, i) => {
      const label = esc(itemLabel(item, i));
      return plannerDrawing(list.find((r) => r && r.item_index === i) || null, renderUrls, { name: `${itemLabel(item, i)} 속 구조 정면도`, cap: `${label} · 속 구조 정면도 (플래너 도면 · mm) — 선반 · 세로칸막이 · 서랍` });
    })
    .join('');
}

/**
 * 상판 탑뷰 — 상판 한 장마다. 플래너가 그려 보낸 탑뷰(하부장이 두 벽 이상)가 있으면 그것, 아니면 상판 발주 요청서와 같은 그림 (countertop-order.js planSvg).
 *   top = 인쇄 때 읽은 생산 설정 · 가전 모델 (없으면 모델 없이 — 그림에 「모델 미지정」). 상판이 없는 설계면 ''
 */
export function topViewBlock(snapshot, rp, renderUrls, top) {
  if (!hasCountertop(snapshot && snapshot.bom_payload)) return '';
  const reqs = countertopRequests(snapshot, { countertop: top && top.countertop, models: top && top.models });
  if (!reqs.length) return '';
  const plans = Array.isArray(rp && rp.plan_renders) ? rp.plan_renders : [];
  const urls = urlMap(renderUrls);
  return reqs
    .map((req) => {
      const r = plans.find((x) => x && x.item_index === req.index);
      const url = r && r.path ? urls.get(r.path) : null;
      const drawing = url
        ? `<img src="${esc(url)}" alt="상판 탑뷰 (플래너 그림)" style="width:100%;height:auto">`
        : planSvg(req);
      return `<div class="elev-box">${drawing}<div class="elev-cap">상판 탑뷰 — 하부장 배치 · 타공 · 치수 mm</div></div>`;
    })
    .join('');
}

/**
 * 정면도 · 정면 렌더 · 줄 부재 (2026-11-05 사장님 E 「설치 지시서에 정면도 · 모듈 목록 · 상판 · 줄 부재」 · 메모 「작업 지시서 내에서는 무조건 그림」).
 *   정면도 번호 = 설치 모듈 명세 번호. 렌더는 발행 때 고정한 것 (없으면 칸을 그리지 않는다).
 *   그림 묶음 판이 있는 문서(render_payload.drawing_version — 2026-11-19 사장님 「설치: 배치 평면 · 상판 탑뷰 · 모듈 속 구조 정면도」)는
 *   그 뒤에 배치 평면 · 상판 탑뷰 · 속 구조 정면도 장이 이어진다. 옛 문서는 그대로다.
 */
function drawingSheet(doc, snapshot, renderUrls, top) {
  const design = snapshot.design_payload || {};
  const items = Array.isArray(design.items) ? design.items : [];
  if (!items.length) return '';
  const rp = doc.render_payload || {};
  const renders = Array.isArray(rp.renders) && rp.renders.length ? rp.renders : null;
  const isoRenders = Array.isArray(rp.iso_renders) ? rp.iso_renders : null;
  const ctx = { items, renders, isoRenders, renderUrls: renderUrls instanceof Map ? renderUrls : new Map(Object.entries(renderUrls || {})), elevScale: layout2(doc) ? LAYOUT2_ELEV_SCALE : 0 };
  const lines = materialsOf(snapshot).filter(isLineRow);
  const lineRows = lines
    .map((m) => tr([esc(m.part || ''), `${esc(m.material || '')} ${num(m.thickness)}T`, `${num(m.w)} × ${num(m.h)}`, num(m.qty), isOutsourcedTopRow(m) ? '상판 업체 시공' : esc(m.note || '')], ['', '', 'num', 'num', '']))
    .join('');
  return `
<div class="sheet">
  <h2>${drawingTitle(ctx)}</h2>
  <p class="hint">번호 = 설치 모듈 명세 번호. 치수 mm.</p>
  ${elevationBlock(ctx)}
  ${renders ? `<h2>정면 렌더</h2>${renderBoxes(ctx)}` : ''}
  ${lineRows ? `<h2>줄 부재 <span class="hint">현장에서 붙이는 것</span></h2><table>${thead(['부품', '자재', '가로 × 세로', '수량', '비고'])}<tbody>${lineRows}</tbody></table>` : ''}
</div>${rp.drawing_version ? moreDrawingSheets(snapshot, items, rp, ctx.renderUrls, top) : ''}`;
}

/** 배치 평면 · 상판 탑뷰 · 속 구조 정면도 장 (그림 묶음 판이 있는 문서만). 플래너 그림 둘은 플래너에서 온 설계에만 */
function moreDrawingSheets(snapshot, items, rp, renderUrls, top) {
  const planner = isPlannerDesign(snapshot);
  const topView = topViewBlock(snapshot, rp, renderUrls, top);
  return [
    planner ? `<div class="sheet"><h2>배치 평면</h2>${layoutBlock(rp, renderUrls)}</div>` : '',
    topView ? `<div class="sheet"><h2>상판 탑뷰</h2>${topView}</div>` : '',
    planner ? `<div class="sheet"><h2>속 구조 정면도 <span class="hint">벽마다 — 번호 = 설치 모듈 명세 번호</span></h2>${insideBlocks(items, rp, renderUrls)}</div>` : '',
  ]
    .filter(Boolean)
    .map((s) => `\n${s}`)
    .join('');
}

/** 일정 — 설치 팀이 알아야 할 앞뒤 공정. 작업자 보기는 장소를 열지 않는다 (주소일 수 있다). */
export function scheduleSheet(schedules, worker) {
  const list = Array.isArray(schedules) ? schedules : [];
  if (list.length === 0) return '';

  const rows = list
    .map((s) =>
      tr([
        esc(SCHEDULE_TYPES[s.type] || s.type || '-'),
        ymdhm(s.scheduled_at),
        worker ? '-' : esc(s.assignee_name || '-'),
        worker ? '-' : esc(s.location || '-'),
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

/** 새 틀 문서인가 (발행 때 고정한 render_payload.sheet_layout — documents.js SHEET_LAYOUT) */
export const layout2 = (doc) => Number(doc && doc.render_payload && doc.render_payload.sheet_layout) >= 2;

/**
 * 새 틀 현장 문서의 표 줄맞춤 (2026-11-20 사장님 「표 · 칸 줄맞춤이 어긋남」) — 칸 너비를 고정한다:
 *   머리 · 현장 표(이름 · 값 · 이름 · 값)는 이름 칸 18% · 값 칸 32%, 나머지 표는 같은 너비로 나누고 숫자 칸은 오른쪽 맞춤 그대로. 글자를 조금 키운다.
 */
export const SITE_LAYOUT2_CSS = `
      table { table-layout: fixed; }
      th, td { overflow-wrap: anywhere; }
      table.meta td:nth-child(odd), table.site td:nth-child(odd) { width: 18%; font-weight: 700; background: #f5f5f5; }
      table.meta td:nth-child(even), table.site td:nth-child(even) { width: 32%; }
      body { font-size: 11pt; }
      h2 { font-size: 13pt; }
    `;

/** 현장 문서(설치 · 철거 · 납품 지시서)의 인쇄 모양 — 빈칸 경고 · 글 상자 · 작은 글 */
export const SITE_CSS = PRINT_CSS + `
      .missing { color: #c62828; font-weight: 700; }
      .freetext { white-space: pre-wrap; border: 1px solid #ddd; padding: 8px 10px; border-radius: 4px; min-height: 32px; }
      .hint { font-size: 11px; color: #666; margin: 2px 0 6px; }
    `;

export function renderInstallationOrder(doc, snapshot, { toolbar = true, site = null, schedules = null, worker = null, renderUrls = new Map(), top = null } = {}) {
  const w = worker && worker.orderLabel ? worker : null;
  const body = [
    toolbar ? PRINT_TOOLBAR : '',
    coverSheet(doc, snapshot, site || (doc.render_payload || {}).site_info, w),
    drawingSheet(doc, snapshot, renderUrls, top),
    moduleSheet(snapshot),
    scheduleSheet(schedules || (doc.render_payload || {}).schedules, w),
  ]
    .filter(Boolean)
    .join('\n');

  return documentShell({
    title: `설치 작업지시서 ${doc.doc_no}`,
    css: layout2(doc) ? SITE_CSS + SITE_LAYOUT2_CSS : SITE_CSS,
    body,
  });
}
