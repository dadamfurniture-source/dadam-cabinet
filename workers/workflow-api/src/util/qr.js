/**
 * 소형 QR 인코더 — 부재 라벨용 (B5).
 *
 * 워커에는 의존성이 없고 공장 네트워크는 CDN 을 막을 수 있어(print-css.js 머리말)
 * QR 도 서버에서 SVG 로 그려 문서 안에 박는다. 범위는 라벨에 필요한 만큼만:
 *   - 바이트 모드(UTF-8), 버전 1~10, 오류정정 M
 *   - ISO/IEC 18004 대로 마스크 8종 벌점 평가 후 선택 (옵션으로 고정 가능)
 *   - 출력은 모듈 행렬과 <path d="…"> 문자열
 *
 * partId(`0-l1-body:side-0#0`, 20자 안팎)는 버전 2~3 에서 끝난다. 213 바이트(버전 10-M)를
 * 넘는 문자열은 라벨에 실을 일이 없으므로 예외를 낸다.
 */

// ── 버전 표 (오류정정 M) ─────────────────────────────────────────
// [블록당 EC 코드워드 수, [[블록 수, 블록당 데이터 코드워드 수], …]]
const EC_M = {
  1: [10, [[1, 16]]],
  2: [16, [[1, 28]]],
  3: [26, [[1, 44]]],
  4: [18, [[2, 32]]],
  5: [24, [[2, 43]]],
  6: [16, [[4, 27]]],
  7: [18, [[4, 31]]],
  8: [22, [[2, 38], [2, 39]]],
  9: [22, [[3, 36], [2, 37]]],
  10: [26, [[4, 43], [1, 44]]],
};

// 정렬 패턴 중심 좌표 (행·열 공통)
const ALIGN = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

export const QR_MAX_VERSION = 10;
const EC_LEVEL_BITS_M = 0; // L=1 M=0 Q=3 H=2

// ── GF(256) · Reed-Solomon ───────────────────────────────────────
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/** 차수 n 의 RS 생성 다항식 계수 (최고차부터, 첫 항 1). */
export function rsGenerator(n) {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** 데이터 코드워드 → EC 코드워드 n 개. */
export function rsEncode(data, n) {
  const gen = rsGenerator(n);
  const rem = new Array(n).fill(0);
  for (const b of data) {
    const factor = b ^ rem.shift();
    rem.push(0);
    for (let j = 0; j < n; j++) rem[j] ^= gfMul(gen[j + 1], factor);
  }
  return rem;
}

// ── 비트 스트림 ──────────────────────────────────────────────────
function textToBytes(text) {
  return Array.from(new TextEncoder().encode(String(text)));
}

function dataCodewordCount(version) {
  return EC_M[version][1].reduce((s, [count, len]) => s + count * len, 0);
}

/** 바이트 모드 용량 (문자 수). 버전 10 부터 길이 지시자가 16 비트다. */
export function byteCapacity(version) {
  const bits = dataCodewordCount(version) * 8;
  const countBits = version >= 10 ? 16 : 8;
  return Math.floor((bits - 4 - countBits) / 8);
}

/** 바이트 수에 맞는 최소 버전. 없으면 null. */
export function pickVersion(byteLen) {
  for (let v = 1; v <= QR_MAX_VERSION; v++) {
    if (byteLen <= byteCapacity(v)) return v;
  }
  return null;
}

function buildCodewords(bytes, version) {
  const total = dataCodewordCount(version);
  const bits = [];
  const push = (value, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version >= 10 ? 16 : 8);
  for (const b of bytes) push(b, 8);
  // 종단 (최대 4비트) → 바이트 정렬 → 패딩 0xEC 0x11 반복
  const cap = total * 8;
  push(0, Math.min(4, cap - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    data.push(b);
  }
  for (let pad = 0xec; data.length < total; pad ^= 0xec ^ 0x11) data.push(pad);

  // 블록 분할 → RS → 인터리브
  const [ecLen, groups] = EC_M[version];
  const blocks = [];
  let offset = 0;
  for (const [count, len] of groups) {
    for (let k = 0; k < count; k++) {
      const chunk = data.slice(offset, offset + len);
      offset += len;
      blocks.push({ data: chunk, ec: rsEncode(chunk, ecLen) });
    }
  }
  const out = [];
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxData; i++) {
    for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  }
  for (let i = 0; i < ecLen; i++) for (const b of blocks) out.push(b.ec[i]);
  return out;
}

// ── 행렬 ─────────────────────────────────────────────────────────
function makeGrid(size, fill) {
  return Array.from({ length: size }, () => new Uint8Array(size).fill(fill));
}

/** 형식 정보 15 비트 (BCH(15,5) + 마스크 XOR). */
export function formatBits(mask, ecBits = EC_LEVEL_BITS_M) {
  const data = (ecBits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** 버전 정보 18 비트 (버전 7 이상). */
export function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

const bit = (v, i) => (v >>> i) & 1;

/** 기능 패턴을 그리고 예약 격자를 돌려준다. 형식·버전 자리도 예약한다. */
function drawFunctionPatterns(modules, reserved, version) {
  const size = modules.length;
  const set = (r, c, v) => {
    modules[r][c] = v;
    reserved[r][c] = 1;
  };

  // 타이밍
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0 ? 1 : 0);
    set(i, 6, i % 2 === 0 ? 1 : 0);
  }
  // 파인더 + 분리자 (분리자는 파인더 밖 1칸 — 범위 밖은 건너뛴다)
  const finder = (cr, cc) => {
    for (let dr = -4; dr <= 4; dr++) {
      for (let dc = -4; dc <= 4; dc++) {
        const r = cr + dr;
        const c = cc + dc;
        if (r < 0 || c < 0 || r >= size || c >= size) continue;
        const d = Math.max(Math.abs(dr), Math.abs(dc));
        set(r, c, d !== 2 && d !== 4 ? 1 : 0);
      }
    }
  };
  finder(3, 3);
  finder(3, size - 4);
  finder(size - 4, 3);

  // 정렬 패턴 (파인더와 겹치는 세 귀퉁이는 뺀다)
  const pos = ALIGN[version];
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      const first = i === 0 && j === 0;
      const tr = i === 0 && j === pos.length - 1;
      const bl = i === pos.length - 1 && j === 0;
      if (first || tr || bl) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          set(pos[i] + dr, pos[j] + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1 ? 1 : 0);
        }
      }
    }
  }

  // 형식 정보 자리 예약 (값은 마스크 결정 후) + 어두운 모듈
  drawFormat(modules, reserved, 0);
  // 버전 정보
  if (version >= 7) {
    const vb = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit(vb, i));
      set(b, a, bit(vb, i));
    }
  }
}

