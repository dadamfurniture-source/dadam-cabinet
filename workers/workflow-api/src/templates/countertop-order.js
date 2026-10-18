/**
 * 상판 발주 요청서 (작업지시서 꾸러미 `?pack=top`) — 상판 업체에 보내는 종이.
 * 도어재 발주서와 같은 원칙: 고객 이름 · 설계 제목 · 금액 없음. 상판 한 장마다 한 쪽.
 * 데이터는 ../countertop.js countertopRequests (순수). 발주 마감 · 업체 · 모델은 인쇄 시점 ctx.top 이 준다.
 */

import { esc, num, ymd } from './html.js';
import { countertopRequests, TOP_VENDOR_KEY } from '../countertop.js';
import { dayLabel } from '../production/planner.js';

const KIND_ICON = { sink: '①', cooktop: '②', faucet: '③' };
const CHECK = '[확인 필요]';

function cutoutSize(c) {
  if (c.kind === 'faucet') {
    if (!c.model) return `${CHECK} 싱크볼 모델 미지정`;
    return c.dia ? `지름 ${num(c.dia)}` : `${CHECK} 모델 ${esc(c.model.name)} 수전 타공 지름 없음`;
  }
  if (!c.model) return `${CHECK} 모델 미지정`;
  const size = c.model.w && c.model.d ? `타공 ${num(c.model.w)} × ${num(c.model.d)}${c.model.r ? ` R${num(c.model.r)}` : ''}` : `${CHECK} 모델 타공 치수 없음`;
  return `모델 ${esc(c.model.name)}${c.model.code ? ` <span class="mono">${esc(c.model.code)}</span>` : ''} · ${size}`;
}

/** 평면 치수도 — 일자는 길이 × 깊이 사각형, 코너는 하부 모듈 자리(_place) 합. 벽 쪽은 굵은 선, 타공 자리는 점선. */
export function planSvg(req) {
  const W = 640;
  const H = 260;
  const pad = 30;
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
  const len = Math.max(1, req.length);
  const dep = Math.max(1, req.depth);
  const s = Math.min((W - 2 * pad) / len, (H - 2 * pad - 20) / dep);
  const x0 = pad;
  const y0 = pad + 10;
  const w = len * s;
  const h = dep * s;
  const holes = req.cutouts.filter((c) => c.center !== null).map((c) => {
    const cw = (c.model && c.model.w ? c.model.w : 500) * s;
    const cd = (c.model && c.model.d ? c.model.d : 400) * s;
    const cx = x0 + c.center * s;
    return `<rect x="${(cx - cw / 2).toFixed(1)}" y="${(y0 + h / 2 - cd / 2).toFixed(1)}" width="${cw.toFixed(1)}" height="${cd.toFixed(1)}" fill="none" stroke="#1d4ed8" stroke-dasharray="4 3"/>`
      + `<text x="${cx.toFixed(1)}" y="${(y0 + h / 2 + 4).toFixed(1)}" font-size="11" text-anchor="middle">${KIND_ICON[c.kind] || ''}</text>`
      + `<line x1="${x0}" y1="${(y0 + h + 14).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(y0 + h + 14).toFixed(1)}" stroke="#1d4ed8" stroke-width="0.6"/>`
      + `<text x="${((x0 + cx) / 2).toFixed(1)}" y="${(y0 + h + 26).toFixed(1)}" font-size="10" text-anchor="middle">${num(c.center)}</text>`;
  }).join('');
  return `<svg class="top-plan" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="상판 평면">
  <rect x="${x0}" y="${y0}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#f9fafb" stroke="#333"/>
  <line x1="${x0}" y1="${y0}" x2="${(x0 + w).toFixed(1)}" y2="${y0}" stroke="#111" stroke-width="4"/>
  <text x="${(x0 + w / 2).toFixed(1)}" y="${y0 - 6}" font-size="11" text-anchor="middle">벽 (뒤) · 길이 ${num(req.length)}</text>
  <text x="${(x0 + w + 6).toFixed(1)}" y="${(y0 + h / 2).toFixed(1)}" font-size="11">깊이 ${num(req.depth)}</text>
  ${holes}
</svg>`;
}

const side = (v) => (v === 'wall' ? '벽 — 마감 안 함' : '노출 — 마감');

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
    ? req.cutouts.map((c) => `<tr><td>${KIND_ICON[c.kind] || ''} ${esc(c.label)}</td><td>${c.center === null ? esc(c.at || '') : `좌측 끝에서 중심 <b>${num(c.center)}</b>${req.shape === 'corner' ? ' <span class="muted">(펼친 길이)</span>' : ''}`}</td><td>${cutoutSize(c)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="muted">타공 없음 (개수대 · 쿡탑 모듈 없음)</td></tr>';
  return `
<div class="sheet">
  <div class="doc-header">
    <div>
      <h1>상판 발주 요청서${total > 1 ? ` <span class="muted">${k + 1}/${total}</span>` : ''}</h1>
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
    <dt>치수</dt><dd>${req.shape === 'corner' ? '코너 — ' : '일자 — '}길이 <b>${num(req.length)}</b> × 깊이 <b>${num(req.depth)}</b> <span class="muted">(도면 치수 그대로 발주 · 이음은 업체 판단)</span></dd>
  </dl>
  <div class="section-title">평면</div>
  ${planSvg(req)}
  <div class="section-title">타공</div>
  <table class="compact"><thead><tr><th scope="col">구멍</th><th scope="col">위치</th><th scope="col">크기</th></tr></thead><tbody>${cutRows}</tbody></table>
  <div class="section-title">마감</div>
  <table class="compact"><tbody>
    <tr><th scope="row">뒷턱 (백가드)</th><td>${f.backsplash.on ? `있음 · 높이 ${num(f.backsplash.h)}` : '없음'}</td></tr>
    <tr><th scope="row">앞턱 (등뜨기)</th><td>${f.frontLip.na ? '해당 없음 (50T)' : f.frontLip.on ? `있음 · 높이 ${num(f.frontLip.h)}` : '없음'}</td></tr>
    <tr><th scope="row">물끊기</th><td>${f.drip.on ? '있음' : '없음'}</td></tr>
    <tr><th scope="row">옆면</th><td>좌 ${side(f.sideLeft)} · 우 ${side(f.sideRight)}</td></tr>
  </tbody></table>
  <div class="note">치수는 도면 치수로 확정합니다 (실측 없이 바로 발주). 이음 위치는 업체 판단 — 정해지면 알려 주세요.</div>
</div>`;
}

/** 꾸러미 top — 상판 한 장마다 한 쪽 */
export function countertopSheets(ctx) {
  const top = ctx.top || {};
  const reqs = countertopRequests(ctx.snapshot, { countertop: top.countertop, models: top.models });
  if (!reqs.length) return '<div class="sheet"><div class="section-title">상판 발주 요청서</div><div class="muted">상판 없음 (BOM 에 상판 행이 없습니다)</div></div>';
  return reqs.map((r, k) => requestSheet(ctx, r, k, reqs.length)).join('\n');
}
