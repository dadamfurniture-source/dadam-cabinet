/**
 * 방 사진 열쇠와 분석 중앙값 (2026-10-20, 플래너 「사진으로 만들기」).
 *
 * #941 은 방 사진 **바이트** SHA-256 으로 같은 사진을 묶었다. 실측: 같은 화면을 다시 저장한 JPEG 는 바이트가
 * 달라 이어받지 못했고, 한 번 분석한 값(4500)이 그 사진에 고정됐다 — 이전 13회 분석의 중앙값은 4350, 실측 4.3~4.5 m.
 * 첫 값 하나가 분포의 끝일 수 있다. 사장님 결정(2026-10-20):
 *   - 같은 **그림**(재저장·재압축)은 같은 사진 — 화면 기준 지각 해시(dHash)로 묶는다. 다른 기기의 다른 사진은 새로 분석.
 *   - 새 사진은 분석을 3회 돌려 숫자 칸은 중앙값, 나머지 글은 벽 폭이 중앙값인 회차의 것.
 *   - 같은 그림의 행이 여럿이면 그 분석들의 중앙값.
 *
 * 지각 해시: JPEG 를 jpeg-js 로 풀어(워커에는 캔버스가 없다) 9×8 그레이 상자 평균 → 옆 칸보다 밝으면 1 → 64비트 16진.
 *   PNG 디코더는 워커에 없다(guide.js 는 PNG 를 쓰기만 한다) — JPEG 가 아니거나 못 풀면 null, 그러면 sha256 만으로 예전처럼.
 *   플래너는 방 사진을 늘 JPEG 0.9 로 올린다 (js/planner/ai-photo.js).
 * 문턱 PHASH_MAX_DISTANCE: test/planner-wall-phash.test.js 가 리포의 실제 주방 사진(app/portfolio)으로 잰다 —
 *   같은 사진 재압축(품질 50~95·축소)은 0~3, 다른 사진은 같은 주방 다른 각도라도 20 이상.
 */
import decodeJpeg from 'jpeg-js/lib/decoder.js';
import { base64ToBytes } from './supabase.js';

/** 같은 그림으로 보는 해밍 거리 상한 (64비트 중) */
export const PHASH_MAX_DISTANCE = 6;
/** 지각 해시로 뒤지는 같은 사용자의 최근 행 수 */
export const ROOM_PHOTO_LOOKUP_LIMIT = 50;
/** 새 사진 분석 회차 (플래너만) */
export const ANALYSIS_ROUNDS = 3;

/** 방 사진 바이트의 SHA-256 (소문자 hex). 못 구하면 null — 그러면 예전처럼 매번 분석한다. */
export async function roomPhotoSha256(room) {
  try {
    if (!room || typeof room.base64 !== 'string' || !room.base64) return null;
    const buf = await crypto.subtle.digest('SHA-256', base64ToBytes(room.base64));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/**
 * RGBA 픽셀 → dHash (9×8 그레이 상자 평균, 행마다 옆 칸과 비교한 8비트) → 16자리 16진.
 * 크기에 상관없다(축소해 비교) — 재압축·약간의 축소에 강하다.
 */
export function dhashRgba({ width, height, data }) {
  const W = 9, H = 8;
  if (!(width > 0 && height > 0) || !data || data.length < width * height * 4) throw new Error('dhash: bad image');
  const gray = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor((y * height) / H);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / H));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor((x * width) / W);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / W));
      let sum = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * width + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) {
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          n++;
        }
      }
      gray[y * W + x] = sum / n;
    }
  }
  let hex = '';
  for (let y = 0; y < H; y++) {
    let byte = 0;
    for (let x = 0; x < 8; x++) byte = (byte << 1) | (gray[y * W + x] < gray[y * W + x + 1] ? 1 : 0);
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** 두 16진 해시의 해밍 거리. 모양이 다르면 Infinity (절대 같다고 보지 않는다). */
export function hammingHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const p = parseInt(a[i], 16), q = parseInt(b[i], 16);
    if (Number.isNaN(p) || Number.isNaN(q)) return Infinity; // NaN ^ n 은 0 이 되므로 먼저 거른다
    const x = p ^ q;
    d += (x & 1) + ((x >> 1) & 1) + ((x >> 2) & 1) + ((x >> 3) & 1);
  }
  return d;
}

/** 방 사진의 지각 해시. JPEG 가 아니거나 못 풀면 null (그러면 sha256 만으로). */
export function roomPhotoPhash(room) {
  try {
    if (!room || typeof room.base64 !== 'string' || !room.base64) return null;
    const bytes = base64ToBytes(room.base64);
    if (!(bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8)) return null; // JPEG SOI 만
    return dhashRgba(decodeJpeg(bytes, { useTArray: true, formatAsRGBA: true }));
  } catch {
    return null;
  }
}

/** 같은 사진인가 — 바이트가 같거나(sha256) 그림이 같다(phash 거리 ≤ 문턱). */
export function samePhoto(key, rp) {
  if (!key || !rp) return false;
  if (key.sha256 && rp.sha256 === key.sha256) return true;
  return hammingHex(key.phash, rp.phash) <= PHASH_MAX_DISTANCE;
}

/** [숫자 칸, 그 칸을 실제로 읽었다는 read 표시] — parseAnalysis 의 모양 */
const NUMERIC_FIELDS = [
  ['wallW', 'width'],
  ['wallH', 'height'],
  ['waterPct', 'water'],
  ['exhaustPct', 'exhaust'],
];

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return Math.round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}

/**
 * 분석 여러 회차(parseAnalysis 결과) → 하나.
 *   숫자 칸(wallW·wallH·waterPct·exhaustPct)은 **그 칸을 읽은 회차들**의 중앙값 — 못 읽은 회차의 기본값(3000·48·70)은
 *   측정이 아니라 섞지 않는다. 아무 회차도 못 읽었으면 기본값 그대로(read false).
 *   나머지(read·confidence·brief·existing·site·tile·cameraSide·sideReturn …)는 벽 폭이 중앙값에 가장 가까운 회차의 것 (같으면 앞선 것).
 *   read 가 없는 옛 모양은 다 읽은 것으로 본다.
 * @param {object[]} rounds
 * @returns {{analysis:object, chosen:number, count:number}|null} 쓸 회차가 없으면 null
 */
export function medianAnalysis(rounds) {
  const list = (rounds || []).filter((a) => a && typeof a === 'object' && Number(a.wallW) > 0 && Number(a.wallH) > 0);
  if (!list.length) return null;
  const readOf = (a, flag) => (a.read && typeof a.read === 'object' ? !!a.read[flag] : true);
  const widthRead = list.filter((a) => readOf(a, 'width'));
  let chosen = list[0];
  if (widthRead.length) {
    const w = median(widthRead.map((a) => Number(a.wallW)));
    chosen = widthRead.reduce((best, a) => (Math.abs(Number(a.wallW) - w) < Math.abs(Number(best.wallW) - w) ? a : best), widthRead[0]);
  }
  const out = JSON.parse(JSON.stringify(chosen));
  for (const [field, flag] of NUMERIC_FIELDS) {
    const vals = list.filter((a) => readOf(a, flag)).map((a) => Number(a[field])).filter((v) => Number.isFinite(v));
    if (!vals.length) continue;
    out[field] = median(vals);
    if (out.read && typeof out.read === 'object') out.read[flag] = true;
  }
  return { analysis: out, chosen: list.indexOf(chosen), count: list.length };
}
