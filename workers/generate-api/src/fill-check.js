/**
 * 기본안 벽 채움 검사 — 기록 전용 (2026-11-21, 대표님 「위치 검사를 모든 품목에」).
 * 설계: docs/02-design/features/fill-check.md
 *
 * 대표님 답: AI 연출컷만(앱 플래너 연출은 빼고) · 품목 10개 모두 · 가구 왼끝 · 오른끝 · 위 · 아래가 벽 · 천장 · 바닥에
 *   닿았는지만 · 기록만. 주방 위치 검사(position.js)는 싱크 · 쿡탑 · 후드 점을 재는 것이라 그대로 두고 이 검사를 따로 둔다.
 *
 * Flash 한 번에 [방 사진, 기본안] → 가구 바깥 상자 · 뒷벽 양 끝 · 천장선 · 바닥선(0~1000)과 네 변의 touch/gap/unsure.
 *   mm 는 정면 가정 비례(벽 폭 · 높이 × 그림 속 틈 비율)라 참고값이다. 판정(ok)은 상태로만 한다.
 *   판정하는 변은 연출컷 지시문이 이미 「닿는다」고 말한 것뿐이다 (prompts.js FILL_WANT).
 * 기록만 한다. 다시 그리지 않고, 상태 · 단계 라벨 · 진행률 · 크레딧을 건드리지 않는다. 이 파일의 함수는 던지지 않는다.
 */

import { callGemini, geminiOverloadAt } from './gemini.js';
import { FILL_SCHEMA, FILL_SIDES, FILL_WANT, buildFillPrompt } from './prompts.js';

/** 기록 형식 · 질의의 판. 바뀌면 올린다 — 집계는 판별로 나눈다. */
export const FILL_VERSION = 1;
/** 위치 검사와 같은 모델 (env.FILL_MODEL 로만 바꾼다) */
export const FILL_MODEL_DEFAULT = 'gemini-3.8-flash';
/**
 * 시간 (ms). 호출 30초 · 전체 45초 · 과부하(429 · 5xx) 재시도는 5초 뒤 1회, 남은 예산이 20초 이상일 때만.
 * overloadSkip: 같은 모델이 이 isolate 에서 최근 이만큼 안에 과부하를 받았으면 보내지 않는다 (손님 쪽 호출을 늘리지 않는다).
 */
export const FILL_TIMING = { total: 45_000, call: 30_000, retryWait: 5_000, minLeft: 20_000, hardExtra: 5_000, overloadSkip: 120_000 };
/** 좌표 범위 — 0~1000 에서 조금 넘는 것(가장자리)은 받는다 */
const COORD_MIN = -50;
const COORD_MAX = 1050;
/** 벽 끝 사이 · 천장선과 바닥선 사이가 이보다 좁으면(0~1000 단위) 비율을 내지 않는다 */
const MIN_SPAN = 50;
const NOTE_MAX = 160;

/** 검사 대상 품목 키 (아니면 null) — AI 연출컷만: 플래너 모드 · 다듬기 · 방 비우기는 뺀다 */
export function fillTarget(input) {
  if (!input || typeof input !== 'object') return null;
  const opts = input.options || {};
  if (opts.mode === 'planner') return null;
  const key = input.category;
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(FILL_WANT, key) ? key : null;
}

