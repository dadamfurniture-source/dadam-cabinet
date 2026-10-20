/**
 * 기본안 위치 검사 — 기록 전용 (2026-10-20, src/position.js · 설계 docs/02-design/features/position-qc.md).
 *
 * 고정하는 것:
 *   1) 질의·스키마가 오프라인 검증본과 같다 (해시 7d7a7f69a5 · test/fixtures/position-schema.json)
 *   2) 기하: 교차비·깊이 투영·후드 앞면 → 뒷선·선형 대체를 답을 아는 가상 방으로
 *   3) 경로별 정답: 글 %(반폭 클램프) · 플래너(fromLeftMm 왼쪽 끝, H1 쿡탑, 키큰장, ㄱ자 corner × 방향, 냉장고 칸, 끊긴 줄) ·
 *      도면 덩어리(칠 배율·충돌) · 싱크대 덩어리(마스크 순서·교차비)
 *   4) 채점: 문턱 경계, σ, 보류 사유, 경계, ok, 벽 틀 우선(run_end), 경로별 경보 켜기
 *   5) 실패해도 생성은 계속: 깨진 JSON·시간 초과·HTTP 오류·PNG — 코드만, 던지지 않음. 과부하 재시도 1회(Retry-After 무시)
 *   6) 호출 위치: job.js 의 QC 다음·업로드 전, 추천안 밖. 게이트 켠 잡에서 기록, 상태·단계·진행률은 게이트 끈 잡과 같다
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import encodeJpeg from 'jpeg-js/lib/encoder.js';
import {
  POSITION_ITEMS,
  capRecord,
  cropScale,
  derive,
  inter,
  line,
  lsqPoint,
  mergeZoom,
  positionExpected,
  positionMeasure,
  positionResult,
  positionRoute,
  positionSkipped,
  runPositionCheck,
  sCr,
  startPositionCheck,
  toLandmarks,
  toPct,
  uOfVh,
  wallGate,
  zoomCropRect,
} from '../src/position.js';
import {
  POSITION_SCHEMA,
  buildPlannerPrompt,
  buildPositionPrompt,
  normalizeDesignSpec,
  parsePositionLandmarks,
  plannerPositionFrame,
  positionPromptHashSource,
} from '../src/prompts.js';
import { callGemini, geminiOverloadAt } from '../src/gemini.js';
import { encodeJpeg as encodeJpegGuide } from '../src/guide.js';
import { kitchenFaces, projectFaces, solveKitchenCamera } from '../src/kitchen.js';
import { plannerPlaceBlocks } from '../src/planner-place.js';
import { GenerateJob } from '../src/job.js';

const SRC = (f) => fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ─── 가상 방 (답을 아는 투영) ───
/** 뒷벽 X 0~3000, 상판 높이 880, 상판 앞선 z 650, 상부장 앞 아랫선 h 1500·z 350. yaw 로 사선, pitch(+ 내려다봄)로 세로선이 모인다 */
function scene({ W = 1600, H = 1200, f = (900 * W) / 1600, hf = 1400, D = 3600, yawDeg = 18, pitchDeg = 0, X0 = 0, X1 = 3000, xc = 1500 } = {}) {
  const t = (yawDeg * Math.PI) / 180;
  const pt = (pitchDeg * Math.PI) / 180;
  const r1 = [Math.cos(t), 0, Math.sin(t)];
  const r3 = [-Math.sin(t), 0, Math.cos(t)];
  const proj = (X, h, z) => {
    const c0 = [0, 1, 2].map((i) => (X - xc) * r1[i] + (i === 1 ? hf - h : 0) + (D - z) * r3[i]);
    const c = [c0[0], c0[1] * Math.cos(pt) - c0[2] * Math.sin(pt), c0[1] * Math.sin(pt) + c0[2] * Math.cos(pt)];
    return [(f * c[0]) / c[2] + W / 2, (f * c[1]) / c[2] + H / 2];
  };
  const P = (X, h, z) => {
    const [x, y] = proj(X, h, z);
    return { x: (x / W) * 100, y: (y / H) * 100, flag: 'visible', type: null };
  };
  const top = 880;
  const L = {
    WL: { ...P(X0, top, 0), type: 'corner' },
    WR: { ...P(X1, top, 0), type: 'corner' },
    CBL: P(X0, top, 0),
    CBR: P(X1, top, 0),
    CFL: P(X0, top, 650),
    CFR: P(X1, top, 650),
    U1: P(X0 + 200, 1500, 350),
    U2: P(X1 - 200, 1500, 350),
    SINK_B: P(1500, top, 100),
    K_BL: P(2200, top, 80),
    K_BR: P(2800, top, 80),
    K_FR: P(2800, top, 600),
    K_FL: P(2200, top, 600),
    HL: P(2200, 1500, 350),
    HR: P(2800, 1500, 350),
    _kitchen: true,
    _layout: 'straight',
  };
  return { L, W, H, proj, P };
}

/** 가상 방 점 → Flash 응답 JSON ([y, x] 0~1000) */
function asResponse(L) {
  const p = (e) => (e ? [Math.round(e.y * 10), Math.round(e.x * 10)] : null);
  const pt = (k) => ({ flag: 'visible', p: p(L[k]) });
  return {
    kitchen_installed: true,
    layout: 'straight',
    content_x: [0, 1000],
    WL: { evidence: 'inner corner', wall_type: 'corner', flag: 'visible', p: p(L.WL) },
    WR: { evidence: 'inner corner', wall_type: 'corner', flag: 'visible', p: p(L.WR) },
    CBL: pt('CBL'), CBR: pt('CBR'), CFL: pt('CFL'), CFR: pt('CFR'), U1: pt('U1'), U2: pt('U2'),
    F: { mount: 'deck', flag: 'absent', p: null },
    SINK: { flag: 'visible', box: null, back_mid: p(L.SINK_B) },
    K: { kind: 'induction', flag: 'visible', BL: p(L.K_BL), BR: p(L.K_BR), FR: p(L.K_FR), FL: p(L.K_FL), box: null },
    HOOD: { hood_type: 'slim_concealed', flag: 'visible', HL: p(L.HL), HR: p(L.HR), box: null },
    notes: 'synthetic',
  };
}

/** 띠 응답 — 워커와 같은 띠 범위(zoomCropRect)로 점을 띠 좌표로 바꾼다 */
function asZoomResponse(L, W, H) {
  const full = asResponse(L);
  const Lf = toLandmarks(full, { W, H });
  const c = zoomCropRect(Lf, W, H);
  const conv = (p) => (p ? [Math.round((((p[0] / 1000) * H - c.y0) / c.h) * 1000), Math.round((((p[1] / 1000) * W - c.x0) / c.w) * 1000)] : null);
  const out = JSON.parse(JSON.stringify(full));
  for (const k of ['WL', 'WR', 'CBL', 'CBR', 'CFL', 'CFR', 'U1', 'U2']) out[k].p = conv(out[k].p);
  out.SINK.back_mid = conv(out.SINK.back_mid);
  for (const k of ['BL', 'BR', 'FR', 'FL']) out.K[k] = conv(out.K[k]);
  out.HOOD.HL = conv(out.HOOD.HL);
  out.HOOD.HR = conv(out.HOOD.HR);
  return out;
}
const respond2 = (L, W, H) => (p) => ({ text: JSON.stringify(/ZOOMED CROP/.test(p.prompt) ? asZoomResponse(L, W, H) : asResponse(L)), meta: { usage: { promptTokenCount: 2300, candidatesTokenCount: 400 } } });

