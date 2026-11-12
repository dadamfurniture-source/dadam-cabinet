/**
 * 상판 발주 요청서 (작업지시서 꾸러미 `?pack=top`) — 상판 업체에 보내는 종이.
 * 도어재 발주서와 같은 원칙: 고객 이름 · 설계 제목 · 금액 없음. 품목마다 한 쪽 — 하부장 탑뷰 (2026-11-05).
 * 데이터는 ../countertop.js countertopRequests (순수). 발주 마감 · 업체 · 모델은 인쇄 시점 ctx.top 이 준다.
 */

import { esc, num, ymd } from './html.js';
import { countertopRequests, TOP_VENDOR_KEY } from '../countertop.js';
import { dayLabel } from '../production/planner.js';

const KIND_ICON = { sink: '①', cooktop: '②', faucet: '③' };
const CHECK = '[확인 필요]';

function cutoutSize(c) {
  if (c.kind === 'faucet') {
    if (c.dia) return `구멍 지름 ${num(c.dia)}`;
    return `${CHECK} ${c.model || c.sinkModel ? '모델에 수전 구멍 지름 없음' : '수전 · 싱크볼 모델 미지정'}`;
  }
  if (!c.model) return `${CHECK} 모델 미지정`;
  return c.model.w && c.model.d ? `${num(c.model.w)} × ${num(c.model.d)}${c.model.r ? ` R${num(c.model.r)}` : ''}` : `${CHECK} 모델 타공 치수 없음`;
}