function drawFormat(modules, reserved, mask) {
  const size = modules.length;
  const fb = formatBits(mask);
  const set = (r, c, v) => {
    modules[r][c] = v;
    reserved[r][c] = 1;
  };
  // 왼쪽 위 파인더 둘레 — (8,0) 부터 MSB(bit 14) 순. 열 8 은 위로 갈수록 낮은 비트.
  for (let i = 0; i <= 5; i++) set(8, i, bit(fb, 14 - i));
  set(8, 7, bit(fb, 8));
  set(8, 8, bit(fb, 7));
  set(7, 8, bit(fb, 6));
  for (let i = 0; i <= 5; i++) set(i, 8, bit(fb, i));
  // 두 번째 사본 — 열 8 아래쪽은 bit 14 부터, 행 8 오른쪽은 bit 7 부터
  for (let i = 0; i <= 6; i++) set(size - 1 - i, 8, bit(fb, 14 - i));
  for (let i = 0; i <= 7; i++) set(8, size - 8 + i, bit(fb, 7 - i));
  set(size - 8, 8, 1); // 어두운 모듈
}

/** 데이터 코드워드를 지그재그로 놓는다. 예약 칸은 건너뛴다. */
function placeData(modules, reserved, codewords) {
  const size = modules.length;
  let i = 0; // 비트 인덱스
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - vert : vert;
        if (reserved[r][c]) continue;
        // 남는 비트(remainder bits)는 0
        modules[r][c] = i < total ? bit(codewords[i >>> 3], 7 - (i & 7)) : 0;
        i++;
      }
    }
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(modules, reserved, mask) {
  const size = modules.length;
  const fn = MASKS[mask];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!reserved[r][c] && fn(r, c)) modules[r][c] ^= 1;
    }
  }
}

