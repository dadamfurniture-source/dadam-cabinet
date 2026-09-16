/**
 * B5: 부재 라벨 QR 인코더 (src/util/qr.js).
 *
 * 기준 벡터 `fixtures/qr-vectors.json` 은 두 독립 구현으로 만들었다 —
 * node-qrcode 1.5.4 (마스크 자동·0·3) 와 python qrcode 8 (마스크 0·3, 바이트 모드 강제).
 * 고정 마스크 행렬은 두 구현이 같았고, 자동 마스크는 node-qrcode 의 선택을 기준으로 삼는다
 * (python qrcode 의 벌점 계산은 ISO 와 조금 달라 다른 마스크를 고를 때가 있다).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  encode,
  toSvgPath,
  qrSvg,
  formatBits,
  versionBits,
  pickVersion,
  byteCapacity,
  rsEncode,
  rsGenerator,
  penalty,
  QR_MAX_VERSION,
} from '../src/util/qr.js';

const VECTORS = JSON.parse(readFileSync(new URL('./fixtures/qr-vectors.json', import.meta.url), 'utf8'));

function rowsOf(out) {
  return out.modules.map((row) => Array.from(row).join(''));
}

// ── 기준 벡터 ────────────────────────────────────────────────────

for (const [key, v] of Object.entries(VECTORS)) {
  for (const label of ['mask0', 'mask3']) {
    test(`벡터 ${key} (${v.bytes}B) — 마스크 고정 ${v[label].mask}: 행렬이 기준과 같다`, () => {
      const out = encode(v.text, { mask: v[label].mask });
      assert.equal(out.version, v[label].version);
      assert.equal(out.size, v[label].rows.length);
      assert.deepEqual(rowsOf(out), v[label].rows);
    });
  }
  test(`벡터 ${key} — 자동 마스크 선택이 기준(${v.auto.mask})과 같고 행렬도 같다`, () => {
    const out = encode(v.text);
    assert.equal(out.version, v.auto.version);
    assert.equal(out.mask, v.auto.mask);
    assert.deepEqual(rowsOf(out), v.auto.rows);
  });
}

// ── 구조 ─────────────────────────────────────────────────────────

test('크기는 17 + 4·버전 (1~10)', () => {
  for (let v = 1; v <= QR_MAX_VERSION; v++) {
    const out = encode('A', { version: v });
    assert.equal(out.version, v);
    assert.equal(out.size, 17 + 4 * v);
    assert.equal(out.modules.length, out.size);
  }
});

const FINDER = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];

function block(rows, r0, c0, n) {
  return rows.slice(r0, r0 + n).map((row) => row.slice(c0, c0 + n));
}

test('파인더 패턴 세 귀퉁이 + 분리자(흰 띠)', () => {
  for (const v of [1, 2, 7]) {
    const out = encode('finder', { version: v });
    const rows = rowsOf(out);
    const n = out.size;
    assert.deepEqual(block(rows, 0, 0, 7), FINDER, `v${v} 왼쪽 위`);
    assert.deepEqual(block(rows, 0, n - 7, 7), FINDER, `v${v} 오른쪽 위`);
    assert.deepEqual(block(rows, n - 7, 0, 7), FINDER, `v${v} 왼쪽 아래`);
    // 분리자: 파인더 바로 바깥 한 칸은 전부 밝다
    assert.equal(rows[7].slice(0, 8), '00000000', `v${v} 왼쪽 위 아래 띠`);
    assert.equal(rows[7].slice(n - 8), '00000000', `v${v} 오른쪽 위 아래 띠`);
    assert.equal(rows[n - 8].slice(0, 8), '00000000', `v${v} 왼쪽 아래 위 띠`);
    for (let r = 0; r < 8; r++) {
      assert.equal(rows[r][7], '0');
      assert.equal(rows[r][n - 8], '0');
      assert.equal(rows[n - 1 - r][7], '0');
    }
  }
});

test('타이밍 패턴 — 행 6·열 8 이 파인더 사이에서 번갈아 뛴다, 어두운 모듈 (size−8, 8)', () => {
  const out = encode('timing', { version: 3 });
  const rows = rowsOf(out);
  const n = out.size;
  for (let i = 8; i < n - 8; i++) {
    assert.equal(rows[6][i], i % 2 === 0 ? '1' : '0', `행 6 열 ${i}`);
    assert.equal(rows[i][6], i % 2 === 0 ? '1' : '0', `열 6 행 ${i}`);
  }
  assert.equal(rows[n - 8][8], '1');
});

test('정렬 패턴 — 버전 2 는 (18,18) 중심 5×5', () => {
  const out = encode('align', { version: 2 });
  const rows = rowsOf(out);
  assert.deepEqual(block(rows, 16, 16, 5), ['11111', '10001', '10101', '10001', '11111']);
});

// ── 형식·버전 정보 ───────────────────────────────────────────────

const FORMAT_M = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0];

test('형식 정보 (EC M, 마스크 0~7) 는 표준 표와 같다', () => {
  FORMAT_M.forEach((expected, mask) => assert.equal(formatBits(mask), expected, `mask ${mask}`));
});

/** 행렬에서 형식 정보를 두 사본 모두 읽는다 (MSB 가 (8,0)). */
function readFormat(rows) {
  const n = rows.length;
  const a = [];
  for (let i = 0; i <= 5; i++) a.push(rows[8][i]);
  a.push(rows[8][7], rows[8][8], rows[7][8]);
  for (let i = 5; i >= 0; i--) a.push(rows[i][8]);
  const b = [];
  for (let i = 0; i <= 6; i++) b.push(rows[n - 1 - i][8]);
  for (let i = 0; i <= 7; i++) b.push(rows[8][n - 8 + i]);
  return { first: parseInt(a.join(''), 2), second: parseInt(b.join(''), 2) };
}