/** Flash 응답 글 → 객체. 코드 울타리를 벗긴다. 객체가 아니면 null. */
export function parseFill(text) {
  if (typeof text !== 'string') return null;
  const s = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
/** 좌표 하나: null 은 「보이지 않음」(null), 범위 밖이나 숫자 아님은 「틀림」(undefined) */
function coord(v) {
  if (v === null || v === undefined) return null;
  return isNum(v) && v >= COORD_MIN && v <= COORD_MAX ? v : undefined;
}
function boxOf(v) {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const [ymin, xmin, ymax, xmax] = v.map(coord);
  if ([ymin, xmin, ymax, xmax].some((x) => x === null || x === undefined)) return null;
  if (!(ymax > ymin) || !(xmax > xmin)) return null;
  return { ymin, xmin, ymax, xmax };
}
const STATES = ['touch', 'gap', 'unsure'];
const round10 = (mm) => Math.round(mm / 10) * 10;

/**
 * 응답 → 네 변 { s, mm? }. 가구 상자가 없거나 틀리면 네 변 모두 unsure.
 * 그 변이 기대는 벽 점이 틀리면(범위 밖) 그 변은 unsure, 보이지 않으면(null) 상태는 모델 판정 · mm 없음.
 * mm = 틈 비율 × 벽 폭(좌우) · 벽 높이(위아래), 0 보다 작으면 0 (가구 앞면이 벽보다 앞이라 넓게 보인다).
 */
export function measureFill(parsed, wall = {}) {
  const p = parsed && typeof parsed === 'object' ? parsed : {};
  const W = Number(wall && wall.wallW) || 0;
  const H = Number(wall && wall.wallH) || 0;
  const box = boxOf(p.furniture_box);
  const wl = coord(p.wall_left_x);
  const wr = coord(p.wall_right_x);
  const cy = coord(p.ceiling_y);
  const fy = coord(p.floor_y);
  const sides = {};
  for (const side of FILL_SIDES) {
    if (!box) {
      sides[side] = { s: 'unsure' };
      continue;
    }
    const horiz = side === 'left' || side === 'right';
    const a = horiz ? wl : cy;
    const b = horiz ? wr : fy;
    const mine = side === 'left' ? wl : side === 'right' ? wr : side === 'top' ? cy : fy;
    if (mine === undefined) {
      sides[side] = { s: 'unsure' };
      continue;
    }
    const s = STATES.includes(p[side]) ? p[side] : 'unsure';
    const out = { s };
    const len = horiz ? W : H;
    if (isNum(a) && isNum(b) && b - a >= MIN_SPAN && len > 0) {
      const gap =
        side === 'left' ? box.xmin - a : side === 'right' ? b - box.xmax : side === 'top' ? box.ymin - a : b - box.ymax;
      out.mm = Math.max(0, round10((gap / (b - a)) * len));
    }
    sides[side] = out;
  }
  return { sides, box: !!box };
}

/** 판정: want 변 중 하나라도 gap → false, 모두 touch → true, 그 밖(unsure 섞임 · want 없음) → null */
export function fillOk(want, sides) {
  if (!Array.isArray(want) || !want.length || !sides) return null;
  const states = want.map((k) => (sides[k] && sides[k].s) || 'unsure');
  if (states.includes('gap')) return false;
  return states.every((s) => s === 'touch') ? true : null;
}

function codeOf(e) {
  if (e && e.code) return e.code;
  const name = e && e.name;
  const msg = String((e && e.message) || '');
  if (name === 'TimeoutError' || name === 'AbortError' || /timeout|aborted/i.test(msg)) return 'timeout';
  const s = e && e.status;
  if (s === 429) return 'http_429';
  if (s >= 500) return 'http_5xx';
  if (s >= 400) return 'http_4xx';
  return 'net';
}
const codeErr = (code) => Object.assign(new Error(code), { code });

function timeoutRace(p, ms) {
  let timer = null;
  return Promise.race([
    p,
    new Promise((_, rej) => {
      timer = setTimeout(() => rej(Object.assign(new Error('fill call timeout'), { name: 'TimeoutError' })), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function record(st, extra = {}) {
  return {
    v: FILL_VERSION,
    ok: null,
    want: st.want,
    sides: null,
    ...extra,
    model: st.model,
    calls: st.calls,
    ms: st.now() - st.t0,
    ...(st.provider ? { provider: st.provider } : {}),
    ...(st.error ? { error: st.error } : {}),
  };
}

/**
 * 채움 검사 한 번. 늘 기록(객체) 또는 null(대상 아님)로 풀린다 — 던지지 않는다.
 * @param {object} env   FILL_MODEL
 * @param {object} input job.js positionInput — { category, base, room, wall, options, provider, jobId }
 * @param {object} [deps] 시험용: callGemini · now · sleep · timing · overloadAt
 */
export async function runFillCheck(env, input, deps = {}) {
  const key = fillTarget(input);
  if (!key) return null;
  const e = env || {};
  const now = deps.now || Date.now;
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const call = deps.callGemini || callGemini;
  const T = { ...FILL_TIMING, ...(deps.timing || {}) };
  const overloadAt = deps.overloadAt || geminiOverloadAt;
  const st = {
    t0: now(),
    now,
    calls: 0,
    error: null,
    want: FILL_WANT[key].slice(),
    model: e.FILL_MODEL || FILL_MODEL_DEFAULT,
    provider: input.provider || null,
  };
  try {
    const base = input.base;
    const room = input.room;
    if (!base || typeof base.base64 !== 'string' || !base.base64) {
      st.error = 'no_image';
      return record(st);
    }
    if (!room || typeof room.base64 !== 'string' || !room.base64) {
      st.error = 'no_room';
      return record(st);
    }
    const at = Number(overloadAt(st.model)) || 0;
    if (at > 0 && Date.now() - at < T.overloadSkip) {
      st.error = 'skipped_overload';
      return record(st);
    }
    const deadline = st.t0 + T.total;
    let text = '';
    for (let attempt = 0; ; attempt++) {
      const left = deadline - now();
      if (left < 1000) throw codeErr('budget');
      const ms = Math.min(T.call, left);
      st.calls++;
      try {
        const r = await timeoutRace(
          Promise.resolve().then(() =>
            call(e, {
              prompt: buildFillPrompt(key),
              images: [
                { base64: room.base64, mimeType: room.mimeType || 'image/jpeg' },
                { base64: base.base64, mimeType: base.mimeType || 'image/jpeg' },
              ],
              want: 'text',
              model: st.model,
              temperature: 0,
              retryDelaysMs: [], // 과부하 재시도는 여기서 1회만
              extraConfig: {
                responseMimeType: 'application/json',
                responseSchema: FILL_SCHEMA,
                thinkingConfig: { thinkingLevel: 'low' },
                maxOutputTokens: 2048,
              },
              signal: AbortSignal.timeout(ms),
            })
          ),
          ms + 250
        );
        text = r && typeof r.text === 'string' ? r.text : '';
        break;
      } catch (err) {
        const retryable = !!(err && (err.retryable || [429, 500, 503].includes(err.status)));
        if (attempt === 0 && retryable && deadline - now() - T.retryWait >= T.minLeft) {
          await sleep(T.retryWait);
          continue;
        }
        throw codeErr(codeOf(err));
      }
    }
    const parsed = parseFill(text);
    if (!parsed) {
      st.error = 'parse';
      return record(st);
    }
    const m = measureFill(parsed, input.wall || {});
    if (!m.box) st.error = 'no_furniture';
    const note = typeof parsed.note === 'string' ? parsed.note.trim().slice(0, NOTE_MAX) : '';
    return record(st, { ok: m.box ? fillOk(st.want, m.sides) : null, sides: m.sides, ...(note ? { note } : {}) });
  } catch (err) {
    st.error = codeOf(err);
    return record(st);
  }
}

const SIDE_TAG = { left: 'L', right: 'R', top: 'T', bottom: 'B' };
const STATE_TAG = { touch: 't', gap: 'g', unsure: '?' };

/**
 * job.js 용 — 기다리지 않고 시작한다. 게이트(env.FILL_QC === 'on')가 꺼졌거나 대상이 아니면 null.
 * attachTo(slot) 로 기본안 칸을 주면 끝나는 순간 slot.fill 에 기록이 들어간다 (이후 images 패치에 저절로 실린다).
 */
export function startFillCheck(env, input, deps = {}) {
  if (!env || env.FILL_QC !== 'on') return null;
  if (!fillTarget(input)) return null;
  const T = { ...FILL_TIMING, ...(deps.timing || {}) };
  let target = null;
  let result = null;
  let done = false;
  let timer = null;
  const t0 = Date.now();
  const key = fillTarget(input);
  const hard = new Promise((res) => {
    timer = setTimeout(
      () =>
        res({
          v: FILL_VERSION, ok: null, want: FILL_WANT[key].slice(), sides: null,
          model: env.FILL_MODEL || FILL_MODEL_DEFAULT, calls: null, ms: Date.now() - t0, error: 'timeout',
        }),
      T.total + T.hardExtra
    );
  });
  const promise = Promise.race([runFillCheck(env, input, deps).catch(() => null), hard])
    .then((rec) => {
      clearTimeout(timer);
      result = rec || null;
      if (target && result) target.fill = result;
      done = true;
      if (result) {
        const s = result.sides
          ? FILL_SIDES.map((k) => `${SIDE_TAG[k]}:${STATE_TAG[result.sides[k].s] || '?'}${result.sides[k].mm != null ? result.sides[k].mm : ''}`).join(' ')
          : '-';
        const tag = input && input.jobId ? `[Job ${input.jobId}] fill` : '[fill]';
        console.log(`${tag} ${key} ok=${result.ok} ${s}${result.error ? ` error=${result.error}` : ''} calls=${result.calls} ${result.ms}ms`);
      }
      return result;
    })
    .catch(() => {
      clearTimeout(timer);
      done = true;
      return null;
    });
  return {
    get done() {
      return done;
    },
    get result() {
      return result;
    },
    attachTo(slot) {
      target = slot || null;
      if (done && result && target) target.fill = result;
    },
    wait(ms) {
      if (done) return Promise.resolve(true);
      if (!(ms > 0)) return Promise.resolve(false);
      return new Promise((res) => {
        const t = setTimeout(() => res(false), ms);
        promise.then(() => {
          clearTimeout(t);
          res(true);
        });
      });
    },
    promise,
  };
}

/**
 * job.js 알람 재실행용 — 기본안이 이미 있고 채움 기록이 없을 때 **다시 재지 않고** 그 사실만 남긴다.
 * 게이트 꺼짐 · 대상 아님이면 null (기록 키 없음).
 */
export function fillSkipped(env, input, code) {
  if (!env || env.FILL_QC !== 'on') return null;
  const key = fillTarget(input);
  if (!key) return null;
  return {
    v: FILL_VERSION, ok: null, want: FILL_WANT[key].slice(), sides: null,
    model: env.FILL_MODEL || FILL_MODEL_DEFAULT, calls: 0, ms: 0, error: code,
  };
}