/** 평면 치수도 — 일자는 길이 × 깊이 사각형, 코너는 하부 모듈 자리(_place) 합. 벽 쪽은 굵은 선, 타공 자리는 점선. */
export function planSvg(req) {
  const W = 640;
  const H = 260;
  const pad = 30;
  // 플래너 코너(벽마다 품목) — 앱이 벽 사이 자리를 모른다. 플래너 탑뷰 그림이 없으면 벽마다 하부장 폭만 (지어내지 않는다)
  if (req.shape === 'corner' && Array.isArray(req.walls) && req.walls.length) {
    const lines = req.walls.map((w, i) => `<text x="${pad}" y="${44 + i * 18}" font-size="11">${esc(w.label)} — 하부장 ${w.mods.map((m) => `${num(m.no)} ${esc(m.name)} ${num(m.w)}`).join(' · ')} (합 ${num(w.length)})</text>`).join('');
    return `<svg class="top-plan" viewBox="0 0 ${W} ${60 + req.walls.length * 18}" width="100%" role="img" aria-label="코너 상판 — 벽마다 하부장"><text x="${pad}" y="20" font-size="11" fill="#b45309">${CHECK} 코너 상판 탑뷰 그림 없음 — 플래너에서 다시 보내 주세요 · 펼친 길이 ${num(req.length)}</text>${lines}</svg>`;
  }
  if (req.shape === 'corner' && Array.isArray(req.plan) && req.plan.length) {
    const xs = req.plan.flatMap((b) => [b.x0, b.x1]);
    const ys = req.plan.flatMap((b) => [b.y0, b.y1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const s = Math.min((W - 2 * pad) / Math.max(1, maxX - minX), (H - 2 * pad) / Math.max(1, maxY - minY));
    const X = (x) => pad + (x - minX) * s;
    const Y = (y) => H - pad - (y - minY) * s; // 평면 y 는 위가 +
    const rects = req.plan.map((b) => {
      const fill = b.sink ? '#dbeafe' : b.cook ? '#fee2e2' : '#f3f4f6';
      const tag = b.sink ? '싱크' : b.cook ? '쿡탑' : '';
      const cx = (X(b.x0) + X(b.x1)) / 2;
      const cy = (Y(b.y0) + Y(b.y1)) / 2;
      return `<rect x="${X(b.x0).toFixed(1)}" y="${Y(b.y1).toFixed(1)}" width="${((b.x1 - b.x0) * s).toFixed(1)}" height="${((b.y1 - b.y0) * s).toFixed(1)}" fill="${fill}" stroke="#555" stroke-width="0.6"/>${tag ? `<text x="${cx.toFixed(1)}" y="${(cy + 4).toFixed(1)}" font-size="11" text-anchor="middle">${tag}</text>` : ''}`;
    }).join('');
    const runs = (req.runs || []).map((r, i) => `줄 ${i + 1}: ${num(r.length)}`).join(' · ');
    return `<svg class="top-plan" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="상판 평면">${rects}<text x="${pad}" y="16" font-size="11">코너 상판 — 하부 모듈 자리 (위에서 본 평면) · ${esc(runs)}</text></svg>`;
  }
  return straightPlanSvg(req);
}

/**
 * 일자 상판 탑뷰 (2026-11-05 사장님 「하부장만 표시 · 탑뷰 · 하부장 배치는 그대로 · 개수대 · 가스대 표시 · 전체 치수는 정확하게 ·
 * 끊김 위치는 표시할 필요 없어」) — 위에서 본 하부장 칸(번호 = 지시서 모듈 번호), 개수대 칸에 싱크볼 · 수전, 가스대 칸에 쿡탑,
 * 하부장 위 수납장이 선 칸은 빗금 「상판 없음」. 선: 상판 바깥 굵은 실선 · 하부장 칸 가는 선 · 타공 파선 · 벽 아주 굵은 선 · 치수선.
 * 싱크볼 · 쿡탑 크기는 고른 모델의 타공 치수, 모델이 없으면 칸 안 자리만 (그림 크기 — 「모델 미지정」).
 */
function straightPlanSvg(req) {
  const W = 700;
  const padL = 30, padR = 90, padT = 46;
  const len = Math.max(1, req.length);
  const dep = Math.max(1, req.depth);
  const s = Math.min((W - padL - padR) / len, 200 / dep);
  const nHoles = req.cutouts.filter((c) => c.center !== null).length;
  const H = Math.round(padT + dep * s + 52 + nHoles * 14 + 26);
  const X = (mm) => padL + mm * s;
  const Y = (mm) => padT + mm * s;     // 0 = 벽(뒤), dep = 앞
  const mods = Array.isArray(req.modules) ? req.modules : [];
  const out = [];
  out.push('<defs><pattern id="tp-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#888" stroke-width="1"/></pattern></defs>');
  // 상판 바깥 (굵은 실선)
  out.push(`<rect x="${X(0).toFixed(1)}" y="${Y(0).toFixed(1)}" width="${(len * s).toFixed(1)}" height="${(dep * s).toFixed(1)}" fill="#f8fafc" stroke="#000" stroke-width="1.6"/>`);
  // 하부장 칸 (가는 선) · 번호 · 이름
  mods.forEach((m) => {
    const x = X(m.x), w = m.w * s;
    if (m.kind === 'onTop') out.push(`<rect x="${x.toFixed(1)}" y="${Y(0).toFixed(1)}" width="${w.toFixed(1)}" height="${(dep * s).toFixed(1)}" fill="url(#tp-hatch)" stroke="#000" stroke-width="0.8"/>`);
    else out.push(`<line x1="${x.toFixed(1)}" y1="${Y(0).toFixed(1)}" x2="${x.toFixed(1)}" y2="${Y(dep).toFixed(1)}" stroke="#666" stroke-width="0.5"/>`);
    const label = m.kind === 'onTop' ? '상판 없음' : m.kind === 'sink' ? '개수대' : m.kind === 'cook' ? '가스대' : '';
    out.push(`<text x="${(x + w / 2).toFixed(1)}" y="${(Y(dep) + 12).toFixed(1)}" font-size="9.5" text-anchor="middle" fill="#333">${esc(`${m.no ? `${m.no} ` : ''}${label || m.name}`)}</text>`);
    if (m.kind === 'onTop') out.push(`<text x="${(x + w / 2).toFixed(1)}" y="${(Y(dep / 2) + 3).toFixed(1)}" font-size="9" text-anchor="middle" fill="#333">하부장 위 수납장</text>`);
  });
  const lastEdge = mods.length ? mods[mods.length - 1].x + mods[mods.length - 1].w : 0;
  if (mods.length && Math.abs(lastEdge - len) > 1) out.push(`<line x1="${X(lastEdge).toFixed(1)}" y1="${Y(0).toFixed(1)}" x2="${X(lastEdge).toFixed(1)}" y2="${Y(dep).toFixed(1)}" stroke="#666" stroke-width="0.5"/>`);
  // 벽 (뒤) — 아주 굵은 선 · 뒷백(뒷턱) · 뒷선반
  out.push(`<line x1="${X(0).toFixed(1)}" y1="${Y(0).toFixed(1)}" x2="${X(len).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="#000" stroke-width="4"/>`);
  out.push(`<text x="${X(0).toFixed(1)}" y="${(Y(0) - 22).toFixed(1)}" font-size="10" fill="#333">벽 (뒤)</text>`);
  const f = req.finishes || {};
  if (f.backsplash && f.backsplash.on) out.push(`<text x="${X(len / 2).toFixed(1)}" y="${(Y(0) - 8).toFixed(1)}" font-size="10" text-anchor="middle" fill="#111">뒷백(뒷턱) 높이 ${num(f.backsplash.h)}</text>`);
  if (f.rearShelf && f.rearShelf.on) {
    const d = f.rearShelf.d > 0 ? f.rearShelf.d : null;
    if (d) out.push(`<rect x="${X(0).toFixed(1)}" y="${Y(0).toFixed(1)}" width="${(len * s).toFixed(1)}" height="${(d * s).toFixed(1)}" fill="none" stroke="#7c3aed" stroke-width="0.8" stroke-dasharray="6 3"/>`);
    out.push(`<text x="${X(len).toFixed(1)}" y="${(Y(0) - 8).toFixed(1)}" font-size="10" text-anchor="end" fill="#7c3aed">뒷선반 ${d ? `깊이 ${num(d)}` : '크기 미정'}${f.rearShelf.h > 0 ? ` · 높이 ${num(f.rearShelf.h)}` : ''}</text>`);
  }
  // 타공 — 파선. 싱크볼 · 쿡탑은 모델 타공 치수, 수전은 싱크볼 뒤 가운데
  let holeRow = 0;
  req.cutouts.filter((c) => c.center !== null).forEach((c) => {
    const m = mods.find((x) => x.no === c.no);
    const has = c.model && c.model.w && c.model.d;
    const cw = has ? c.model.w : Math.max(100, (m ? m.w : 600) - 160);
    const cd = has ? c.model.d : Math.max(100, dep - 260);
    const cx = X(c.center), cy = Y(dep / 2 + 20);
    out.push(`<rect x="${(cx - cw * s / 2).toFixed(1)}" y="${(cy - cd * s / 2).toFixed(1)}" width="${(cw * s).toFixed(1)}" height="${(cd * s).toFixed(1)}" rx="${c.kind === 'sink' && has && c.model.r ? Math.min(6, c.model.r * s).toFixed(1) : 0}" fill="none" stroke="#1d4ed8" stroke-width="1" stroke-dasharray="5 3"/>`);
    out.push(`<text x="${cx.toFixed(1)}" y="${(cy + 4).toFixed(1)}" font-size="10" text-anchor="middle" fill="#1d4ed8">${KIND_ICON[c.kind] || ''} ${esc(c.label)}${has ? ` ${num(c.model.w)}×${num(c.model.d)}` : ' (모델 미지정)'}</text>`);
    if (c.kind === 'sink') {
      const fy = (cy - cd * s / 2 + Y(0)) / 2;
      out.push(`<circle cx="${cx.toFixed(1)}" cy="${fy.toFixed(1)}" r="4" fill="none" stroke="#1d4ed8" stroke-width="1"/><text x="${(cx + 7).toFixed(1)}" y="${(fy + 3).toFixed(1)}" font-size="9" fill="#1d4ed8">③ 수전</text>`);
    }
    // 중심 치수 — 왼쪽 끝에서
    holeRow += 1;
    const yy = Y(dep) + 52 + holeRow * 14;
    out.push(`<line x1="${X(0).toFixed(1)}" y1="${yy.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="#1d4ed8" stroke-width="0.6"/><line x1="${cx.toFixed(1)}" y1="${(yy - 4).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(yy + 4).toFixed(1)}" stroke="#1d4ed8" stroke-width="0.6"/>`);
    out.push(`<text x="${(cx + 4).toFixed(1)}" y="${(yy + 3.5).toFixed(1)}" font-size="9.5" fill="#1d4ed8">${KIND_ICON[c.kind] || ''} 중심 ${num(c.center)}</text>`);
  });
  // 치수 — 칸 사슬(왼쪽 마감 · 칸 · 오른쪽 마감) · 전체 길이 · 깊이
  const chainY = Y(dep) + 28;
  const segs = [];
  if (req.finishW && req.finishW.left > 0) segs.push([0, req.finishW.left]);
  mods.forEach((m) => segs.push([m.x, m.x + m.w]));
  if (req.finishW && req.finishW.right > 0) segs.push([len - req.finishW.right, len]);
  const tick = (x, y) => `<line x1="${x.toFixed(1)}" y1="${(y - 4).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y + 4).toFixed(1)}" stroke="#333" stroke-width="0.6"/>`;
  segs.forEach(([a0, a1], i) => {
    out.push(`<line x1="${X(a0).toFixed(1)}" y1="${chainY}" x2="${X(a1).toFixed(1)}" y2="${chainY}" stroke="#333" stroke-width="0.6"/>${tick(X(a0), chainY)}${tick(X(a1), chainY)}`);
    // 좁은 칸(마감 20 등)은 숫자를 바깥에 — 모든 칸 치수를 적는다
    const narrow = (a1 - a0) * s <= 22;
    const tx = !narrow ? X((a0 + a1) / 2) : i === segs.length - 1 ? X(a1) + 3 : X(a0) - 3;
    out.push(`<text x="${tx.toFixed(1)}" y="${(chainY - 3).toFixed(1)}" font-size="9" text-anchor="${!narrow ? 'middle' : i === segs.length - 1 ? 'start' : 'end'}" fill="#333">${num(a1 - a0)}</text>`);
  });
  const totY = Y(dep) + 46;
  out.push(`<line x1="${X(0).toFixed(1)}" y1="${totY}" x2="${X(len).toFixed(1)}" y2="${totY}" stroke="#000" stroke-width="0.9"/>${tick(X(0), totY)}${tick(X(len), totY)}`);
  out.push(`<text x="${X(len / 2).toFixed(1)}" y="${(totY - 3).toFixed(1)}" font-size="11" font-weight="700" text-anchor="middle">전체 ${num(len)}</text>`);
  const dx = X(len) + 16;
  out.push(`<line x1="${dx}" y1="${Y(0).toFixed(1)}" x2="${dx}" y2="${Y(dep).toFixed(1)}" stroke="#000" stroke-width="0.9"/><line x1="${dx - 4}" y1="${Y(0).toFixed(1)}" x2="${dx + 4}" y2="${Y(0).toFixed(1)}" stroke="#000" stroke-width="0.9"/><line x1="${dx - 4}" y1="${Y(dep).toFixed(1)}" x2="${dx + 4}" y2="${Y(dep).toFixed(1)}" stroke="#000" stroke-width="0.9"/>`);
  out.push(`<text x="${dx + 6}" y="${Y(dep / 2).toFixed(1)}" font-size="11" font-weight="700">깊이 ${num(dep)}</text>`);
  out.push(`<text x="${X(0).toFixed(1)}" y="${(H - 6).toFixed(1)}" font-size="9" fill="#555">선: 굵은 실선 = 상판 바깥 · 아주 굵은 선 = 벽 · 가는 선 = 하부장 칸 · 파선 = 타공 · 빗금 = 상판 없음 · 치수 mm</text>`);
  return `<svg class="top-plan" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="상판 탑뷰 — 하부장 배치 · 타공 · 전체 치수" font-family="'Malgun Gothic', sans-serif">${out.join('')}</svg>`;
}

const side = (v) => (v === 'wall' ? '벽 — 마감 안 함' : v === 'cabinet' ? '장 옆 — 마감 안 함' : '노출 — 마감');

/** 엘리베이터 — 상판은 길고 무겁다 (2026-11-05 사장님 「엘리베이터 있는지 여부도 확인」). 현장 정보 has_elevator (플래너 앱 문서 창 · 앱 현장 정보) */
function elevatorText(site) {
  if (site && site.has_elevator === true) return '있음';
  if (site && site.has_elevator === false) return '<b>없음</b> — 계단 · 사다리차 검토';
  return `<span class="warn">${CHECK} 엘리베이터 미확인</span>`;
}

const modelName = (m) => (m ? `${esc(m.name)}${m.code ? ` <span class="mono">${esc(m.code)}</span>` : ''}` : `<span class="warn">${CHECK} 모델 미지정</span>`);

/** 플래너가 그려 보낸 상판 탑뷰 (코너 — 발행 때 고정 · 인쇄 때 서명). 없으면 '' → 앱 그림 */
function planImgOf(ctx, req) {
  const r = Array.isArray(ctx.planRenders) ? ctx.planRenders.find((x) => x && x.item_index === req.index) : null;
  const url = r && r.path && ctx.renderUrls ? ctx.renderUrls.get(r.path) : null;
  return url ? `<div class="top-plan-img"><img src="${esc(url)}" alt="상판 탑뷰 (플래너 그림)" style="width:100%;height:auto"><div class="muted">플래너 탑뷰 — 하부장 배치 · 타공 · 치수 mm</div></div>` : '';
}

function requestSheet(ctx, req, k, total) {
  const doc = ctx.doc;
  const top = ctx.top || {};
  const vendors = top.vendors || {};
  const vendor = vendors[TOP_VENDOR_KEY[req.material] || 'topMarble'] || '';
  const sw = req.finishCode ? ctx.swatchByCode.get(req.finishCode) : null;
  const deadline = top.deadline
    ? `<b>${esc(dayLabel(top.deadline))}</b> 까지 (설치 ${esc(dayLabel(top.installDate))} − ${num(top.leadDays || 4)}근무일)${top.today && top.deadline < top.today ? ' <span class="warn">이미 지남</span>' : ''}`
    : `<span class="warn">${CHECK} 설치일 미정 — 설치 4근무일 전까지</span>`;
  const f = req.finishes;
  const cutRows = req.cutouts.length
    ? req.cutouts.map((c) => `<tr><td>${KIND_ICON[c.kind] || ''} ${esc(c.label)}</td><td>${modelName(c.model)}</td><td>${c.center === null ? esc(c.at || '') : `${c.no ? `${num(c.no)}번 칸 · ` : ''}왼쪽 끝에서 중심 <b>${num(c.center)}</b>${req.shape === 'corner' ? ' <span class="muted">(펼친 길이)</span>' : ''}`}</td><td>${cutoutSize(c)}</td></tr>`).join('')
    : '<tr><td colspan="4" class="muted">타공 없음 (개수대 · 가스대 모듈 없음)</td></tr>';
  const rs = f.rearShelf || {};
  const rearText = rs.on ? (rs.d > 0 && rs.h > 0 ? `있음 · 깊이 ${num(rs.d)} × 높이 ${num(rs.h)}` : `있음 · <span class="warn">${CHECK} 크기 미정</span>`) : '없음';
  return `
<div class="sheet">
  <div class="doc-header">
    <div>
      <h1>상판 발주 요청서${total > 1 ? ` <span class="muted">${esc(req.itemLabel)} · ${k + 1}/${total}</span>` : ''}</h1>
      <div>${vendor ? `업체 ${esc(vendor)}` : `<span class="warn">${CHECK} ${esc(req.material)} 업체 — 생산 설정에서 지정</span>`}</div>
    </div>
    <div class="doc-meta">
      <div class="doc-no">${esc(doc.doc_no)}</div>
      <div>Rev. ${esc(doc.rev)}</div>
      <div>발행 ${esc(ymd(doc.created_at))}</div>
    </div>
  </div>
  <dl class="kv">
    <dt>발주 마감</dt><dd>${deadline}</dd>
    <dt>시공</dt><dd>설치 당일 또는 다음 날 (현장 결정)</dd>
    <dt>재질</dt><dd>${esc(req.material)} · 두께 <b>${num(req.thickness)}T</b></dd>
    <dt>색</dt><dd>${req.finishCode ? `<span class="mono">${esc(req.finishCode)}</span> ${esc((sw && sw.color_name) || '')}${sw && sw.vendor_code ? ` · 업체 코드 <span class="mono">${esc(sw.vendor_code)}</span>` : ''}` : `<span class="warn">${CHECK} 색 미지정</span>`}</dd>
    <dt>치수</dt><dd>${req.shape === 'corner' ? '코너 — ' : '일자 — '}전체 길이 <b>${num(req.length)}</b> × 깊이 <b>${num(req.depth)}</b> <span class="muted">(도면 치수 그대로 발주 · 나누기 · 이음 · 재단은 업체 판단)</span>${req.bomGap ? ` <span class="warn">${CHECK} BOM 상판 길이 합 ${num(req.topLength)} 와 ${num(Math.abs(req.bomGap))} 다름 — 하부장 위 수납장 칸 빼고</span>` : ''}</dd>
    <dt>엘리베이터</dt><dd>${elevatorText(ctx.top && ctx.top.siteInfo)}</dd>
  </dl>
  <div class="section-title">탑뷰 <span class="muted">하부장 배치 그대로 · 위에서 본 모습</span></div>
  ${planImgOf(ctx, req) || planSvg(req)}
  <div class="section-title">싱크볼 · 수전 · 쿡탑</div>
  <table class="compact"><thead><tr><th scope="col">설비</th><th scope="col">모델</th><th scope="col">위치</th><th scope="col">타공</th></tr></thead><tbody>${cutRows}</tbody></table>
  <div class="section-title">마감</div>
  <table class="compact"><tbody>
    <tr><th scope="row">뒷백 (뒷턱 · 백가드)</th><td>${f.backsplash.on ? `있음 · 높이 ${num(f.backsplash.h)}` : '없음'}</td></tr>
    <tr><th scope="row">뒷선반 (벽 쪽 선반)</th><td>${rearText}</td></tr>
    <tr><th scope="row">앞턱 (등뜨기)</th><td>${f.frontLip.na ? '해당 없음 (50T)' : f.frontLip.on ? `있음 · 높이 ${num(f.frontLip.h)}` : '없음'}</td></tr>
    <tr><th scope="row">물끊기</th><td>${f.drip.on ? '있음' : '없음'}</td></tr>
    <tr><th scope="row">옆면</th><td>좌 ${side(f.sideLeft)} · 우 ${side(f.sideRight)}</td></tr>
  </tbody></table>
  <div class="note">치수는 도면 치수로 확정합니다 (실측 없이 바로 발주). 나누기 · 이음 · 재단은 업체 판단 — 정해지면 알려 주세요.</div>
</div>`;
}

/** 꾸러미 top — 품목마다 한 쪽 (끊긴 상판도 한 장 탑뷰) */
export function countertopSheets(ctx) {
  const top = ctx.top || {};
  const reqs = countertopRequests(ctx.snapshot, { countertop: top.countertop, models: top.models });
  if (!reqs.length) return '<div class="sheet"><div class="section-title">상판 발주 요청서</div><div class="muted">상판 없음 (BOM 에 상판 행이 없습니다)</div></div>';
  return reqs.map((r, k) => requestSheet(ctx, r, k, reqs.length)).join('\n');
}