/** ISO 18004 벌점 (N1=3, N2=3, N3=40, N4=10). */
export function penalty(modules) {
  const size = modules.length;
  let score = 0;

  const runPenalty = (line) => {
    let s = 0;
    let run = 1;
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && line[i] === line[i - 1]) {
        run++;
      } else {
        if (run >= 5) s += 3 + (run - 5);
        run = 1;
      }
    }
    return s;
  };
  const finderPenalty = (line) => {
    let s = 0;
    const p1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const p2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    for (let i = 0; i + 11 <= line.length; i++) {
      let m1 = true;
      let m2 = true;
      for (let k = 0; k < 11 && (m1 || m2); k++) {
        if (line[i + k] !== p1[k]) m1 = false;
        if (line[i + k] !== p2[k]) m2 = false;
      }
      if (m1) s += 40;
      if (m2) s += 40;
    }
    return s;
  };

  const cols = Array.from({ length: size }, (_, c) => modules.map((row) => row[c]));
  for (const row of modules) score += runPenalty(row) + finderPenalty(row);
  for (const col of cols) score += runPenalty(col) + finderPenalty(col);

  for (let r = 0; r + 1 < size; r++) {
    for (let c = 0; c + 1 < size; c++) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) score += 3;
    }
  }

  let dark = 0;
  for (const row of modules) for (const v of row) dark += v;
  const total = size * size;
  score += Math.floor((Math.abs(dark * 2 - total) * 10) / total) * 10;
  return score;
}

/**
 * 인코딩.
 * @param {string} text  UTF-8 로 넣는다
 * @param {{mask?: number, version?: number}} opts  mask 0~7 고정(생략 시 벌점 최소), version 최소 버전 강제
 * @returns {{version:number, size:number, mask:number, modules:Uint8Array[]}}
 */
export function encode(text, opts = {}) {
  const bytes = textToBytes(text);
  let version = pickVersion(bytes.length);
  if (version === null) {
    throw new Error(`QR 바이트 모드 용량(버전 ${QR_MAX_VERSION}-M, ${byteCapacity(QR_MAX_VERSION)}바이트) 초과: ${bytes.length}바이트`);
  }
  if (Number.isInteger(opts.version)) {
    if (opts.version < version || opts.version > QR_MAX_VERSION) {
      throw new Error(`version 은 ${version}~${QR_MAX_VERSION} 이어야 합니다`);
    }
    version = opts.version;
  }

  const size = 17 + 4 * version;
  const codewords = buildCodewords(bytes, version);

  const build = (mask) => {
    const modules = makeGrid(size, 0);
    const reserved = makeGrid(size, 0);
    drawFunctionPatterns(modules, reserved, version);
    placeData(modules, reserved, codewords);
    applyMask(modules, reserved, mask);
    drawFormat(modules, reserved, mask);
    return modules;
  };

  if (Number.isInteger(opts.mask)) {
    if (opts.mask < 0 || opts.mask > 7) throw new Error('mask 는 0~7 이어야 합니다');
    return { version, size, mask: opts.mask, modules: build(opts.mask) };
  }

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const modules = build(mask);
    const score = penalty(modules);
    if (!best || score < best.score) best = { mask, modules, score };
  }
  return { version, size, mask: best.mask, modules: best.modules };
}

/**
 * 행렬 → SVG path d 속성. 행마다 연속한 어두운 모듈을 한 사각형으로 묶는다.
 * 좌표 단위는 모듈 1 = 1. quiet 만큼 밀어 그린다.
 */
export function toSvgPath(modules, quiet = 0) {
  const parts = [];
  for (let r = 0; r < modules.length; r++) {
    const row = modules[r];
    let c = 0;
    while (c < row.length) {
      if (!row[c]) {
        c++;
        continue;
      }
      let len = 1;
      while (c + len < row.length && row[c + len]) len++;
      parts.push(`M${c + quiet} ${r + quiet}h${len}v1h-${len}z`);
      c += len;
    }
  }
  return parts.join('');
}

/**
 * 라벨용 <svg>. 4 모듈 여백(quiet zone)을 둔다. text 는 인코더가 바이트로 받으므로
 * HTML 이스케이프가 필요 없다 — 출력에 원문이 들어가지 않는다.
 */
export function qrSvg(text, { quiet = 4, className = 'qr' } = {}) {
  const { modules, size } = encode(text);
  const total = size + quiet * 2;
  return (
    `<svg class="${className}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" ` +
    `xmlns="http://www.w3.org/2000/svg"><rect width="${total}" height="${total}" fill="#fff"/>` +
    `<path d="${toSvgPath(modules, quiet)}" fill="#000"/></svg>`
  );
}