test('행렬의 형식 정보 두 사본이 선택된 마스크의 형식 비트와 같다', () => {
  for (const mask of [0, 5, 7]) {
    const out = encode('format', { mask });
    const { first, second } = readFormat(rowsOf(out));
    assert.equal(first, formatBits(mask), `첫 사본 mask ${mask}`);
    assert.equal(second, formatBits(mask), `둘째 사본 mask ${mask}`);
  }
  const auto = encode('자동 마스크');
  const { first } = readFormat(rowsOf(auto));
  assert.equal(first, formatBits(auto.mask));
});

test('버전 정보 (7~10) 는 표준 표와 같고 버전 7 행렬의 두 사본에 박힌다', () => {
  assert.equal(versionBits(7), 0x07c94);
  assert.equal(versionBits(8), 0x085bc);
  assert.equal(versionBits(9), 0x09a99);
  assert.equal(versionBits(10), 0x0a4d3);

  const out = encode('v', { version: 7 });
  const rows = rowsOf(out);
  const n = out.size;
  const vb = versionBits(7);
  for (let i = 0; i < 18; i++) {
    const a = n - 11 + (i % 3);
    const b = Math.floor(i / 3);
    const expected = String((vb >>> i) & 1);
    assert.equal(rows[a][b], expected, `버전 비트 ${i} (아래 사본)`);
    assert.equal(rows[b][a], expected, `버전 비트 ${i} (오른쪽 사본)`);
  }
  // 버전 6 이하에는 버전 정보가 없다 — 그 자리는 데이터라 매번 같지 않으므로 존재 여부만 본다
  assert.equal(encode('v', { version: 6 }).size, 41);
});

// ── 용량·버전 선택 ───────────────────────────────────────────────

test('바이트 모드 용량 (EC M): 1→14 · 2→26 · 3→42 · 9→180 · 10→213', () => {
  assert.equal(byteCapacity(1), 14);
  assert.equal(byteCapacity(2), 26);
  assert.equal(byteCapacity(3), 42);
  assert.equal(byteCapacity(9), 180);
  assert.equal(byteCapacity(10), 213);
});

test('최소 버전 선택과 용량 초과', () => {
  assert.equal(pickVersion(0), 1);
  assert.equal(pickVersion(14), 1);
  assert.equal(pickVersion(15), 2);
  assert.equal(pickVersion(27), 3);
  assert.equal(pickVersion(213), 10);
  assert.equal(pickVersion(214), null);
  assert.throws(() => encode('x'.repeat(214)), /용량/);
  assert.equal(encode('x'.repeat(213)).version, 10);
  assert.throws(() => encode('a', { version: 11 }), /version/);
  assert.throws(() => encode('a', { mask: 8 }), /mask/);
});

test('한글 partId 도 UTF-8 바이트로 넣는다 — 6바이트면 버전 1', () => {
  const out = encode('측판');
  assert.equal(out.version, 1);
  assert.equal(out.size, 21);
});

// ── RS ───────────────────────────────────────────────────────────

test('RS 생성 다항식 차수 2 = x² + α¹x + α¹ (계수 1, 3, 2)', () => {
  // (x + α⁰)(x + α¹) = x² + (α⁰+α¹)x + α¹ = x² + 3x + 2
  assert.deepEqual(rsGenerator(2), [1, 3, 2]);
});

test('RS 잔여를 이어 붙인 코드워드는 생성 다항식으로 나누어떨어진다', () => {
  const data = [0x40, 0x54, 0x84, 0x54, 0xc4, 0xc4, 0xf0, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec];
  const ec = rsEncode(data, 10);
  assert.equal(ec.length, 10);
  // 재인코딩: data+ec 를 다시 나누면 잔여가 0 이어야 한다
  const again = rsEncode([...data, ...ec], 10);
  assert.ok(again.every((b) => b === 0), `잔여 ${again}`);
});