function jpegOf(w, h, seed = 0) {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = (i * 7 + seed) % 255;
    data[i * 4 + 1] = (i * 3 + seed * 5) % 255;
    data[i * 4 + 2] = 128;
    data[i * 4 + 3] = 255;
  }
  return { base64: encodeJpeg({ width: w, height: h, data }, 80).data.toString('base64'), mimeType: 'image/jpeg' };
}

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (±${tol})`);

// ─────────────────────────── 1. 질의·스키마 ───────────────────────────

test('질의는 오프라인 검증본과 글자까지 같다 — md5 앞 10자리 7d7a7f69a5', () => {
  const h = crypto.createHash('md5').update(positionPromptHashSource()).digest('hex').slice(0, 10);
  assert.equal(h, '7d7a7f69a5');
  const full = buildPositionPrompt();
  const zoom = buildPositionPrompt({ zoom: true });
  assert.match(full, /^TASK: mark precise geometric landmarks of the MAIN kitchen run/);
  assert.match(full, /COORDINATES: every point is \[y, x\]/);
  assert.ok(full.endsWith('A clipped point may lie slightly outside 0-1000.'));
  assert.ok(!full.includes('ZOOMED CROP'));
  // 띠: 좌표 문장 바로 앞에 띠 문장
  assert.ok(zoom.indexOf('This image is a ZOOMED CROP') < zoom.indexOf('COORDINATES:'));
  assert.ok(/^[\x00-\x7f]*$/.test(zoom), 'ASCII 만');
  assert.ok(!zoom.includes('\r'));
  // 상판 뒷선 문장은 옛것 (접합선 문장은 GPT 용)
  assert.match(full, /2\. CBL \/ CBR = left \/ right ends of the countertop BACK edge \(the line where the countertop top surface meets the back wall\)/);
  assert.ok(!full.includes('JUNCTION'));
  // 잡 시험 목업이 가로채는 머리말과 겹치지 않는다
  for (const head of ['You are checking', 'Measure and describe', 'Find lines and corners', 'This render shows']) assert.ok(!full.startsWith(head));
  // 실제로 보내는 조립(정의 + \n\n + [띠 문장 + \n\n] + 좌표)도 오프라인 promptFor('gen', zoom, 'core') 와 같다 — 조각 해시만으로는
  //   구분자·띠 문장 위치가 묶이지 않는다 (오프라인 값: gen-eval2 measure_vlm2.js 조립을 그대로 md5)
  const md5 = (x) => crypto.createHash('md5').update(x).digest('hex').slice(0, 10);
  assert.equal(md5(full), 'b63d4b281b');
  assert.equal(md5(zoom), '6258986872');
});

test('응답 스키마는 오프라인 geminiGenSchema(false) 와 같다 (fixture)', () => {
  const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/position-schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(POSITION_SCHEMA, fx);
  assert.deepEqual(POSITION_SCHEMA.propertyOrdering, Object.keys(POSITION_SCHEMA.properties));
  assert.ok(!('LR' in POSITION_SCHEMA.properties) && !('DEPTH_LINES' in POSITION_SCHEMA.properties), '도면 질의 항목 없음');
});

test('응답 파서: 코드 울타리 · 깨진 JSON · 배열 · null', () => {
  assert.deepEqual(parsePositionLandmarks('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parsePositionLandmarks(' {"kitchen_installed":true} '), { kitchen_installed: true });
  assert.equal(parsePositionLandmarks('{"a":'), null);
  assert.equal(parsePositionLandmarks('[1,2]'), null);
  assert.equal(parsePositionLandmarks(''), null);
  assert.equal(parsePositionLandmarks(null), null);
  assert.equal(parsePositionLandmarks('null'), null);
});

// ─────────────────────────── 2. 기하 ───────────────────────────

test('직선·교점·최소제곱 교점', () => {
  const a = line([0, 0], [10, 0]);
  const b = line([5, -5], [5, 5]);
  assert.deepEqual(inter(a, b).map((v) => Math.round(v * 1e6) / 1e6), [5, 0]);
  assert.equal(inter(a, line([0, 1], [10, 1])), null, '평행');
  const p = lsqPoint([a, b, line([0, -5], [10, 5])]);
  near(p[0], 5, 1e-6);
  near(p[1], 0, 1e-6);
});

test('교차비: u=0 이면 선형, 소실점이 폭의 5배 밖이거나 |u|<0.029 면 선형', () => {
  near(sCr(30, 10, 90, 0), 25, 1e-9);
  assert.equal(sCr(null, 10, 90, 0), null);
  assert.equal(sCr(30, 10, 10, 0), null);
  assert.equal(uOfVh([100 * 6, 0], 100), 0, '5W 밖');
  assert.equal(uOfVh([3600, 0], 100), 0, '|u| = 100/3550 < 0.029');
  near(uOfVh([-200, 0], 100), 100 / (-250), 1e-12);
  assert.equal(uOfVh(null, 100), 0);
});

test('가상 사선 방: 깊이 투영·교차비로 벽 % 가 0.2 pp 안 (싱크 50 %, 쿡탑·후드 83.3 %)', () => {
  const s = scene({ yawDeg: 18 });
  const D = derive(s.L, s.W, s.H);
  assert.ok(!D.fail);
  assert.ok(D.vz, 'vz 를 푼다 (쿡탑 옆변 우선)');
  assert.notEqual(D.u, 0, '사선 — 원근 보정');
  const E = { route: 'text_pct', frameW: 3000, mm: {}, hold: {}, alt: {}, sw: {}, t: 350 / 650 };
  const M = positionMeasure(D, E);
  near(M.wall.sink, 50, 0.2, 'sink');
  near(M.wall.cook, (2500 / 3000) * 100, 0.2, 'cook');
  near(M.wall.hood, (2500 / 3000) * 100, 0.3, 'hood (앞면 z 350 → 뒷선)');
  near(M.wall.runL, 0, 0.05);
  near(M.wall.runR, 100, 0.05);
  // 선형(u=0)으로 두면 사선에서 수 pp 틀린다 — 원근 보정을 빼면 안 된다
  const lin = positionMeasure({ ...D, u: 0 }, E);
  assert.ok(Math.abs(lin.wall.sink - 50) > 1, `선형 ${lin.wall.sink}`);
});

test('가상 정면 방: vh 가 무한원 → 선형, 값은 그대로 맞는다', () => {
  const s = scene({ yawDeg: 0 });
  const D = derive(s.L, s.W, s.H);
  assert.equal(D.u, 0);
  const M = positionMeasure(D, { route: 'text_pct', frameW: 3000, mm: {}, hold: {}, alt: {}, sw: {}, t: 350 / 650 });
  near(M.wall.sink, 50, 0.1);
  near(M.wall.hood, 83.33, 0.15);
});

test('vz: 쿡탑 옆변이 먼저 — 상판 끝 선분이 4° 넘게 어긋나면 뺀다, 뒷선 아래 해는 버린다', () => {
  const s = scene({ yawDeg: 18 });
  // 왼쪽 상판 끝 선분을 크게 비튼다 (ㄱ자 안쪽 모서리처럼 깊이 선이 아님)
  const bent = { ...s.L, CFL: { ...s.L.CFL, x: s.L.CFL.x + 12 } };
  const D1 = derive(s.L, s.W, s.H);
  const D2 = derive(bent, s.W, s.H);
  near(D2.vz[0], D1.vz[0], 0.5, 'vz x% 그대로');
  // 쿡탑 없이 상판 끝 두 선분이 서로 벌어지면(교점이 뒷선 아래) vz 없음 → 투영 생략
  const noK = { ...s.L, K_BL: undefined, K_BR: undefined, K_FL: undefined, K_FR: undefined, CFL: { ...s.L.CFL, x: s.L.CBL.x + 5 }, CFR: { ...s.L.CFR, x: s.L.CBR.x - 5 } };
  const D3 = derive(noK, s.W, s.H);
  assert.equal(D3.vz, null);
  const p = s.L.SINK_B;
  near(D3.img.sink, p.x, 1e-9, 'x 그대로');
});

test('깊이 투영: 뒷선보다 0.2 %H 넘게 위(뒤)에 찍힌 점은 투영하지 않는다', () => {
  const s = scene({ yawDeg: 18 });
  const yBack = (s.L.CBL.y + s.L.CBR.y) / 2;
  const L = { ...s.L, SINK_B: { ...s.L.SINK_B, y: yBack - 1.0 } };
  const D = derive(L, s.W, s.H);
  near(D.img.sink, L.SINK_B.x, 1e-9);
});

test('후드 세로 소실점: pitch 5~20°(내려다봄·올려다봄)에서도 후드 앞선 → 뒷선이 맞는다 — 이미지 세로로 내리면 수십 mm 틀린다', () => {
  const E = { route: 'text_pct', frameW: 3000, mm: {}, hold: {}, alt: {}, sw: {}, t: 350 / 650 };
  const hoodMm = (D) => (positionMeasure(D, E).wall.hood * 3000) / 100 - 2500; // 참 후드 중심 X 2500
  const trueF35 = (900 / 2000) * 43.27; // 가상 방 f 900 px, 대각선 2000 px
  for (const pitchDeg of [5, 10, 15, 20, -10]) {
    // 정면: vh 가 무한원이라 f 를 못 푼다 — 참 초점거리를 주면 0, 가정값(24 mm)이면 옛 계산의 1/3 안
    const s = scene({ yawDeg: 0, pitchDeg });
    const old = hoodMm(derive(s.L, s.W, s.H, { vvH: null }));
    assert.ok(Math.abs(old) > 15, `옛 계산이 틀리는 장면이어야 한다 (pitch ${pitchDeg}: ${old})`);
    near(hoodMm(derive(s.L, s.W, s.H, { f35: trueF35 })), 0, 1, `정면 pitch ${pitchDeg} 참 f`);
    const def = derive(s.L, s.W, s.H);
    assert.equal(def.fSrc, 'default');
    assert.ok(Math.abs(hoodMm(def)) < Math.abs(old) / 2.5, `정면 pitch ${pitchDeg}: 가정 f ${hoodMm(def)} vs 옛 ${old}`);
    // 사선: vh·vz 직교로 f 를 푼다 → 0
    const o = scene({ yawDeg: 18, pitchDeg });
    const Do = derive(o.L, o.W, o.H);
    assert.equal(Do.fSrc, 'vp');
    near(hoodMm(Do), 0, 1, `사선 pitch ${pitchDeg}`);
    // 상판 위 점(싱크·쿡탑)은 pitch 와 무관하게 그대로
    near(positionMeasure(def, E).wall.sink, 50, 0.1);
    near(positionMeasure(Do, E).wall.cook, (2500 / 3000) * 100, 0.2);
  }
  // pitch 0 이면 세로선 그대로 — 옛 값과 같다
  const flat = scene({ yawDeg: 18 });
  near(hoodMm(derive(flat.L, flat.W, flat.H)), hoodMm(derive(flat.L, flat.W, flat.H, { vvH: null })), 1e-6);
  // 보정량의 절반이 후드 σ 에 들어간다 (정면 10°, 가정 f)
  const s10 = scene({ yawDeg: 0, pitchDeg: 10 });
  const wall = { wallW: 3000, wallH: 2400, waterPct: 50, exhaustPct: (2500 / 3000) * 100, confidence: 'medium' };
  const r = positionResult({ route: 'text_pct', Lf: { ...s10.L }, Lz: { ...s10.L }, nz: null, W: s10.W, H: s10.H, input: { category: 'sink', options: {}, wall } });
  assert.ok(r.measured.sd.hood_cook >= 40, JSON.stringify(r.measured.sd));
});

test('vz 검사: 지평선(vh 와 세로 8 pp 넘게 갈림)·정면(vh 무한원인데 가운데에서 25 pp 밖)이면 vz 를 버리고 Δ 이동으로 잰다', () => {
  // 사선: 쿡탑 앞 모서리를 벌려 쿡탑 옆변 교점이 지평선에서 벗어나게
  const s = scene({ yawDeg: 18 });
  const bad = { ...s.L, K_FL: { ...s.L.K_FL, x: s.L.K_FL.x - 3 }, K_FR: { ...s.L.K_FR, x: s.L.K_FR.x + 3 } };
  const D = derive(bad, s.W, s.H);
  assert.equal(D.vz, null);
  assert.equal(D.vzDrop, 'horizon');
  assert.equal(derive(s.L, s.W, s.H).vzDrop, null, '맞는 vz 는 그대로');
  const rec = positionResult({ route: 'text_pct', Lf: { ...bad }, Lz: { ...bad }, nz: null, W: s.W, H: s.H, input: { category: 'sink', options: {}, wall: { wallW: 3000, wallH: 2400, waterPct: 50, exhaustPct: 83.3, confidence: 'medium' } } });
  assert.equal(rec.measured.vz_drop, 'horizon');
  assert.equal(rec.measured.vz, null);
  // 정면: 쿡탑 옆변을 한쪽으로 기울여 교점을 왼쪽 밖으로
  const f = scene({ yawDeg: 0 });
  const tilt = { ...f.L, K_FL: { ...f.L.K_FL, x: f.L.K_FL.x + 4 }, K_FR: { ...f.L.K_FR, x: f.L.K_FR.x + 4 }, CFL: { ...f.L.CFL, x: f.L.CFL.x + 4 }, CFR: { ...f.L.CFR, x: f.L.CFR.x + 4 } };
  const Df = derive(tilt, f.W, f.H);
  assert.equal(Df.u, 0);
  assert.equal(Df.vzDrop, 'frontal', JSON.stringify(Df.vz));
  assert.equal(derive(f.L, f.W, f.H).vzDrop, null);
});

test('vh 검사: 직선이 상판 뒷선 구간 안에서 만나면(앞선 끝점 오인) 벽·런·후드−쿡탑 보류 vh — 마스크 대조는 그대로', () => {
  const s = scene({ yawDeg: 0 });
  const L = { ...s.L, U1: undefined, U2: undefined, CFR: { ...s.L.CFR, y: s.L.CBR.y - 2 } }; // 앞선 오른끝을 뒷선 위로
  const D = derive(L, s.W, s.H);
  assert.equal(D.vhBad, true);
  assert.equal(derive(s.L, s.W, s.H).vhBad, false);
  const wall = { wallW: 3000, wallH: 2400, waterPct: 50, exhaustPct: (2500 / 3000) * 100, confidence: 'medium' };
  const r = positionResult({ route: 'text_pct', Lf: { ...L }, Lz: { ...L }, nz: null, W: s.W, H: s.H, input: { category: 'sink', options: {}, wall } });
  for (const k of ['sink_wall', 'cook_wall', 'hood_cook']) assert.equal(r.measured.hold[k], 'vh', k);
  assert.equal(r.ok, null);
  const p = positionResult({ route: 'planner', Lf: { ...L }, Lz: { ...L }, nz: null, W: s.W, H: s.H, input: { category: 'sink', options: { mode: 'planner', design_spec: specA() }, wall: { wallW: 3400, wallH: 2400, confidence: 'medium' } } });
  for (const [k, h] of Object.entries(p.measured.hold)) assert.ok(['vh', 'wall_frame'].includes(h) || !['sink_run', 'run_right_wall', 'sink_wall'].includes(k), `${k} ${h}`);
  assert.equal(p.measured.hold.sink_run, 'vh');
});

test('σ_u: 직선이 2개뿐(상부장 없음)이면 둘째 직선 끝점 y 를 흔들어 잰다 — 쌍 퍼짐이 없어도 σ 가 0 이 아니다', () => {
  const s = scene({ yawDeg: 18 });
  const L = { ...s.L, U1: undefined, U2: undefined };
  const D = derive(L, s.W, s.H);
  assert.equal(D.uPairs.length, 0);
  assert.equal(D.uAlts.length, 4);
  assert.ok(D.uAlts.some((u) => Math.abs(u - D.u) > 1e-3));
  const wall = { wallW: 3000, wallH: 2400, waterPct: 50, exhaustPct: (2500 / 3000) * 100, confidence: 'medium' };
  const two = positionResult({ route: 'text_pct', Lf: { ...L }, Lz: { ...L }, nz: null, W: s.W, H: s.H, input: { category: 'sink', options: {}, wall } });
  const three = positionResult({ route: 'text_pct', Lf: { ...s.L }, Lz: { ...s.L }, nz: null, W: s.W, H: s.H, input: { category: 'sink', options: {}, wall } });
  assert.ok(two.measured.sd.sink_wall > three.measured.sd.sink_wall, `${two.measured.sd.sink_wall} vs ${three.measured.sd.sink_wall}`);
});

// ─────────────────────────── 3. 응답 → 점 ───────────────────────────

test('점 변환: [y,x] 0~1000 → %, 띠는 crop 픽셀로 되돌린다 (왕복)', () => {
  assert.deepEqual(toPct([500, 250], { W: 1000, H: 800 }), { x: 25, y: 50 });
  const crop = { x0: 100, y0: 200, w: 600, h: 300 };
  const p = toPct([500, 500], { W: 1000, H: 800, crop });
  near(p.x, 40, 1e-9); // (100 + 300) / 1000
  near(p.y, 43.75, 1e-9); // (200 + 150) / 800
  assert.equal(toPct([NaN, 1], { W: 1, H: 1 }), null);
  assert.equal(toPct('x', { W: 1, H: 1 }), null);
});

test('점 검증: 범위 밖·숫자 아님·순서 뒤집힘은 bad, absent 는 null', () => {
  const L = toLandmarks(
    {
      kitchen_installed: true,
      layout: 'straight',
      WL: { wall_type: 'corner', flag: 'visible', p: [500, 600] },
      WR: { wall_type: 'corner', flag: 'visible', p: [500, 400] }, // WL > WR
      CBL: { flag: 'visible', p: [500, 1100] }, // visible 인데 1000 밖
      CBR: { flag: 'clipped', p: [500, 1080] }, // clipped 는 조금 밖이어도 된다
      CFL: { flag: 'visible', p: ['a', 3] },
      CFR: { flag: 'absent', p: [1, 2] },
      SINK: { flag: 'visible', back_mid: [520, 480], box: null },
      HOOD: { hood_type: 'none', flag: 'absent', HL: null, HR: null, box: null },
    },
    { W: 1000, H: 1000 }
  );
  assert.equal(L.WL.bad, true);
  assert.equal(L.WR.bad, true);
  assert.equal(L.WL.x, null);
  assert.equal(L.CBL.bad, true);
  assert.equal(L.CBR.bad, undefined);
  near(L.CBR.x, 108, 1e-9);
  assert.equal(L.CFL.bad, true);
  assert.equal(L.CFR.x, null);
  assert.equal(L.CFR.bad, undefined);
  near(L.SINK_B.x, 48, 1e-9);
  assert.equal(L.HL.x, null);
  assert.equal(L._kitchen, true);
  assert.equal(toLandmarks(null, { W: 1, H: 1 }), null);
  assert.equal(toLandmarks([1], { W: 1, H: 1 }), null);
});

test('합치기: 띠 값이 있고 absent·clipped·bad 가 아니면 띠, 아니면 전체', () => {
  const F = { WL: { x: 10, y: 50, flag: 'visible' }, WR: { x: 90, y: 50, flag: 'visible' }, CBL: { x: 11, y: 50, flag: 'visible' }, _layout: 'straight' };
  const Z = { WL: { x: 10.4, y: 50, flag: 'visible' }, WR: { x: 95, y: 50, flag: 'clipped' }, CBL: { x: 40, y: 50, flag: 'visible', bad: true }, SINK_B: { x: 50, y: 52, flag: 'visible' }, _layout: 'L_shape' };
  const M = mergeZoom(F, Z);
  assert.equal(M.WL.x, 10.4);
  assert.equal(M.WR.x, 90);
  assert.equal(M.CBL.x, 11);
  assert.equal(M.SINK_B.x, 50);
  assert.equal(M._layout, 'straight', '전체 응답의 layout');
});

test('띠 범위: 점 x ±4 %, 위(상부장·후드)~아래(앞선·뒷선) + 위아래 max(3, 폭×0.25), 0~100 으로 자른다', () => {
  const A = {
    WL: { x: 10, y: 55, flag: 'visible' }, WR: { x: 90, y: 55, flag: 'visible' },
    CFL: { x: 5, y: 65, flag: 'visible' }, CFR: { x: 97, y: 65, flag: 'visible' },
    U1: { x: 12, y: 30, flag: 'visible' }, U2: { x: 88, y: 31, flag: 'visible' },
  };
  const c = zoomCropRect(A, 2000, 1000);
  // x: 5-4=1 → 20px, 97+4=101 → 100 → 2000px · y: 30 − 8.75 = 21.25 → 213, 65 + 8.75 = 73.75 → 738
  assert.deepEqual(c, { x0: 20, y0: 213, w: 1980, h: 525 });
  // 점이 하나도 없으면 가운데 띠
  assert.deepEqual(zoomCropRect({}, 1000, 1000), { x0: 0, y0: 275, w: 1000, h: 450 });
});

test('띠 확대: 쌍선형 2배, JPEG 는 Buffer 없는 런타임(워커)에서도 인코드된다', () => {
  const w = 40, h = 20;
  const src = new Uint8Array(w * h * 4).fill(200);
  const band = cropScale(src, w, { x0: 10, y0: 5, w: 20, h: 10 }, 2);
  assert.equal(band.width, 40);
  assert.equal(band.height, 20);
  assert.equal(band.data[0], 200);
  const real = globalThis.Buffer;
  try {
    delete globalThis.Buffer; // 워커에는 Buffer 가 없다
    const bytes = encodeJpegGuide(band, 92); // guide.js encodeJpeg (#927) 를 같이 쓴다
    assert.ok(bytes instanceof Uint8Array && bytes[0] === 0xff && bytes[1] === 0xd8);
    assert.equal(typeof globalThis.Buffer, 'undefined', '대신 넣은 것은 치운다');
  } finally {
    globalThis.Buffer = real;
  }
});

// ─────────────────────────── 4. 경로·정답 ───────────────────────────

const WALL = { wallW: 3150, wallH: 2400, waterPct: 51, exhaustPct: 94, confidence: 'medium' };

test('경로 판별: 플래너 · 도면 덩어리 · ㄱ자 · 펼친 ㄱ자 · 싱크대 덩어리(도면 있어도) · 도면 요약 · 글 % · 주방 아님', () => {
  const straight = normalizeDesignSpec({ sections: { lower: { widthMm: 2200, fromLeftMm: 0, modules: [{ kind: 'door', widthMm: 2200 }] } } }, 'sink');
  assert.equal(positionRoute({ category: 'sink', options: { mode: 'planner', design_spec: straight }, wall: WALL }), 'planner');
  assert.equal(positionRoute({ category: 'sink', options: { mode: 'planner', design_spec: straight }, wall: WALL, place: { cam: { xL: 0, xR: 3000 } }, placeBlocks: { runMm: 2200, blocks: [] } }), 'planner_place');
  const unfolded = { ...straight, layout: { shape: 'corner', walls: 2 } };
  assert.equal(positionRoute({ category: 'sink', options: { mode: 'planner', design_spec: unfolded }, wall: WALL }), 'planner_unfolded');
  const walls = normalizeDesignSpec(
    { layout: { shape: 'corner', walls: 2 }, sections: straight.sections, walls: [{ side: 'left', corner: 'main', sections: { lower: { widthMm: 900, fromCornerMm: 650, modules: [{ kind: 'door', widthMm: 900 }] } } }] },
    'sink'
  );
  assert.equal(positionRoute({ category: 'sink', options: { mode: 'planner', design_spec: walls }, wall: WALL }), 'planner_walls');
  assert.equal(positionRoute({ category: 'sink', options: { design_spec: straight }, wall: WALL, mockVolume: true, guide: { kind: 'kitchen' } }), 'mock_kitchen');
  assert.equal(positionRoute({ category: 'sink', options: { design_spec: straight }, wall: WALL }), 'spec_text');
  assert.equal(positionRoute({ category: 'island', options: {}, wall: WALL }), 'text_pct');
  assert.equal(positionRoute({ category: 'wardrobe', options: {}, wall: WALL }), null);
  assert.equal(positionRoute({ category: 'sink', options: {}, wall: WALL, mockVolume: true, guide: { kind: 'wardrobe' } }), 'text_pct', '붙박이장 덩어리는 대상 아님');
});

test('글 % 정답: 볼 반폭 400·쿡탑 반폭 300 클램프 (94 % · 3150 mm → 90.48 %), 너무 가까우면 conflict', () => {
  const E = positionExpected('text_pct', { wall: WALL });
  near(E.pct.cook, 100 - (300 / 3150) * 100, 1e-9);
  near(E.pct.cook, 90.48, 0.005);
  near(E.mm.cook_wall, 2850, 1e-6);
  near(E.mm.sink_wall, (51 * 3150) / 100, 1e-6);
  assert.equal(E.mm.hood_cook, 0);
  const E2 = positionExpected('text_pct', { wall: { ...WALL, waterPct: 3 } });
  near(E2.pct.sink, (400 / 3150) * 100, 1e-9);
  const E3 = positionExpected('text_pct', { wall: { ...WALL, waterPct: 60, exhaustPct: 70 } });
  assert.equal(E3.hold.sink_wall, 'conflict');
  assert.equal(E3.hold.cook_wall, 'conflict');
});

// 합성 도면 (리포 시험용 — 고객 도면 아님)
const specA = () =>
  normalizeDesignSpec(
    {
      wallRunMm: 2200,
      layout: { shape: 'straight', walls: 1 },
      sections: {
        lower: { widthMm: 2200, depthMm: 650, fromLeftMm: 0, modules: [{ kind: 'door', widthMm: 800 }, { kind: 'door', widthMm: 600 }, { kind: 'drawer', widthMm: 800 }] },
        upper: { widthMm: 2200, depthMm: 350, fromLeftMm: 0, fromFloorMm: 1500, modules: [{ kind: 'door', widthMm: 800 }, { kind: 'appliance', label: '후드', widthMm: 600 }, { kind: 'door', widthMm: 800 }] },
      },
      appliances: [{ kind: 'sink', fromLeftMm: 1500, widthMm: 600 }],
    },
    'sink'
  );

test('플래너 정답: fromLeftMm 은 왼쪽 끝(싱크 중심 1800), H1 밑 쿡탑 = H1 중심, 후드 = H1, 깊이 비율', () => {
  const F = plannerPositionFrame(specA(), 'sink', { wallW: 3400, wallH: 2400, confidence: 'medium' });
  assert.deepEqual(F.run, [0, 2200]);
  assert.equal(F.anchor, 'left');
  assert.equal(F.runShort, true);
  assert.equal(F.sink.x, 1800);
  assert.equal(F.sink.alt, 1800, '걸린 모듈 L3 중심 1800');
  assert.deepEqual(F.cooktop, { x: 1100, alt: 1100, src: 'implied_h1' });
  assert.deepEqual(F.hood, { x: 1100, alt: 1100, src: 'h1' });
  near(F.depthRatio, 350 / 650, 1e-9);
  // 도면에 후드 가전이 있으면 가전 중심
  const s2 = specA();
  s2.appliances.push({ kind: 'hood', fromLeftMm: 800, widthMm: 600 });
  const F2 = plannerPositionFrame(s2, 'sink', { wallW: 3400, wallH: 2400, confidence: 'medium' });
  assert.equal(F2.hood.src, 'appliance');
  assert.equal(F2.hood.x, 1100);
});

test('플래너 정답: 키큰장 오른쪽 — 줄 오른끝 = 하부 구간 끝, tallSide right · 끝 냉장고 칸은 상판 밖 · 끊긴 줄은 런 틀 보류', () => {
  const s = normalizeDesignSpec(
    {
      wallRunMm: 3100,
      sections: {
        lower: { widthMm: 1800, depthMm: 550, fromLeftMm: 0, modules: [{ kind: 'door', widthMm: 900 }, { kind: 'door', widthMm: 900 }] },
        tall: { widthMm: 1300, heightMm: 2300, depthMm: 650, fromLeftMm: 1800, modules: [{ kind: 'door', widthMm: 600 }, { kind: 'appliance', label: '냉장고장', widthMm: 700 }] },
      },
      appliances: [{ kind: 'sink', fromLeftMm: 900, widthMm: 700 }],
    },
    'sink'
  );
  const F = plannerPositionFrame(s, 'sink', { wallW: 3200, wallH: 2400, confidence: 'medium' });
  assert.deepEqual(F.run, [0, 1800]);
  assert.equal(F.tallSide, 'right');
  // 하부 줄 끝의 냉장고 칸
  const s2 = normalizeDesignSpec(
    { sections: { lower: { widthMm: 3000, fromLeftMm: 0, modules: [{ kind: 'door', widthMm: 2200 }, { kind: 'appliance', label: '냉장고', widthMm: 800 }] } } },
    'sink'
  );
  assert.deepEqual(plannerPositionFrame(s2, 'sink', { wallW: 3600, wallH: 2400, confidence: 'medium' }).run, [0, 2200]);
  // 모듈 합이 구간보다 50 mm 넘게 짧다 (가운데가 끊긴 줄)
  const s3 = normalizeDesignSpec({ sections: { lower: { widthMm: 3000, fromLeftMm: 0, modules: [{ kind: 'door', widthMm: 1200 }, { kind: 'door', widthMm: 1200 }] } } }, 'sink');
  const F3 = plannerPositionFrame(s3, 'sink', { wallW: 3600, wallH: 2400, confidence: 'medium' });
  assert.equal(F3.run, null);
  assert.equal(F3.runHold, 'run_gap');
});

function cornerSpec(side, corner, extra = {}) {
  return normalizeDesignSpec(
    {
      wallRunMm: 2400,
      layout: { shape: 'corner', walls: 2 },
      sections: { lower: { widthMm: 2349, depthMm: 550, fromLeftMm: 50, modules: [{ kind: 'door', widthMm: 650 }, { kind: 'door', widthMm: 436 }, { kind: 'door', widthMm: 842 }, { kind: 'door', widthMm: 421 }] } },
      appliances: [{ kind: 'sink', fromLeftMm: 1300, widthMm: 700 }],
      walls: [{ side, corner, runMm: 1575, sections: { lower: { widthMm: 936, fromCornerMm: 639, ...extra, modules: [{ kind: 'door', widthMm: 936 }] } } }],
    },
    'sink'
  );
}

test('ㄱ자 walls[] 런 틀: corner main·return·open × 왼·오 (재생 프레임 [0, 2399] 과 같은 식)', () => {
  const W = { wallW: 2550, wallH: 2350, confidence: 'medium' };
  assert.deepEqual(plannerPositionFrame(cornerSpec('left', 'main'), 'sink', W).run, [0, 2399], '왼쪽 main — 상판은 모서리에서, 오른끝 = fromLeftMm + widthMm');
  assert.deepEqual(plannerPositionFrame(cornerSpec('left', 'return'), 'sink', W).run, [0, 2399]);
  assert.deepEqual(plannerPositionFrame(cornerSpec('left', 'open'), 'sink', W).run, [50, 2399], 'open — 하부 왼끝');
  assert.deepEqual(plannerPositionFrame(cornerSpec('right', 'main'), 'sink', W).run, [50, 2399]);
  assert.deepEqual(plannerPositionFrame(cornerSpec('right', 'return', { depthMm: 600 }), 'sink', W).run, [50, 2999], 'return — 꺾인 다리 깊이만큼');
  const noDepth = plannerPositionFrame(cornerSpec('right', 'return'), 'sink', W);
  assert.equal(noDepth.run, null);
  assert.equal(noDepth.runHold, 'corner_depth');
  assert.deepEqual(plannerPositionFrame(cornerSpec('right', 'open'), 'sink', W).run, [50, 2399]);
  // 앵커: 왼쪽 꺾임 → left, 오른쪽 main → right, 오른쪽 return·open → 없음 (buildPlannerPrompt runAnchor)
  assert.equal(plannerPositionFrame(cornerSpec('left', 'open'), 'sink', W).anchor, 'left');
  assert.equal(plannerPositionFrame(cornerSpec('right', 'main'), 'sink', W).anchor, 'right');
  assert.equal(plannerPositionFrame(cornerSpec('right', 'return', { depthMm: 600 }), 'sink', W).anchor, null);
  assert.equal(plannerPositionFrame(cornerSpec('left', 'main'), 'sink', W).multi, true);
});

test('정답 ↔ 프롬프트 대조: runShort 이면 줄 길이 고정 문장, 아니면 배율 문장 (규칙이 한쪽만 바뀌면 깨진다)', () => {
  const cases = [
    [specA(), { wallW: 3400, wallH: 2400, confidence: 'medium' }],
    [specA(), { wallW: 2100, wallH: 2400, confidence: 'medium' }], // 줄이 벽보다 길다
    [specA(), { wallW: 3000, wallH: 2400, confidence: null }], // 분석 실패 기본값
    [cornerSpec('left', 'main'), { wallW: 2550, wallH: 2350, confidence: 'medium' }],
    [cornerSpec('right', 'main'), { wallW: 2550, wallH: 2350, confidence: 'medium' }],
    [cornerSpec('right', 'open'), { wallW: 2550, wallH: 2350, confidence: 'medium' }],
    [{ ...specA(), layout: { shape: 'corner', walls: 2 } }, { wallW: 3400, wallH: 2400, confidence: 'medium' }], // 펼친 ㄱ자
  ];
  for (const [spec, wall] of cases) {
    const F = plannerPositionFrame(spec, 'sink', wall);
    const prompt = buildPlannerPrompt({ category: 'sink', designSpec: spec, ...wall });
    const fixed = /Do not stretch the units to fill the wall/.test(prompt);
    assert.equal(fixed, F.runShort, `runShort ${F.runShort} · wall ${wall.wallW}`);
    assert.equal(/Only the overall scale may change/.test(prompt), !F.runShort);
    if (F.runShort && F.anchor === 'right') assert.match(prompt, /counted from the right corner/);
  }
});

test('플래너 벽 정답: 오른쪽 앵커면 X = wallW − runMm + x, 벽 기준 σ 에 분석 wallW 흔들림(D·150/wallW)', () => {
  const W = { wallW: 2550, wallH: 2350, confidence: 'medium' };
  const E = positionExpected('planner_walls', { category: 'sink', options: { design_spec: cornerSpec('right', 'main') }, wall: W });
  assert.equal(E.mm.sink_wall, 2550 - 2400 + 1650);
  near(E.sw.sink_wall, ((2550 - E.mm.sink_wall) * 150) / 2550, 1e-9, '오른쪽 모서리부터 잰 거리');
  const El = positionExpected('planner', { category: 'sink', options: { design_spec: specA() }, wall: { wallW: 3400, wallH: 2400, confidence: 'medium' } });
  near(El.sw.sink_wall, (1800 * 150) / 3400, 1e-9);
  assert.equal(El.hold.sink_wall, undefined);
  const Es = positionExpected('planner', { category: 'sink', options: { design_spec: specA() }, wall: { wallW: 2100, wallH: 2400, confidence: 'medium' } });
  assert.equal(Es.hold.sink_wall, 'scale_free');
  const Eu = positionExpected('planner', { category: 'sink', options: { design_spec: specA() }, wall: { wallW: 3000, wallH: 2400, confidence: null } });
  assert.equal(Eu.hold.run_right_wall, 'wall_unknown');
});

test('도면 덩어리: 칠 틀은 카메라 span — 배율 s<1 이거나 프롬프트와 갈리면 벽 기준 보류 place_conflict', () => {
  const spec = specA();
  const pb = plannerPlaceBlocks({ ...spec, sections: { ...spec.sections, lower: { ...spec.sections.lower, heightMm: 870 } }, ceilingMm: 2400 });
  assert.ok(pb);
  const wall = { wallW: 3400, wallH: 2400, confidence: 'medium' };
  const input = (span) => ({ category: 'sink', options: { mode: 'planner', design_spec: spec }, wall, place: { cam: { xL: -500, xR: -500 + span } }, placeBlocks: pb });
  const E = positionExpected('planner_place', input(3300));
  assert.equal(E.frameW, 3300);
  assert.equal(E.place.s, 1);
  assert.equal(E.mm.run_right_wall, 2200);
  assert.equal(E.hold.run_right_wall, undefined, '프롬프트 2200/3400 vs 칠 2200/3300 — 끝 차 < 150 mm');
  const E2 = positionExpected('planner_place', input(2000)); // 런이 칠 벽보다 길다 → s = 0.909, 프롬프트는 줄 고정
  near(E2.place.s, 2000 / 2200, 1e-9);
  assert.equal(E2.hold.sink_wall, 'place_conflict');
  const E3 = positionExpected('planner_place', input(2600)); // 프롬프트 끝 2200/3400·2600 = 1682 vs 칠 2200
  assert.equal(E3.hold.run_right_wall, 'place_conflict');
  assert.deepEqual(E.run, [0, 2200], '런 틀은 배율과 무관');
});

/** 칠할 수 있는 ㄱ자 (높이·깊이·바닥 기준 있음) — 주벽 하부 fromLeftMm·widthMm, 꺾인 벽 하부 1200 (모서리에서 600) */
const placeCornerSpec = (side, corner, lower = { fromLeftMm: 0, widthMm: 2400 }) =>
  normalizeDesignSpec(
    {
      wallRunMm: 2400,
      ceilingMm: 2400,
      layout: { shape: 'corner', walls: 2 },
      sections: { lower: { ...lower, heightMm: 870, depthMm: 600, fromFloorMm: 0, modules: [{ kind: 'door', widthMm: lower.widthMm / 2 }, { kind: 'door', widthMm: lower.widthMm / 2 }] } },
      appliances: [{ kind: 'sink', fromLeftMm: 1500, widthMm: 600 }],
      walls: [{ side, corner, runMm: 1800, sections: { lower: { widthMm: 1200, heightMm: 870, depthMm: 600, fromCornerMm: 600, fromFloorMm: 0, modules: [{ kind: 'door', widthMm: 600 }, { kind: 'door', widthMm: 600 }] } } }],
    },
    'sink'
  );

test('도면 덩어리 ㄱ자(PLANNER_PLACE_CORNERS): 오른쪽 앵커면 X = span − (rightMm − x)·s, 왼쪽 꺾임 줄 왼끝은 모서리(0) · 벽 기준은 place_corner', () => {
  const wall = { wallW: 3000, wallH: 2400, confidence: 'medium' };
  const cam = { xL: -1500, xR: 1500 }; // span 3000
  // 오른쪽만 꺾이고 corner 'main' — 주벽 줄 오른끝이 오른쪽 벽 면
  const sr = placeCornerSpec('right', 'main');
  const pr = plannerPlaceBlocks(sr, { corners: true });
  assert.equal(pr.anchor, 'right');
  assert.equal(pr.rightMm, 2400);
  const inR = { category: 'sink', options: { mode: 'planner', design_spec: sr }, wall, place: { cam }, placeBlocks: pr };
  assert.equal(positionRoute(inR), 'planner_place');
  const Er = positionExpected('planner_place', inR);
  assert.equal(Er.anchor, 'right');
  assert.equal(Er.mm.sink_wall, 3000 - (2400 - 1800), '싱크 중심 1800 → 오른쪽 벽에서 600 안');
  assert.equal(Er.mm.run_left_wall, 600);
  assert.equal(Er.mm.run_right_wall, 3000);
  for (const k of ['sink_wall', 'run_left_wall', 'run_right_wall']) assert.equal(Er.hold[k], 'place_corner', k);
  assert.equal(Er.place.returns, 1);
  // 왼쪽 꺾임 corner 'return' — 꺾인 다리가 모서리를 차지해 주벽 하부는 600 부터, 상판은 모서리(0)에서
  const sl = placeCornerSpec('left', 'return', { fromLeftMm: 600, widthMm: 1800 });
  const pl = plannerPlaceBlocks(sl, { corners: true });
  assert.equal(pl.anchor, 'left');
  assert.equal(pl.blocks.find((b) => b.key === 'lower').x0, 600);
  const El = positionExpected('planner_place', { category: 'sink', options: { mode: 'planner', design_spec: sl }, wall, place: { cam }, placeBlocks: pl });
  assert.equal(El.mm.run_left_wall, 0, '런 틀(F.run) 그대로 — 칠한 하부 왼끝 600 이 아니다');
  assert.equal(El.mm.run_right_wall, 2400);
  assert.equal(El.anchor, 'left');
  assert.equal(El.hold.sink_wall, 'place_corner');
  // 일자는 꺾임 보류 없음
  const st = positionExpected('planner_place', { category: 'sink', options: { mode: 'planner', design_spec: specA() }, wall: { wallW: 3400, wallH: 2400, confidence: 'medium' }, place: { cam: { xL: -500, xR: 2800 } }, placeBlocks: plannerPlaceBlocks({ ...specA(), sections: { ...specA().sections, lower: { ...specA().sections.lower, heightMm: 870 } }, ceilingMm: 2400 }) });
  assert.equal(st.hold.sink_wall, undefined);
  assert.equal(st.place.returns, undefined);
});

test('도면 덩어리: 줄 끝은 런 틀 — 끝 냉장고 칸은 상판 밖(칠한 하부 끝이 아니다), 런 틀이 없으면 칠한 끝을 적되 그 사유로 보류', () => {
  const wall = { wallW: 3600, wallH: 2400, confidence: 'medium' };
  const fridge = normalizeDesignSpec(
    { wallRunMm: 3000, ceilingMm: 2400, sections: { lower: { widthMm: 3000, heightMm: 870, depthMm: 600, fromLeftMm: 0, fromFloorMm: 0, modules: [{ kind: 'door', widthMm: 2200 }, { kind: 'appliance', label: '냉장고', widthMm: 800 }] } } },
    'sink'
  );
  const pb = plannerPlaceBlocks(fridge);
  assert.equal(pb.blocks.find((b) => b.key === 'lower').x1, 3000);
  const E = positionExpected('planner_place', { category: 'sink', options: { mode: 'planner', design_spec: fridge }, wall, place: { cam: { xL: 0, xR: 3500 } }, placeBlocks: pb });
  assert.equal(E.mm.run_right_wall, 2200);
  assert.equal(E.hold.run_right_wall, undefined);
  const gap = normalizeDesignSpec(
    { wallRunMm: 3000, ceilingMm: 2400, sections: { lower: { widthMm: 3000, heightMm: 870, depthMm: 600, fromLeftMm: 0, fromFloorMm: 0, modules: [{ kind: 'door', widthMm: 1200 }, { kind: 'door', widthMm: 1200 }] } } },
    'sink'
  );
  const Eg = positionExpected('planner_place', { category: 'sink', options: { mode: 'planner', design_spec: gap }, wall, place: { cam: { xL: 0, xR: 3500 } }, placeBlocks: plannerPlaceBlocks(gap) });
  assert.equal(Eg.mm.run_right_wall, 3000);
  assert.equal(Eg.hold.run_right_wall, 'run_gap');
  assert.equal(Eg.hold.run_left_wall, 'run_gap');
});

test('플래너 정답 출처: 쿡탑은 pick 그대로(appliance) — design 으로 덮지 않는다 · 깊이 비율은 0.3~0.9 로 막는다', () => {
  const s = specA();
  s.appliances.push({ kind: 'cooktop', fromLeftMm: 800, widthMm: 600 });
  const F = plannerPositionFrame(s, 'sink', { wallW: 3400, wallH: 2400, confidence: 'medium' });
  assert.equal(F.cooktop.src, 'appliance');
  assert.equal(F.cooktop.x, 1100);
  const deep = specA();
  deep.sections.upper.depthMm = 700; // 상부가 하부(650)보다 깊다 → 비율 1.08 — 그대로 쓰면 투영이 발산한다
  const E = positionExpected('planner', { category: 'sink', options: { design_spec: deep }, wall: { wallW: 3400, wallH: 2400, confidence: 'medium' } });
  assert.equal(E.t, 0.9);
  const shallow = specA();
  shallow.sections.upper.depthMm = 100;
  assert.equal(positionExpected('planner', { category: 'sink', options: { design_spec: shallow }, wall: { wallW: 3400, wallH: 2400, confidence: 'medium' } }).t, 0.3);
});

test('세로 소실점의 가정 초점거리는 덩어리 합성과 같은 값 — EXIF → 렌즈 판정(광각 13·표준 24) → 24 (kitchen.js massingFocal)', () => {
  const w = { wallW: 3000, wallH: 2400, waterPct: 50, exhaustPct: 80, confidence: 'medium' };
  assert.equal(positionExpected('text_pct', { category: 'sink', options: {}, wall: w }).f35, 24);
  assert.equal(positionExpected('text_pct', { category: 'sink', options: { room_focal35: 28 }, wall: w }).f35, 28);
  assert.equal(positionExpected('text_pct', { category: 'sink', options: {}, wall: w, lens: 'ultra_wide' }).f35, 13);
  assert.equal(positionExpected('text_pct', { category: 'sink', options: { room_focal35: 28 }, wall: w, lens: 'ultra_wide' }).f35, 28, 'EXIF 가 먼저');
  assert.equal(positionExpected('text_pct', { category: 'sink', options: {}, wall: w, lens: 'ultra_wide' }).focalBasis, 'lens-ultra_wide');
  // 정면 장면: 가정 f 가 짧을수록(광각) 세로선이 더 모인다 — 같은 점에서 후드 보정량이 커진다
  const s = scene({ yawDeg: 0, pitchDeg: 10 });
  const E = { route: 'text_pct', frameW: 3000, mm: {}, hold: {}, alt: {}, sw: {}, t: 350 / 650 };
  const hood = (f35) => positionMeasure(derive(s.L, s.W, s.H, { f35 }), E).wall.hood;
  const flat = positionMeasure(derive(s.L, s.W, s.H, { vvH: null }), E).wall.hood;
  assert.ok(Math.abs(hood(13) - flat) > Math.abs(hood(24) - flat));
});

test('싱크대 덩어리: 마스크 순서(끝에서 cooktop·sink·counter-edge·counter-top)와 교차비 대조', () => {
  // kitchen.test.js 와 같은 가상 방에서 kitchenFaces → renderFacesMassing 의 마스크 모양 그대로
  const W = 800, H = 1000, f = 500, hf = 1500, Dw = 3500, t = (20 * Math.PI) / 180;
  const r1 = [Math.cos(t), 0, Math.sin(t)], r2 = [0, 1, 0], r3 = [-Math.sin(t), 0, Math.cos(t)];
  const proj = (X, h, z) => {
    const c = [0, 1, 2].map((i) => X * r1[i] + (hf - h) * r2[i] + (Dw - z) * r3[i]);
    return [(f * c[0]) / c[2] + W / 2, (f * c[1]) / c[2] + H / 2];
  };
  const pts = {
    backFloor: [proj(-600, 0, 0), proj(900, 0, 0)], backCeiling: [proj(-600, 2400, 0), proj(900, 2400, 0)],
    leftEnd: { floor: proj(-800, 0, 0), ceiling: proj(-800, 2400, 0), sideWall: false },
    rightEnd: { floor: proj(1200, 0, 0), ceiling: proj(1200, 2400, 0), sideWall: true },
    sideFloor: [proj(1200, 0, 0), proj(1200, 0, 1500)], sideCeiling: [proj(1200, 2400, 0), proj(1200, 2400, 1500)],
  };
  const n = (p) => ({ x: p[0] / W, y: p[1] / H });
  const g = {
    backFloor: pts.backFloor.map(n), backCeiling: pts.backCeiling.map(n),
    leftEnd: { floor: n(pts.leftEnd.floor), ceiling: n(pts.leftEnd.ceiling), sideWall: false },
    rightEnd: { floor: n(pts.rightEnd.floor), ceiling: n(pts.rightEnd.ceiling), sideWall: true },
    sideFloor: pts.sideFloor.map(n), sideCeiling: pts.sideCeiling.map(n),
  };
  const cam = solveKitchenCamera(g, W, H, { wallH: 2400 });
  assert.ok(cam);
  const faces = projectFaces(cam, kitchenFaces(cam, { waterPct: 50, exhaustPct: 80 }));
  const mask = faces.filter((fc) => fc.kind !== 'gap').map((fc) => fc.poly.map((p) => ({ x: p.x / W, y: p.y / H })));
  const kinds = faces.filter((fc) => fc.kind !== 'gap').map((fc) => fc.kind);
  assert.deepEqual(kinds.slice(-4), ['counter-top', 'counter-edge', 'sink', 'cooktop'], '순서가 바뀌면 position.js 의 at(-4)/(-2)/(-1) 을 고친다');
  const guide = { kind: 'kitchen', cam: { xL: cam.xL, xR: cam.xR }, mask };
  const E = positionExpected('mock_kitchen', { category: 'sink', options: {}, wall: { wallW: 3100, waterPct: 50, exhaustPct: 80 }, guide, mockVolume: true });
  const span = cam.xR - cam.xL;
  near(E.mm.sink_mask, span * 0.5, 1e-6);
  assert.equal(E.mm.run_right_mask, span);
  // 칠한 상판 뒷선 위 X = xL + 1000 의 이미지 x → 마스크 교차비로 1000 mm 를 되찾는다
  const q = cam.project(cam.xL + 1000, 880, 0);
  const M = positionMeasure({ u: 0, img: { WL: null, WR: null, CBL: (q.x / W) * 100, CBR: null, sink: (q.x / W) * 100, cookL: null, cookR: null, hoodL: null, hoodR: null } }, E);
  near(M.mm.sink_mask, 1000, 25, '마스크 교차비');
  const Es = positionExpected('mock_kitchen', { category: 'sink', options: { design_spec: specA() }, wall: { wallW: 3100, waterPct: 50, exhaustPct: 80 }, guide, mockVolume: true });
  assert.equal(Es.hold.sink_mask, 'spec_conflict');
  assert.equal(Es.hold.cook_mask, 'spec_conflict');
  assert.equal(Es.hold.run_left_mask, undefined);
  const bad = positionExpected('mock_kitchen', { category: 'sink', options: {}, wall: {}, guide: { kind: 'kitchen', cam: { xL: 0, xR: 3000 }, mask: [] }, mockVolume: true });
  assert.equal(bad.hold.sink_mask, 'no_mask');
  // 칠한 자리 그대로 (kitchenFaces 는 클램프하지 않는다) — 볼·쿡탑이 상판 끝을 넘게 칠해졌으면 mask_edge 보류
  const edge = positionExpected('mock_kitchen', { category: 'sink', options: {}, wall: { wallW: 3100, waterPct: 5, exhaustPct: 97 }, guide, mockVolume: true });
  near(edge.mm.sink_mask, span * 0.05, 1e-6, '클램프 없음');
  near(edge.mm.cook_mask, span * 0.97, 1e-6);
  assert.equal(edge.hold.sink_mask, 'mask_edge');
  assert.equal(edge.hold.cook_mask, 'mask_edge');
  const dflt = positionExpected('mock_kitchen', { category: 'sink', options: {}, wall: { wallW: 3100 }, guide, mockVolume: true });
  near(dflt.mm.sink_mask, span * 0.3, 1e-6, '분석 % 가 없으면 칠과 같은 30 · 70');
  near(dflt.mm.cook_mask, span * 0.7, 1e-6);
});

// ─────────────────────────── 5. 채점 ───────────────────────────

/** 가상 방 → 응답(전체·띠 같은 값) → 기록 */
function judge({ input, L, W = 1600, H = 1200, env = {}, zoom = true }) {
  const Lf = { ...L };
  const Lz = zoom ? { ...L } : null;
  return positionResult({ route: positionRoute(input), Lf, Lz, nz: zoom ? null : 'not_jpeg', W, H, input, env });
}

test('채점: 글 % — 맞으면 ok:true, 300 mm 넘으면 경보(경계 표시), 런 틀이 동의하면 frames 보류', () => {
  const s = scene({ yawDeg: 0 });
  const wall = { wallW: 3000, wallH: 2400, waterPct: 50, exhaustPct: (2500 / 3000) * 100, confidence: 'medium' };
  const okR = judge({ input: { category: 'sink', options: {}, wall }, L: s.L });
  assert.equal(okR.ok, true);
  assert.deepEqual(okR.alerts, []);
  assert.equal(okR.measured.gate.ok, true);
  // 싱크 지시가 400 mm 왼쪽 — 벽·런 둘 다 넘는다
  const far = judge({ input: { category: 'sink', options: {}, wall: { ...wall, waterPct: 50 - (400 / 3000) * 100 } }, L: s.L });
  assert.equal(far.ok, false);
  assert.equal(far.alerts.length, 1);
  assert.equal(far.alerts[0].k, 'sink_wall');
  near(far.alerts[0].d, 400, 3);
  assert.equal(far.alerts[0].thr, 300);
  assert.equal(typeof far.alerts[0].edge, 'boolean');
  near(far.alerts[0].pp, 13.3, 0.15);
  // 런(CBL~CBR)이 벽보다 짧아(냉장고 자리) 런 틀로는 지시와 맞다 → 보류 frames
  const short = { ...s.L, CBR: s.P(2000, 880, 0), CFR: s.P(2000, 880, 650) };
  const r = judge({ input: { category: 'sink', options: {}, wall: { ...wall, waterPct: 75, exhaustPct: 20 } }, L: { ...short, SINK_B: s.P(1500, 880, 100), K_BL: undefined, K_BR: undefined, K_FL: undefined, K_FR: undefined, HL: undefined, HR: undefined } });
  assert.equal(r.measured.hold.sink_wall, 'frames');
  assert.equal(r.ok, null);
});

test('채점: 문턱 경계값 — 정확히 300 이면 경보 아님, 넘으면 경보 · σ 가 문턱 절반을 넘으면 sd 보류', () => {
  const s = scene({ yawDeg: 0 });
  const base = { wallW: 3000, wallH: 2400, exhaustPct: (2500 / 3000) * 100, confidence: 'medium' };
  const at = judge({ input: { category: 'sink', options: {}, wall: { ...base, waterPct: 40 } }, L: s.L }); // 1500 − 1200 = 300
  const it = at.measured.mm.sink_wall - 1200;
  if (Math.abs(it) <= 300) assert.ok(!at.alerts.some((a) => a.k === 'sink_wall'));
  const over = judge({ input: { category: 'sink', options: {}, wall: { ...base, waterPct: 39.5 } }, L: s.L });
  assert.ok(over.alerts.some((a) => a.k === 'sink_wall'));
  // 후드−쿡탑 150 mm: 후드를 200 mm 옮긴다
  const L2 = { ...s.L, HL: s.P(2400, 1500, 350), HR: s.P(3000, 1500, 350) };
  const h = judge({ input: { category: 'sink', options: {}, wall: { ...base, waterPct: 50 } }, L: L2 });
  const a = h.alerts.find((x) => x.k === 'hood_cook');
  assert.ok(a, JSON.stringify(h.alerts));
  near(a.d, 200, 5);
  // 벽 끝 문 실패(유형 occluded) → 글 % 싱크·쿡탑은 wall_end 보류, 후드−쿡탑은 σ0 ×1.5 로 판정
  const occ = { ...s.L, WR: { ...s.L.WR, type: 'occluded', flag: 'occluded' } };
  const g = judge({ input: { category: 'sink', options: {}, wall: { ...base, waterPct: 50 } }, L: occ });
  assert.equal(g.measured.hold.sink_wall, 'wall_end');
  assert.equal(g.measured.hold.cook_wall, 'wall_end');
  assert.ok(g.measured.sd.hood_cook >= 60);
});

test('채점: 플래너 — 벽 틀이 판정하면 런 값은 기록만(wall_frame), 벽 틀 보류면 런 경보에 frame·cause:run_end', () => {
  // 도면: 런 2200, 싱크 1800 · 사진: 하부 줄을 3000 까지 늘렸는데 싱크는 벽 위 1800 그대로
  const s = scene({ yawDeg: 0 });
  const L = { ...s.L, K_BL: undefined, K_BR: undefined, K_FL: undefined, K_FR: undefined, HL: undefined, HR: undefined, SINK_B: s.P(1800, 880, 100) };
  const spec = normalizeDesignSpec(
    { wallRunMm: 2200, layout: { shape: 'straight', walls: 1 }, sections: { lower: { widthMm: 2200, fromLeftMm: 0, modules: [{ kind: 'door', widthMm: 1500 }, { kind: 'door', widthMm: 600 }, { kind: 'door', widthMm: 100 }] } }, appliances: [{ kind: 'sink', fromLeftMm: 1500, widthMm: 600 }] },
    'sink'
  );
  const wall = { wallW: 3000, wallH: 2400, confidence: 'medium' };
  const r = judge({ input: { category: 'sink', options: { mode: 'planner', design_spec: spec }, wall }, L });
  assert.equal(r.measured.hold.sink_run, 'wall_frame', '싱크는 벽 틀이 판정');
  assert.ok(!r.alerts.some((a) => a.k === 'sink_run'));
  assert.ok(r.alerts.some((a) => a.k === 'run_right_wall' && a.d > 700), JSON.stringify(r.alerts));
  // 벽 끝을 못 믿는 장(유형 occluded) — 벽 기준 보류, 런 틀의 싱크 경보(늘린 줄 탓)는 cause:run_end
  const occ = { ...L, WR: { ...L.WR, type: 'occluded', flag: 'occluded' } };
  const r2 = judge({ input: { category: 'sink', options: { mode: 'planner', design_spec: spec }, wall }, L: occ });
  assert.equal(r2.measured.hold.sink_wall, 'wall_end');
  const a = r2.alerts.find((x) => x.k === 'sink_run');
  assert.ok(a, JSON.stringify(r2));
  assert.equal(a.frame, 'run');
  assert.ok(a.d < 0, '런 틀에서는 왼쪽으로 옮겨진 것처럼 보인다');
  assert.equal(a.cause, 'run_end');
});

test('채점: 보류 사유 — 끝점 clipped·사진 끝, 꺾임 응답(layout), 아일랜드 위, bad_points, room_changed, 띠 없음', () => {
  const s = scene({ yawDeg: 0 });
  const spec = specA();
  const planner = (L, extra = {}) => judge({ input: { category: 'sink', options: { mode: 'planner', design_spec: spec }, wall: { wallW: 3000, wallH: 2400, confidence: 'medium' }, ...extra }, L });
  const clipped = planner({ ...s.L, CBR: { ...s.L.CBR, flag: 'clipped' } });
  assert.equal(clipped.measured.hold.sink_run, 'run_end_clipped');
  const edge = planner({ ...s.L, CBL: { ...s.L.CBL, x: 0.5 } });
  assert.equal(edge.measured.hold.sink_run, 'run_end_clipped');
  const folded = planner({ ...s.L, _layout: 'L_shape' });
  assert.ok(['layout', 'wall_frame'].includes(folded.measured.hold.sink_run));
  const badS = planner({ ...s.L, SINK_B: { x: null, y: null, flag: 'visible', bad: true } });
  assert.equal(badS.measured.hold.sink_run, 'bad_points');
  const room = planner(s.L, { qc: { ok: false, issues: ['room_changed'] } });
  assert.equal(room.measured.hold.sink_wall, 'room_changed');
  const noZ = judge({ input: { category: 'sink', options: {}, wall: { wallW: 3000, wallH: 2400, waterPct: 50, exhaustPct: 83, confidence: 'medium' } }, L: s.L, zoom: false });
  assert.equal(noZ.ok, null);
  assert.ok(Object.values(noZ.measured.hold).every((h) => h === 'no_zoom'));
  // 아일랜드: 싱크가 상판 앞선보다 앞(아래)에
  const isl = judge({ input: { category: 'island', options: {}, wall: { wallW: 3000, wallH: 2400, waterPct: 50, exhaustPct: 83, confidence: 'medium' } }, L: { ...s.L, SINK_B: { ...s.L.SINK_B, y: s.L.CFL.y + 8 } } });
  assert.equal(isl.measured.hold.sink_wall, 'on_island');
  // 주방 없음(풍경 사진) — 판정 없음, 오경보 0
  const none = judge({ input: { category: 'sink', options: {}, wall: {} }, L: { ...s.L, _kitchen: false } });
  assert.equal(none.ok, undefined);
  assert.equal(none.measured.nz, 'no_run');
});

test('채점: 경보를 켜지 않은 경로는 ok:null, 넘은 항목은 shadow 로만 (POSITION_ALARM_ROUTES)', () => {
  const s = scene({ yawDeg: 0 });
  const spec = cornerSpec('left', 'main');
  const r = judge({ input: { category: 'sink', options: { mode: 'planner', design_spec: spec }, wall: { wallW: 2550, wallH: 2350, confidence: 'medium' } }, L: s.L });
  assert.equal(r.ok, null);
  assert.deepEqual(r.alerts, []);
  assert.ok(Array.isArray(r.shadow) && r.shadow.length > 0, JSON.stringify(r.measured.hold));
  const on = judge({ input: { category: 'sink', options: { mode: 'planner', design_spec: spec }, wall: { wallW: 2550, wallH: 2350, confidence: 'medium' } }, L: s.L, env: { POSITION_ALARM_ROUTES: 'planner_walls' } });
  assert.equal(on.ok, false);
});

test('채점: 플래너 후드−쿡탑 — 런 틀 없이 벽 % × 벽 폭으로 재면 벽 끝 문 실패 때 σ0 ×1.5 (글 % 와 같은 보정)', () => {
  const s = scene({ yawDeg: 0 });
  const gap = normalizeDesignSpec(
    {
      wallRunMm: 3000,
      sections: {
        lower: { widthMm: 3000, depthMm: 650, fromLeftMm: 0, modules: [{ kind: 'door', widthMm: 1200 }, { kind: 'door', widthMm: 1200 }] }, // 끊긴 줄 → 런 틀 없음
        upper: { widthMm: 3000, depthMm: 350, fromLeftMm: 0, fromFloorMm: 1500, modules: [{ kind: 'door', widthMm: 2200 }, { kind: 'appliance', label: '후드', widthMm: 600 }, { kind: 'door', widthMm: 200 }] },
      },
      appliances: [{ kind: 'cooktop', fromLeftMm: 2200, widthMm: 600 }],
    },
    'sink'
  );
  const input = { category: 'sink', options: { mode: 'planner', design_spec: gap }, wall: { wallW: 3000, wallH: 2400, confidence: 'medium' } };
  const E = positionExpected('planner', input);
  assert.equal(E.run, null);
  assert.equal(E.mm.hood_cook, 0);
  const ok = judge({ input, L: s.L });
  const occ = judge({ input, L: { ...s.L, WR: { ...s.L.WR, type: 'occluded', flag: 'occluded' } } });
  assert.ok(ok.measured.sd.hood_cook < 55, `${ok.measured.sd.hood_cook}`);
  assert.ok(occ.measured.sd.hood_cook >= 60, `${occ.measured.sd.hood_cook}`);
});

test('벽 끝 문: 유형·flag·1.5 pp·키큰장 쪽 WR≈CBR', () => {
  const s = scene({ yawDeg: 0 });
  const D = derive(s.L, 1600, 1200);
  assert.deepEqual(wallGate(D, D, s.L, s.L, null), { ok: true, why: [] });
  const Dz = { ...D, img: { ...D.img, WL: D.img.WL + 2 } };
  assert.deepEqual(wallGate(D, Dz, s.L, s.L, null).why, ['WL_diff']);
  const Lz = { ...s.L, WR: { ...s.L.WR, flag: 'clipped' } };
  const Lf = { ...s.L, WR: { ...s.L.WR, type: 'out_of_frame', flag: 'clipped' } };
  assert.deepEqual(wallGate(D, D, Lz, Lf, null).why, ['WR_type'], '띠 밖이면 전체 응답의 유형');
  assert.deepEqual(wallGate(D, D, s.L, s.L, 'right').why, ['tall_R'], 'CBR = WR (벽 끝까지 간 줄) + 키큰장 오른쪽 = 키큰장 옆면을 벽 끝으로');
});

// ─────────────────────────── 6. 기록 ───────────────────────────

const walkNumbers = (o, fn) => {
  if (typeof o === 'number') fn(o);
  else if (o && typeof o === 'object') for (const v of Object.values(o)) walkNumbers(v, fn);
};

test('기록: 2 KB 이하, 경로·URL·키 없음, 숫자는 모두 유한, 넘치면 정한 순서로 뺀다', () => {
  const s = scene({ yawDeg: 18 });
  const r = judge({ input: { category: 'sink', options: { mode: 'planner', design_spec: specA() }, wall: { wallW: 3400, wallH: 2400, confidence: 'medium' } }, L: s.L });
  const rec = capRecord({ v: 1, route: 'planner', ...r, model: 'gemini-3.8-flash', calls: 2, ms: 12000, tokens: { in: 4800, out: 800 }, size: { b: [1600, 1200] } });
  const json = JSON.stringify(rec);
  assert.ok(json.length <= 2048, `${json.length}`);
  assert.ok(!/https?:|key=|\/storage\/|base64/i.test(json));
  walkNumbers(rec, (n) => assert.ok(Number.isFinite(n)));
  const big = capRecord({ v: 1, measured: { sd: { a: 'x'.repeat(900) }, wall_pct: { a: 'x'.repeat(900) }, img: { a: 'x'.repeat(900) }, types: { a: 'x'.repeat(900) } }, expected: { src: {} } });
  assert.ok(JSON.stringify(big).length <= 2048);
  assert.equal(big.measured.sd, undefined, 'σ 먼저');
  assert.equal(big.measured.wall_pct, undefined, '다음 벽·런 %');
  assert.ok(big.measured.img && big.measured.types, '필요한 만큼만 뺀다');
  assert.equal(big.cut, 2);
  // 가장 큰 기록 — 13 항목 모두 경보·보류·σ, 긴 사유와 경로 · 그래도 2 KB 안 (마지막 단계까지 가면 경보 {k, d} 와 머리만)
  const keys = Object.keys(POSITION_ITEMS);
  const all = (f) => Object.fromEntries(keys.map((k) => [k, f(k)]));
  const huge = {
    v: 2, route: 'planner_unfolded', ok: false,
    alerts: keys.map((k) => ({ k, d: -12345, thr: 300, sd: 149, edge: false, frame: 'run', cause: 'run_end', pp: -99.9 })),
    shadow: keys,
    measured: {
      kitchen: true, layout: 'straight', zoom: true, nz: 'parse_2', u: -12.3456, vz: [-123.4, 123.4], vz_drop: 'horizon', mask_wall: [-99.9, 99.9],
      img: { WL: 1.1, WR: 99.9, CBL: 1.1, CBR: 99.9, sink: 50.5, kl: 60.6, kr: 70.7, HL: 60.6, HR: 70.7, F: 50.5 },
      types: { WL: 'out_of_frame', WR: 'out_of_frame', hood: 'slim_concealed' },
      gate: { ok: false, why: ['WL_type', 'WL_diff', 'WR_type', 'WR_diff', 'tall_R'] },
      wall_pct: { runL: -10.1, runR: 110.1, sink: 50.5, cook: 60.6, hood: 70.7 }, run_pct: { sink: 50.5, cook: 60.6, hood: 70.7 },
      mm: all(() => -12345), sd: all(() => 12345), hold: all(() => 'run_end_clipped'),
    },
    expected: { wallW: 12345, wall_known: true, anchor: 'right', run: [12345, 12345], run_hold: 'corner_depth', span: 12345, s: 0.123, returns: 2, mm: all(() => 12345), src: { sink: 'appliance', cook: 'implied_h1', hood: 'appliance' } },
    model: 'gemini-3.8-flash', calls: 4, ms: 75000, ms_decode: 733, zoom_px: [3072, 1575], tokens: { in: 99999, out: 99999 }, size: { b: [4096, 4096], r: [4096, 4096] }, provider: 'gemini', error: 'skipped_overload',
  };
  const capped = capRecord(JSON.parse(JSON.stringify(huge)));
  assert.ok(JSON.stringify(capped).length <= 2048, `${JSON.stringify(capped).length}`);
  assert.equal(capped.alerts.length, keys.length, '경보 항목은 남는다');
  assert.ok(capped.alerts.every((a) => a.k && a.d === -12345));
  assert.equal(capped.route, 'planner_unfolded');
  assert.equal(capped.error, 'skipped_overload');
});

// ─────────────────────────── 7. 실행 (목 Gemini) — 실패해도 조용히 ───────────────────────────

const ERROR_CODES = ['timeout_1', 'timeout_2', 'http_429', 'http_5xx', 'http_4xx', 'net_1', 'net_2', 'parse_1', 'parse_2', 'decode', 'budget', 'internal', 'no_image', 'timeout', 'skipped_overload', 'rerun'];

function mockFlash(respond) {
  const calls = [];
  const fn = async (env, p) => {
    calls.push(p);
    return respond(p, calls.length);
  };
  fn.calls = calls;
  return fn;
}

const textInput = (base, extra = {}) => ({
  category: 'sink',
  base,
  wall: { wallW: 3000, wallH: 2400, waterPct: 50, exhaustPct: 83.3, confidence: 'medium' },
  options: {},
  ...extra,
});

test('실행: 전체 1회 + 띠 1회 — 같은 질의(띠 문장만 더), 응답 스키마·thinking low·HIGH·temperature 없음·재시도 끔', async () => {
  const s = scene({ yawDeg: 10, W: 800, H: 600 });
  const base = jpegOf(800, 600);
  const flash = mockFlash(respond2(s.L, 800, 600));
  const rec = await runPositionCheck({}, textInput(base), { callGemini: flash });
  assert.equal(flash.calls.length, 2);
  const [c1, c2] = flash.calls;
  assert.equal(c1.prompt, buildPositionPrompt());
  assert.equal(c2.prompt, buildPositionPrompt({ zoom: true }));
  assert.equal(c1.images[0].base64, base.base64, '1차는 기본안 그대로');
  assert.equal(c2.images[0].mimeType, 'image/jpeg', '띠는 JPEG');
  assert.notEqual(c2.images[0].base64, base.base64);
  for (const c of flash.calls) {
    assert.equal(c.model, 'gemini-3.8-flash');
    assert.equal(c.want, 'text');
    assert.deepEqual(c.retryDelaysMs, []);
    assert.equal(c.noTemperature, true);
    assert.equal(c.extraConfig.responseMimeType, 'application/json');
    assert.deepEqual(c.extraConfig.responseSchema, POSITION_SCHEMA);
    assert.equal(c.extraConfig.mediaResolution, 'MEDIA_RESOLUTION_HIGH');
    assert.deepEqual(c.extraConfig.thinkingConfig, { thinkingLevel: 'low' });
    assert.ok(c.signal instanceof AbortSignal);
    assert.equal(c.withMeta, true);
  }
  assert.equal(rec.v, 2);
  assert.equal(rec.route, 'text_pct');
  assert.equal(rec.calls, 2);
  assert.equal(rec.measured.zoom, true);
  assert.deepEqual(rec.tokens, { in: 4600, out: 800 });
  assert.ok(rec.ms_decode >= 0);
  assert.deepEqual(rec.size, { b: [800, 600] });
  assert.equal(rec.provider, undefined);
  assert.equal(rec.ok, true, JSON.stringify(rec.measured.hold));
  assert.equal(rec.measured.gate.ok, true);
  near(rec.measured.wall_pct.sink, 50, 0.3, '띠 값으로 다시 잰 싱크');
  assert.ok(JSON.stringify(rec).length <= 2048);
});

test('실행: 깨진 JSON → parse_1 · 띠 응답 깨짐 → parse_2(측정만) · 400 → 재시도 없이 http_4xx', async () => {
  const base = jpegOf(400, 300);
  const r1 = await runPositionCheck({}, textInput(base), { callGemini: mockFlash(() => ({ text: '{"kitchen_installed": tru' })) });
  assert.equal(r1.error, 'parse_1');
  assert.equal(r1.ok, null);
  assert.equal(r1.calls, 1);
  const s = scene({ W: 400, H: 300 });
  const r2 = await runPositionCheck({}, textInput(base), { callGemini: mockFlash((p, n) => ({ text: n === 1 ? JSON.stringify(asResponse(s.L)) : 'oops' })) });
  assert.equal(r2.error, 'parse_2');
  assert.equal(r2.measured.nz, 'parse_2');
  assert.equal(r2.ok, null);
  const f400 = mockFlash(() => {
    throw Object.assign(new Error('Gemini 400: bad'), { status: 400, retryable: false });
  });
  const r3 = await runPositionCheck({}, textInput(base), { callGemini: f400 });
  assert.equal(r3.error, 'http_4xx');
  assert.equal(f400.calls.length, 1);
  for (const r of [r1, r2, r3]) assert.ok(ERROR_CODES.includes(r.error));
});

test('실행: 과부하(429)는 5초 뒤 1회만 — 남은 예산이 35초 미만이면 재시도하지 않는다', async () => {
  const base = jpegOf(400, 300);
  const s = scene({ W: 400, H: 300 });
  const waits = [];
  const sleep = async (ms) => void waits.push(ms);
  const f = mockFlash((p, n) => {
    if (n === 1) throw Object.assign(new Error('Gemini 429'), { status: 429, retryable: true, retryAfterMs: 60_000 });
    return { text: JSON.stringify(asResponse(s.L)) };
  });
  const r = await runPositionCheck({}, textInput(base), { callGemini: f, sleep });
  assert.deepEqual(waits, [5000], 'Retry-After 60 초를 따르지 않는다');
  assert.equal(r.calls, 3);
  assert.equal(r.error, undefined);
  // 예산이 모자라면 재시도 없이 코드만
  let t = 0;
  const now = () => t;
  const g = mockFlash(() => {
    t += 45_000; // 첫 호출이 45초 걸리고 503
    throw Object.assign(new Error('Gemini 503'), { status: 503, retryable: true });
  });
  const r2 = await runPositionCheck({}, textInput(base), { callGemini: g, sleep, now });
  assert.equal(g.calls.length, 1);
  assert.equal(r2.error, 'http_5xx');
});

test('실행: 같은 모델이 최근 과부하(429·5xx)면 보내지 않는다 — 시작 전이면 skipped_overload(호출 0), 1차 뒤면 띠 생략(overload)', async () => {
  const s = scene({ W: 400, H: 300 });
  const base = jpegOf(400, 300);
  const f = mockFlash(respond2(s.L, 400, 300));
  const r = await runPositionCheck({}, textInput(base), { callGemini: f, overloadAt: () => Date.now() - 1000 });
  assert.equal(r.error, 'skipped_overload');
  assert.equal(r.calls, 0);
  assert.equal(f.calls.length, 0);
  assert.ok(r.expected && r.expected.mm, '정답은 남긴다');
  // 2분이 지난 과부하는 보지 않는다
  const old = await runPositionCheck({}, textInput(base), { callGemini: mockFlash(respond2(s.L, 400, 300)), overloadAt: () => Date.now() - 130_000 });
  assert.equal(old.calls, 2);
  // 1차 사이에 과부하가 났다 (다른 잡의 QC 등) — 띠는 보내지 않고 1차 값만 (측정만)
  let at = 0;
  const g = mockFlash((p) => {
    at = Date.now();
    return respond2(s.L, 400, 300)(p);
  });
  const r2 = await runPositionCheck({}, textInput(base), { callGemini: g, overloadAt: () => at });
  assert.equal(g.calls.length, 1);
  assert.equal(r2.measured.nz, 'overload');
  assert.equal(r2.ok, null);
  assert.ok(ERROR_CODES.includes('skipped_overload'));
});

test('positionSkipped: 재실행 기록 — 게이트 켬·주방이면 {error, calls 0}, 아니면 null', () => {
  const input = textInput(jpegOf(40, 30));
  assert.equal(positionSkipped({}, input, 'rerun'), null);
  assert.equal(positionSkipped({ POSITION_QC: 'on' }, { ...input, category: 'wardrobe' }, 'rerun'), null);
  const r = positionSkipped({ POSITION_QC: 'on' }, input, 'rerun');
  assert.deepEqual({ route: r.route, ok: r.ok, alerts: r.alerts, calls: r.calls, error: r.error, v: r.v }, { route: 'text_pct', ok: null, alerts: [], calls: 0, error: 'rerun', v: 2 });
});

test('실행: 시간 초과(응답 없음)도 예산 안에서 timeout_1 로 풀린다', async () => {
  const base = jpegOf(200, 150);
  const hang = mockFlash(() => new Promise(() => {}));
  const t0 = Date.now();
  const r = await runPositionCheck({}, textInput(base), { callGemini: hang, timing: { total: 1500, call: 200, minLeft: 10_000 } });
  assert.equal(r.error, 'timeout_1');
  assert.ok(Date.now() - t0 < 2000);
});

test('실행: PNG 기본안은 1차만(no_zoom) · 6 MP 넘으면 띠 생략 · 주방 아님은 null · 목이 동기로 던져도 기록', async () => {
  const s = scene({ W: 400, H: 300 });
  // 1×1 PNG 머리 (가로 400 · 세로 300 으로 고친 IHDR)
  const png = Buffer.from('89504E470D0A1A0A0000000D49484452000001900000012C0806000000', 'hex');
  const pngBase = { base64: Buffer.concat([png, Buffer.alloc(40)]).toString('base64'), mimeType: 'image/png' };
  const f = mockFlash(() => ({ text: JSON.stringify(asResponse(s.L)) }));
  const r = await runPositionCheck({}, textInput(pngBase), { callGemini: f });
  assert.equal(f.calls.length, 1);
  assert.equal(r.measured.nz, 'not_jpeg');
  assert.equal(r.ok, null);
  const g = mockFlash(() => ({ text: JSON.stringify(asResponse(s.L)) }));
  const big = await runPositionCheck({}, textInput(jpegOf(400, 300)), { callGemini: g, zoom: { maxDecodePx: 1000 } });
  assert.equal(big.measured.nz, 'big');
  assert.equal(await runPositionCheck({}, { ...textInput(jpegOf(40, 30)), category: 'wardrobe' }, { callGemini: f }), null);
  const thrower = () => {
    throw new Error('boom');
  };
  const r4 = await runPositionCheck({}, textInput(jpegOf(40, 30)), { callGemini: thrower });
  assert.ok(ERROR_CODES.includes(r4.error), r4.error);
  const r5 = await runPositionCheck({}, { ...textInput({ base64: 'QUJD', mimeType: 'image/jpeg' }) }, { callGemini: f });
  assert.equal(r5.error, 'decode');
});

test('startPositionCheck: 게이트 꺼짐·주방 아님이면 null, attachTo·wait 는 reject 없이 기록을 단다', async () => {
  const base = jpegOf(200, 150);
  const s = scene({ W: 200, H: 150 });
  assert.equal(startPositionCheck({}, textInput(base)), null);
  assert.equal(startPositionCheck({ POSITION_QC: 'off' }, textInput(base)), null);
  assert.equal(startPositionCheck({ POSITION_QC: 'on' }, { ...textInput(base), category: 'wardrobe' }), null);
  let release;
  const gate = new Promise((r) => (release = r));
  const f = mockFlash(async (p) => {
    await gate;
    return respond2(s.L, 200, 150)(p);
  });
  const pos = startPositionCheck({ POSITION_QC: 'on' }, textInput(base), { callGemini: f });
  const slot = { label: 'base' };
  pos.attachTo(slot);
  assert.equal(pos.done, false);
  assert.equal(await pos.wait(20), false, '아직');
  release();
  assert.equal(await pos.wait(5000), true);
  assert.equal(pos.done, true);
  assert.equal(slot.position.route, 'text_pct');
  // 이미 끝난 뒤에 붙여도 단다
  const slot2 = {};
  pos.attachTo(slot2);
  assert.equal(slot2.position, slot.position);
  // 안전장치: 내부 예산을 무시하고 매달려도 예산 + 여유에 timeout 기록
  const hang = startPositionCheck({ POSITION_QC: 'on' }, textInput(base), { callGemini: () => new Promise(() => {}), timing: { total: 1200, call: 200, hardExtra: 50 } });
  assert.equal(await hang.wait(3000), true);
  assert.ok(['timeout_1', 'timeout'].includes(hang.result.error), hang.result.error);
});

// ─────────────────────────── 8. callGemini 선택 인자 (실제 함수, fetch 목) ───────────────────────────

let realFetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});
const gjson = (body, init = {}) => new Response(JSON.stringify(body), { status: init.status || 200, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } });

test('callGemini: 새 인자를 안 주면 generationConfig 는 예전 그대로 (temperature 0.2·이미지 설정)', async () => {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push(JSON.parse(init.body));
    return gjson({ candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] });
  };
  const r = await callGemini({ GEMINI_API_KEY: 'k' }, { prompt: 'p', want: 'text' });
  assert.deepEqual(seen[0].generationConfig, { responseModalities: ['TEXT'], temperature: 0.2 });
  assert.equal(r.text, 'b', '마지막 글 파트 (예전 그대로)');
  assert.equal(r.meta, undefined);
  await callGemini({ GEMINI_API_KEY: 'k' }, { prompt: 'p', imageSize: '2K', aspectRatio: '4:3' });
  assert.deepEqual(seen[1].generationConfig, { responseModalities: ['IMAGE', 'TEXT'], temperature: 0.4, imageConfig: { imageSize: '2K', aspectRatio: '4:3' } });
});

test('callGemini: 위치 검사 인자 — temperature 없음·스키마·thinking, 글 파트 이어 붙임(thought 제외)·usage', async () => {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ body: JSON.parse(init.body), signal: init.signal });
    return gjson({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'thinking', thought: true }, { text: '{"a":' }, { text: '1}' }] } }], usageMetadata: { promptTokenCount: 10 } });
  };
  const signal = AbortSignal.timeout(5000);
  const r = await callGemini({ GEMINI_API_KEY: 'k' }, {
    prompt: 'p', want: 'text', noTemperature: true, signal, withMeta: true, retryDelaysMs: [],
    extraConfig: { responseMimeType: 'application/json', responseSchema: { type: 'OBJECT' }, thinkingConfig: { thinkingLevel: 'low' }, mediaResolution: 'MEDIA_RESOLUTION_HIGH' },
  });
  assert.deepEqual(seen[0].body.generationConfig, {
    responseModalities: ['TEXT'], responseMimeType: 'application/json', responseSchema: { type: 'OBJECT' }, thinkingConfig: { thinkingLevel: 'low' }, mediaResolution: 'MEDIA_RESOLUTION_HIGH',
  });
  assert.equal(seen[0].signal, signal);
  assert.equal(r.text, '{"a":1}');
  assert.deepEqual(r.meta, { usage: { promptTokenCount: 10 }, finish: 'STOP' });
});

test('callGemini: 429 + Retry-After 60 을 retryDelaysMs:[] 로 부르면 기다리지 않고 바로 던진다 · 지역 차단 경로 전환도 같은 신호', async () => {
  globalThis.fetch = async () => gjson({ error: 'busy' }, { status: 429, headers: { 'Retry-After': '60' } });
  const t0 = Date.now();
  // 다른 모델 이름 — 과부하 기록(geminiOverloadAt)은 모델별이라 아래 잡 시험의 Flash 위치 검사를 막지 않는다
  await assert.rejects(callGemini({ GEMINI_API_KEY: 'k' }, { prompt: 'p', want: 'text', model: 'overload-test-model', retryDelaysMs: [] }), (e) => e.status === 429 && e.retryable === true);
  assert.ok(Date.now() - t0 < 1000);
  assert.ok(Date.now() - geminiOverloadAt('overload-test-model') < 5000, '과부하 시각을 모델별로 남긴다');
  assert.equal(geminiOverloadAt('gemini-3.8-flash-never-called'), 0);
  // gateway 가 지역 차단 → direct 로 넘어갈 때 두 요청 모두 호출자 신호 하나
  const signals = [];
  globalThis.fetch = async (url, init) => {
    signals.push(init.signal);
    if (String(url).includes('gateway.example')) return new Response('User location is not supported for the API use.', { status: 400 });
    return gjson({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
  };
  const signal = AbortSignal.timeout(5000);
  const r = await callGemini({ GEMINI_API_KEY: 'k', AI_GATEWAY_BASE: 'https://gateway.example/v1/x' }, { prompt: 'p', want: 'text', signal, retryDelaysMs: [] });
  assert.equal(r.text, 'ok');
  assert.equal(signals.length, 2, 'gateway(차단) → direct 전환이 실제로 일어났다');
  for (const s of signals) assert.equal(s, signal);
});

test('기존 호출부는 새 인자를 쓰지 않는다 — temperature:null·noTemperature·extraConfig 는 position.js 에만', () => {
  for (const f of ['job.js', 'worker.js', 'images.js', 'guide.js', 'kitchen.js', 'layout.js', 'verify.js']) {
    const src = SRC(f);
    assert.ok(!/temperature:\s*null/.test(src), f);
    assert.ok(!/noTemperature|extraConfig|withMeta/.test(src), f);
  }
  assert.match(SRC('position.js'), /noTemperature: true/);
});

// ─────────────────────────── 9. 호출 위치 (정적) ───────────────────────────

test('job.js: 위치 검사는 QC·재시도 결정 뒤, 기본안 업로드 전에 시작하고 추천안 단계에는 없다', () => {
  const src = SRC('job.js');
  assert.match(src, /^import \{ positionSkipped, startPositionCheck \} from '\.\/position\.js';$/m);
  const qcAt = src.indexOf('qcNeedsRetry(qc)');
  const startAt = src.indexOf('pos = startPositionCheck(env, positionInput(qc');
  const uploadAt = src.indexOf('`${prefix}/base.${extOf(base.mimeType)}`');
  const variantsAt = src.indexOf('═══ 4. 변형 3장 병렬');
  assert.ok(qcAt > 0 && startAt > qcAt, 'QC 다음');
  assert.ok(uploadAt > startAt, '업로드 전');
  assert.ok(variantsAt > startAt);
  assert.equal(src.slice(variantsAt).indexOf('startPositionCheck'), -1, '추천안에는 없다');
  assert.ok(src.indexOf('pos.attachTo(ck.images.base)') > uploadAt);
  // 마무리: done 패치 바로 앞에서 늦음을 재고, 늦은 패치는 images 하나뿐
  const late = src.indexOf('const posLate = !!pos && !pos.done;');
  const done = src.indexOf("status: 'done',", late);
  const between = src.slice(src.indexOf('\n', late) + 1, done).trim();
  assert.ok(late > 0 && done > late);
  assert.equal(between, "await updateById(env, 'generations', job.id, {", '사이에 다른 await 없음 — 패치 객체는 posLate 직후 동기로 만들어진다');
  assert.match(src, /updateById\(env, 'generations', job\.id, \{ images: slotList\(ck\.images\) \}\)/);
  // done 뒤 늦은 기록을 기다리다 리셋되면 alarm() 이 attempt 를 올리고 검사(fail)하기 전에 끝낸다
  const alarmSrc = src.slice(src.indexOf('async alarm()'), src.indexOf('async fail('));
  assert.ok(alarmSrc.indexOf('if (ck.doneAt) {') > 0 && alarmSrc.indexOf('if (ck.doneAt) {') < alarmSrc.indexOf('ck.attempt += 1;'));
  assert.ok(!src.includes('startPositionCheck(env, positionInput(ck.images.base.qc'), '재실행은 다시 재지 않는다');
  // 기존 시험 모양: import 문은 ';' + 줄바꿈 (loadEsm 이 지운다)
  assert.ok(!/startPositionCheck\(/.test(src.slice(0, src.indexOf('async function runPipeline'))));
});

// ─────────────────────────── 10. 잡 (게이트 켬) ───────────────────────────

const ROW_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ENV = { GEMINI_API_KEY: 'test-key', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', GENERATIONS_BUCKET: 'generations' };

function installJob({ positionDelayMs = 0, positionStatus = 200, qcIssues = [], qcStatus = 200, failFirstQuote = false, bases }) {
  const calls = { patched: [], position: [], images: 0, qc: 0 };
  const s = scene({ W: 320, H: 240, yawDeg: 6 });
  let quoteFailed = false;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/storage/v1/object/')) {
      if ((init.method || 'GET') === 'POST') return gjson({ Key: 'ok' });
      // 재실행이 내려받는 기본안은 진짜 JPEG (그 밖은 방 사진 — 내용은 쓰지 않는다)
      if (u.includes('/base.')) return new Response(Buffer.from(bases[0].base64, 'base64'), { headers: { 'Content-Type': 'image/jpeg' } });
      return new Response(Buffer.from('ROOM'), { headers: { 'Content-Type': 'image/jpeg' } });
    }
    if (u.includes('/rest/v1/generations')) {
      if ((init.method || 'GET') === 'GET') return gjson([{ id: ROW_ID, options: {} }]);
      const body = JSON.parse(init.body);
      if (failFirstQuote && body.quote && !quoteFailed) {
        quoteFailed = true; // 기본안 직후 패치가 한 번 실패 → 잡 재시도 (알람 재실행)
        return gjson({ message: 'boom' }, { status: 500 });
      }
      calls.patched.push(body);
      return gjson([{ id: ROW_ID }]);
    }
    if (u.includes('generativelanguage.googleapis.com')) {
      const body = JSON.parse(init.body);
      const parts = body.contents[0].parts;
      const prompt = parts[parts.length - 1].text;
      if (body.generationConfig.responseModalities.length === 1) {
        if (prompt.startsWith('TASK: mark precise geometric landmarks')) {
          calls.position.push({ prompt, image: parts[0].inlineData, config: body.generationConfig });
          if (positionDelayMs) await new Promise((r) => setTimeout(r, positionDelayMs));
          if (positionStatus !== 200) return gjson({ error: 'x' }, { status: positionStatus });
          const resp = /ZOOMED CROP/.test(prompt) ? asZoomResponse(s.L, 320, 240) : asResponse(s.L);
          return gjson({ candidates: [{ content: { parts: [{ text: JSON.stringify(resp) }] } }], usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 300 } });
        }
        if (!prompt.startsWith('Measure and describe')) {
          calls.qc++;
          if (qcStatus !== 200) return gjson({ error: 'busy' }, { status: qcStatus });
        }
        const text = prompt.startsWith('Measure and describe')
          ? JSON.stringify({ wall_width_mm: 3000, wall_height_mm: 2400, confidence: 'medium', site_condition: 'finished' })
          : JSON.stringify({ ok: qcIssues.length === 0, issues: qcIssues, note: 'n' });
        return gjson({ candidates: [{ content: { parts: [{ text }] } }] });
      }
      const img = bases[Math.min(calls.images, bases.length - 1)];
      calls.images++;
      return gjson({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: img.base64 } }] } }] });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  return calls;
}

function fakeState() {
  const m = new Map();
  return {
    storage: {
      get: async (k) => m.get(k),
      put: async (k, v) => void m.set(k, structuredClone(v)),
      setAlarm: async () => {},
      deleteAll: async () => m.clear(),
      deleteAlarm: async () => {},
    },
    m,
  };
}

async function runJob(env, category = 'sink', options = { variants: false }) {
  const job = new GenerateJob(fakeState(), { ...JOB_ENV, ...env });
  await job.fetch(
    new Request('https://generate-job/start', {
      method: 'POST',
      body: JSON.stringify({
        id: ROW_ID, userId: USER_ID, creditRef: 'c', category, options,
        inputs: { room: { path: `${USER_ID}/${ROW_ID}/room.jpg`, url: 'u', mime: 'image/jpeg' }, refs: [] }, startedAt: Date.now(),
      }),
    })
  );
  await job.alarm();
}

const flow = (patched) =>
  patched.map((p) => {
    const o = { ...p };
    delete o.elapsed_ms;
    delete o.completed_at;
    if (o.images) o.images = o.images.map((im) => { const c = { ...im }; delete c.position; return c; });
    if (o.wall_analysis) o.wall_analysis = '…';
    return o;
  });

test('잡: 게이트 켬 — images[base].position 이 기록되고, 상태·단계·진행률·크레딧 패치는 게이트 끈 잡과 같다', async () => {
  const bases = [jpegOf(320, 240, 1)];
  const off = installJob({ bases });
  await runJob({});
  assert.equal(off.position.length, 0, '게이트 꺼짐 — 호출 0');
  const on = installJob({ bases });
  await runJob({ POSITION_QC: 'on' });
  assert.equal(on.position.length, 2);
  assert.deepEqual(on.position[1].image.mimeType, 'image/jpeg');
  assert.equal(on.position[0].config.temperature, undefined);
  const withPos = on.patched.filter((p) => p.images && p.images[0] && p.images[0].position);
  assert.ok(withPos.length >= 1, '기록이 실린 패치');
  const pos = withPos[withPos.length - 1].images[0].position;
  assert.equal(pos.route, 'text_pct');
  assert.equal(pos.calls, 2);
  assert.ok(!('position' in (pos.measured || {})));
  // 늦은 패치가 생기면 images 만 — 그것을 빼면 흐름이 같다
  const onFlow = flow(on.patched).filter((p, i) => !(i === on.patched.length - 1 && Object.keys(on.patched[i]).length === 1 && on.patched[i].images));
  assert.deepEqual(onFlow, flow(off.patched));
  const doneOn = on.patched.filter((p) => p.status === 'done');
  assert.equal(doneOn.length, 1, 'done 패치는 하나');
});

test('잡: 위치 검사가 done 보다 늦으면 done 뒤에 images 만 담은 패치 한 번 (status·step_label 없음)', async () => {
  const calls = installJob({ bases: [jpegOf(320, 240, 2)], positionDelayMs: 150 });
  await runJob({ POSITION_QC: 'on' });
  const doneIdx = calls.patched.findIndex((p) => p.status === 'done');
  assert.ok(doneIdx >= 0);
  assert.ok(!calls.patched[doneIdx].images[0].position, 'done 때는 아직');
  const last = calls.patched[calls.patched.length - 1];
  assert.deepEqual(Object.keys(last), ['images']);
  assert.equal(last.images[0].position.route, 'text_pct');
  assert.equal(calls.patched.length, doneIdx + 2);
});

test('잡: 위치 검사가 HTTP 오류여도 생성은 done — position.error 만', async () => {
  const calls = installJob({ bases: [jpegOf(320, 240, 3)], positionStatus: 400 });
  await runJob({ POSITION_QC: 'on' });
  const done = calls.patched.find((p) => p.status === 'done');
  assert.ok(done);
  const rec = calls.patched.filter((p) => p.images && p.images[0].position).pop().images[0].position;
  assert.equal(rec.error, 'http_4xx');
  assert.equal(rec.ok, null);
  assert.equal(calls.position.length, 1, '4xx 는 재시도하지 않는다');
});

test('잡: QC 재시도로 기본안이 바뀌면 위치 검사는 두 번째(최종) 기본안을 잰다', async () => {
  const first = jpegOf(320, 240, 4);
  const second = jpegOf(320, 240, 5);
  const calls = installJob({ bases: [first, second], qcIssues: ['handles'] });
  await runJob({ POSITION_QC: 'on' });
  assert.equal(calls.images, 2);
  assert.equal(calls.position[0].image.data, second.base64);
});

test('잡: 주방이 아닌 품목(붙박이장)은 위치 호출 0 · position 키 없음', async () => {
  const calls = installJob({ bases: [jpegOf(320, 240, 6)] });
  await runJob({ POSITION_QC: 'on' }, 'wardrobe');
  assert.equal(calls.position.length, 0);
  for (const p of calls.patched) if (p.images) for (const im of p.images) assert.ok(!('position' in im));
});

test('잡(추천안 있음): 위치 검사는 추천안 단계와 겹쳐 돌고, 추천안이 있어도 호출은 2회 · done 패치는 하나 · 기록이 실린다', async () => {
  const calls = installJob({ bases: [jpegOf(320, 240, 12)], positionDelayMs: 30 });
  await runJob({ POSITION_QC: 'on', GEMINI_RETRY_DELAYS_MS: '0' }, 'sink', { variants: true });
  assert.ok(calls.images >= 2, `기본안 + 추천안 그림 ${calls.images}`);
  assert.equal(calls.position.length, 2, '추천안에는 위치 호출이 없다');
  assert.equal(calls.patched.filter((p) => p.status === 'done').length, 1);
  const withPos = calls.patched.filter((p) => p.images && p.images.find((im) => im.position));
  assert.ok(withPos.length >= 1);
  const slots = withPos[withPos.length - 1].images.filter((im) => im.position);
  assert.equal(slots.length, 1, 'base 칸에만');
  assert.equal(slots[0].position.route, 'text_pct');
});

test('잡: 알람 재실행(기본안 뒤 실패)은 같은 기본안을 다시 재지 않는다 — 위치 호출은 첫 시도의 2회뿐, 기록은 error rerun', async () => {
  const calls = installJob({ bases: [jpegOf(320, 240, 7)], positionDelayMs: 60, failFirstQuote: true });
  const st = fakeState();
  const job = new GenerateJob(st, { ...JOB_ENV, POSITION_QC: 'on' });
  await job.fetch(
    new Request('https://generate-job/start', {
      method: 'POST',
      body: JSON.stringify({
        id: ROW_ID, userId: USER_ID, creditRef: 'c', category: 'sink', options: { variants: false },
        inputs: { room: { path: `${USER_ID}/${ROW_ID}/room.jpg`, url: 'u', mime: 'image/jpeg' }, refs: [] }, startedAt: Date.now(),
      }),
    })
  );
  await job.alarm(); // 1차: 기본안 직후 패치 실패 → 재시도 예약
  assert.ok(st.m.get('ckpt').images.base, '체크포인트에 기본안');
  assert.equal(st.m.get('ckpt').attempt, 1);
  await new Promise((r) => setTimeout(r, 300)); // 1차의 위치 검사(뒤에서 돈다)가 끝나게
  const first = calls.position.length;
  assert.equal(first, 2);
  await job.alarm(); // 2차 (알람 재실행)
  assert.equal(calls.position.length, first, '다시 재지 않는다');
  const done = calls.patched.find((p) => p.status === 'done');
  assert.ok(done);
  assert.equal(done.images[0].position.error, 'rerun');
  assert.equal(done.images[0].position.calls, 0);
});

test('잡: done 뒤 늦은 기록을 기다리다 리셋되면(체크포인트 doneAt) 알람은 아무것도 보내지 않는다 — attempt 초과·10분 초과여도 fail() 로 덮지 않는다', async () => {
  for (const ck of [{ attempt: 2 }, { attempt: 1, old: true }]) {
    const calls = installJob({ bases: [jpegOf(320, 240, 8)] });
    const st = fakeState();
    const job = new GenerateJob(st, { ...JOB_ENV, POSITION_QC: 'on' });
    st.m.set('job', { id: ROW_ID, userId: USER_ID, creditRef: 'c', category: 'sink', options: {}, inputs: {}, startedAt: ck.old ? Date.now() - 11 * 60_000 : Date.now() });
    st.m.set('ckpt', { step: 'variants', attempt: ck.attempt, images: { base: { label: 'b', path: 'p/base.jpg', url: 'u', qc: { ok: true, issues: [] } } }, doneAt: Date.now() - 1000 });
    await job.alarm();
    assert.equal(calls.patched.length, 0, JSON.stringify(ck));
    assert.equal(st.m.size, 0, '체크포인트를 지운다');
  }
});

// 플래너 잡 — 도면 덩어리(PLANNER_PLACE_GUIDE)를 칠했으면 planner_place, 아니면 planner (planner-place.test.js 와 같은 가상 방)
function plannerRoomPoints() {
  const W = 1600, H = 1200, f = 1000, hf = 1450, D = 4200, t = (10 * Math.PI) / 180, wallH = 2400;
  const r1 = [Math.cos(t), 0, Math.sin(t)], r3 = [-Math.sin(t), 0, Math.cos(t)];
  const proj = (X, h, z) => {
    const c = [0, 1, 2].map((i) => X * r1[i] + (i === 1 ? hf - h : 0) + (D - z) * r3[i]);
    return [(f * c[0]) / c[2] + W / 2, (f * c[1]) / c[2] + H / 2];
  };
  const k = 1024 / 1600; // 선 찾기 바탕은 긴 변 1024
  const sc = (p) => [p[0] * k, p[1] * k];
  return {
    back_floor: [sc(proj(-1400, 0, 0)), sc(proj(1400, 0, 0))],
    back_ceiling: [sc(proj(-1400, wallH, 0)), sc(proj(1400, wallH, 0))],
    left_end: { floor: sc(proj(-1800, 0, 0)), ceiling: sc(proj(-1800, wallH, 0)), side_wall: true },
    right_end: { floor: sc(proj(1800, 0, 0)), ceiling: sc(proj(1800, wallH, 0)), side_wall: true },
    side_floor: [sc(proj(1800, 0, 0)), sc(proj(1800, 0, 1200))],
    side_ceiling: [sc(proj(1800, wallH, 0)), sc(proj(1800, wallH, 1200))],
  };
}
const placeSpec = () => ({
  wallRunMm: 2200,
  ceilingMm: 2400,
  layout: { shape: 'straight' },
  sections: {
    lower: { widthMm: 2200, heightMm: 870, depthMm: 600, fromLeftMm: 0, fromFloorMm: 0, modules: [{ widthMm: 800, kind: 'door', doorCount: 2 }, { widthMm: 400, kind: 'door', doorCount: 1 }, { widthMm: 1000, kind: 'door', doorCount: 2 }] },
    upper: { widthMm: 1800, heightMm: 900, depthMm: 350, fromLeftMm: 0, fromFloorMm: 1500, modules: [{ widthMm: 900, kind: 'door', doorCount: 2 }, { widthMm: 900, kind: 'door', doorCount: 2 }] },
  },
  appliances: [{ kind: 'sink', fromLeftMm: 900, widthMm: 600 }],
});

async function runPlannerPositionJob(flag) {
  const room = jpegOf(1600, 1200, 9);
  const base = jpegOf(320, 240, 10);
  const s = scene({ W: 320, H: 240, yawDeg: 6 });
  const points = plannerRoomPoints();
  const seen = { patched: [], position: 0, lines: 0 };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.anthropic.com/')) {
      const text = String(init.body).includes('Find lines and corners') ? (seen.lines++, JSON.stringify(points)) : '{}';
      return gjson({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
    }
    if (u.includes('/storage/v1/object/')) {
      if ((init.method || 'GET') === 'POST') return gjson({ Key: 'ok' });
      return new Response(Buffer.from(room.base64, 'base64'), { headers: { 'Content-Type': 'image/jpeg' } });
    }
    if (u.includes('/rest/v1/generations')) {
      if ((init.method || 'GET') === 'GET') return gjson([{ id: ROW_ID, options: {} }]);
      seen.patched.push(JSON.parse(init.body));
      return gjson([{ id: ROW_ID }]);
    }
    const body = JSON.parse(init.body);
    const parts = body.contents[0].parts;
    const prompt = parts[parts.length - 1].text;
    if (body.generationConfig.responseModalities.length === 1) {
      if (prompt.startsWith('TASK: mark precise geometric landmarks')) {
        seen.position++;
        const resp = /ZOOMED CROP/.test(prompt) ? asZoomResponse(s.L, 320, 240) : asResponse(s.L);
        return gjson({ candidates: [{ content: { parts: [{ text: JSON.stringify(resp) }] } }] });
      }
      const text = prompt.startsWith('Measure and describe')
        ? JSON.stringify({ wall_width_mm: 3600, wall_height_mm: 2400, confidence: 'medium', site_condition: 'finished', existing_furniture: null })
        : JSON.stringify({ ok: true, issues: [], note: 'n' });
      return gjson({ candidates: [{ content: { parts: [{ text }] } }] });
    }
    return gjson({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: base.base64 } }] } }] });
  };
  const job = new GenerateJob(fakeState(), {
    ...JOB_ENV, GEMINI_RETRY_DELAYS_MS: '0', ANTHROPIC_API_KEY: 'sk-ant', POSITION_QC: 'on', ...(flag ? { PLANNER_PLACE_GUIDE: flag } : {}),
  });
  await job.fetch(
    new Request('https://generate-job/start', {
      method: 'POST',
      body: JSON.stringify({
        id: ROW_ID, userId: USER_ID, creditRef: 'c', category: 'sink',
        options: { mode: 'planner', variants: false, image_provider: 'gemini', aspect: '4:3', design_spec: placeSpec() },
        inputs: { room: { path: `${USER_ID}/${ROW_ID}/room.jpg`, url: 'u', mime: 'image/jpeg' }, refs: [], renders: [{ role: 'elevation', path: `${USER_ID}/${ROW_ID}/render-elevation.png`, url: 'u', mime: 'image/png' }] },
        startedAt: Date.now(),
      }),
    })
  );
  await job.alarm();
  const rec = seen.patched.filter((p) => p.images && p.images[0] && p.images[0].position).map((p) => p.images[0].position).pop();
  return { seen, rec };
}

test('잡(플래너): 도면 덩어리를 칠했으면 위치 검사는 planner_place(칠 span 틀), 스위치가 꺼져 있으면 planner(분석 wallW 틀)', async () => {
  const on = await runPlannerPositionJob('on');
  assert.equal(on.seen.lines, 1, '선 찾기 → 덩어리를 칠했다');
  assert.ok(on.rec, '기록이 실린 패치');
  assert.equal(on.rec.route, 'planner_place', JSON.stringify(on.rec).slice(0, 300));
  assert.ok(on.rec.expected.span > 0 && on.rec.expected.s === 1, JSON.stringify(on.rec.expected));
  assert.equal(on.rec.expected.anchor, 'left');
  assert.equal(on.rec.expected.mm.run_right_wall, 2200, '줄 오른끝 = 런 틀 끝 (칠 좌표, s = 1)');
  assert.equal(on.seen.position, 2);
  const off = await runPlannerPositionJob(null);
  assert.equal(off.seen.lines, 0);
  assert.equal(off.rec.route, 'planner');
  assert.equal(off.rec.expected.wallW, 3600);
  assert.equal(off.rec.expected.span, undefined);
});

// 마지막에 둔다 — 과부하 기록은 isolate(이 시험 파일)의 모듈 상태라, 모델 이름을 따로 써서 다른 시험에 새지 않게 한다
test('잡: QC 가 과부하(429)로 건너뛰어진 직후면 위치 검사를 보내지 않는다 — error skipped_overload, 생성은 done', async () => {
  const calls = installJob({ bases: [jpegOf(320, 240, 11)], qcStatus: 429 });
  await runJob({ POSITION_QC: 'on', GEMINI_RETRY_DELAYS_MS: '0', GEMINI_TEXT_MODEL: 'flash-overload-job-test', POSITION_MODEL: 'flash-overload-job-test' });
  assert.ok(calls.qc >= 1);
  assert.equal(calls.position.length, 0, '위치 호출 0');
  const done = calls.patched.find((p) => p.status === 'done');
  assert.ok(done, '생성은 done');
  const rec = calls.patched.filter((p) => p.images && p.images[0] && p.images[0].position).pop().images[0].position;
  assert.equal(rec.error, 'skipped_overload');
  assert.equal(rec.calls, 0);
});