// ── 마스크 벌점 ──────────────────────────────────────────────────

test('벌점 — 전부 같은 색이면 N1·N2·N4 가 크고, 체스판이면 0 에 가깝다', () => {
  const n = 21;
  const solid = Array.from({ length: n }, () => new Uint8Array(n).fill(1));
  const checker = Array.from({ length: n }, (_, r) => Uint8Array.from({ length: n }, (_, c) => (r + c) % 2));
  assert.ok(penalty(solid) > 1000);
  assert.equal(penalty(checker), 0);
});

// ── SVG ──────────────────────────────────────────────────────────

test('toSvgPath 는 행마다 연속 모듈을 한 사각형으로 묶는다', () => {
  const m = [Uint8Array.from([1, 1, 0]), Uint8Array.from([0, 1, 0]), Uint8Array.from([0, 0, 0])];
  assert.equal(toSvgPath(m), 'M0 0h2v1h-2zM1 1h1v1h-1z');
  assert.equal(toSvgPath(m, 4), 'M4 4h2v1h-2zM5 5h1v1h-1z');
});

test('qrSvg — 여백 4 를 두고 viewBox 가 (size+8) 이며 원문이 HTML 에 들어가지 않는다', () => {
  const svg = qrSvg('<img src=x onerror=alert(1)>');
  assert.ok(svg.startsWith('<svg class="qr" viewBox="0 0 37 37"'), svg.slice(0, 60)); // 28B → v3(29) + 8
  assert.ok(!svg.includes('<img'));
  assert.ok(svg.includes('<path d="M'));
});

// ── 되읽기 — 배치·마스크·모드 머리가 스스로 맞는지 ──────────────

/** 기능 패턴 자리 (버전 1~6, 정렬 1개 이하) — 인코더와 별도로 적는다. */
function functionMask(version) {
  const n = 17 + 4 * version;
  const f = Array.from({ length: n }, () => new Uint8Array(n));
  const fill = (r0, c0, h, w) => {
    for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) if (r >= 0 && c >= 0 && r < n && c < n) f[r][c] = 1;
  };
  fill(0, 0, 9, 9); fill(0, n - 8, 9, 8); fill(n - 8, 0, 8, 9);
  for (let i = 0; i < n; i++) { f[6][i] = 1; f[i][6] = 1; }
  const align = { 2: 18, 3: 22, 4: 26, 5: 30, 6: 34 }[version];
  if (align) fill(align - 2, align - 2, 5, 5);
  return f;
}

const MASK_FN = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function readBytes(out) {
  const n = out.size;
  const f = functionMask(out.version);
  const bits = [];
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let k = 0; k < n; k++) {
      const r = upward ? n - 1 - k : k;
      for (const c of [right, right - 1]) {
        if (f[r][c]) continue;
        const raw = out.modules[r][c];
        bits.push(MASK_FN[out.mask](r, c) ? raw ^ 1 : raw);
      }
    }
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  return bytes;
}

test('행렬을 되읽으면 모드 0100 · 길이 · UTF-8 바이트 · 패딩 EC 11 순으로 나온다', () => {
  for (const text of ['HELLO', '0-l1-door#0-0#1', '측판 #2']) {
    const out = encode(text);
    const utf8 = Array.from(new TextEncoder().encode(text));
    const bytes = readBytes(out);
    // 4비트 모드 + 8비트 길이 → 첫 바이트 = 0x40 | (len >> 4), 둘째 바이트 상위 4비트 = len & 0xF
    assert.equal(bytes[0] >> 4, 0b0100, `${text} 모드`);
    const len = ((bytes[0] & 0x0f) << 4) | (bytes[1] >> 4);
    assert.equal(len, utf8.length, `${text} 길이`);
    for (let i = 0; i < utf8.length; i++) {
      const b = ((bytes[1 + i] & 0x0f) << 4) | (bytes[2 + i] >> 4);
      assert.equal(b, utf8[i], `${text} 바이트 ${i}`);
    }
    // 머리 12비트 + 8·len + 종단 4비트 = 바이트 정렬 → 그 뒤는 패딩 EC 11 EC 11 …
    // (버전 1~3 은 단일 블록이라 데이터 코드워드가 앞에 연달아 있다)
    const dataLen = { 1: 16, 2: 28, 3: 44 }[out.version];
    const tail = bytes.slice(2 + utf8.length, dataLen);
    assert.ok(tail.length >= 1, `${text} 패딩 있음`);
    tail.forEach((b, i) => assert.equal(b, i % 2 ? 0x11 : 0xec, `${text} 패딩 ${i}`));
  }
});
