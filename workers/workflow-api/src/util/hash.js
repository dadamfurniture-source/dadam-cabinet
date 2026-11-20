/**
 * canonical JSON + SHA-256.
 *
 * content_hash 는 "이 설계가 내용상 같은가"를 판정하는 유일한 기준이다.
 * (designs.updated_at / total_items 는 update_design_stats_trigger 가
 *  design_items 변경마다 갱신해 버려서 판정에 쓸 수 없다.)
 *
 * 따라서 내용과 무관하게 변하는 필드를 반드시 걷어내야 한다. 그러지 않으면
 * 같은 설계인데도 rev 가 무한히 늘어나고 "재발행 필요" 배지가 상시 켜진다.
 */

/**
 * 해시에서 제외하는 필드.
 *
 * exportDate         : DadamAgent.exportDesign() 이 호출할 때마다 새 타임스탬프를
 *                      넣는다 (config-constants.js:94). 그대로 두면 해시가 매번 달라진다.
 * extractDate        : MaterialExtractor.extract() 도 동일 (extractors.js:68).
 * appVersion         : 앱 버전 범프가 고객 문서를 무효화해서는 안 된다.
 *                      (버전 변경으로 BOM 산출이 실제로 달라지면 bom_payload 가
 *                       바뀌므로 해시에도 정상 반영된다.)
 * uniqueId           : Date.now()+Math.random() 부동소수인데 저장 시 Math.floor 되어
 *                      (persistence-init.js:1105) 재열기 전후 값이 달라진다.
 * id (모듈)          : calc-engine.js:517 에서 Date.now()+Math.random() 로 재발급된다.
 *                      자동계산을 다시 돌리면 배치가 같아도 값이 전부 바뀐다.
 * _x                 : 렌더링용 계산 오프셋. 영속 의도가 없다.
 * prevUpperModules   : 자동계산 undo 버퍼 (calc-engine.js:639-642). 설계 내용이 아니다.
 * prevLowerModules   : 위와 동일.
 *
 * CD-6 학습 데이터 (_learning / _autoCalc)
 *   자동계산이 낸 값과 사용자 최종값의 차이를 담는다. **설계 내용이 아니라
 *   거기에 이르는 과정의 메타데이터**다. 최종 설계가 같다면 도달 경로가 달라도
 *   같은 스냅샷이어야 하므로 해시에서 뺀다.
 *   빼지 않으면 자동계산을 한 번 더 돌리는 것만으로 rev 가 늘어난다.
 *   (payload 에는 그대로 저장된다 — 학습 재료는 남고 멱등성만 지킨다)
 */
const EXCLUDED_KEYS = new Set([
  'exportDate',
  'extractDate',
  'appVersion',
  'uniqueId',
  'id',
  '_x',
  'prevUpperModules',
  'prevLowerModules',
  '_learning',
  '_autoCalc',
]);

/** 부동소수 오차가 해시를 흔들지 않도록 자리수를 고정한다. */
function normalizeNumber(n) {
  if (!Number.isFinite(n)) return null; // NaN / Infinity → null (JSON 과 동일)
  const r = Math.round(n * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r; // -0 을 0 으로 정규화
}

/**
 * 키를 정렬하고 제외 필드를 걷어낸 정규 구조를 만든다.
 * 배열 순서는 의미가 있으므로(아이템/모듈 배치 순서) 정렬하지 않는다.
 */
export function canonicalize(value) {
  if (value === null || value === undefined) return null;

  const t = typeof value;
  if (t === 'number') return normalizeNumber(value);
  if (t === 'boolean' || t === 'string') return value;
  if (t === 'function' || t === 'symbol') return null;

  if (Array.isArray(value)) {
    return value.map((v) => canonicalize(v));
  }

  if (t === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (EXCLUDED_KEYS.has(key)) continue;
      out[key] = canonicalize(value[key]);
    }
    return out;
  }

  return null;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

/** WebCrypto SHA-256 → 소문자 hex. */
export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 재단 배치의 판정용 요약 — **재단 방식을 고른 배치만** (cutPlan.strategy 가 있을 때).
 *
 * 재단 방식이 없는 배치는 같은 BOM 이면 늘 같은 배치라 판정에 넣지 않았다 (bom-protocol §7-3).
 * 재단 방식을 고르면(간편 플래너 — 표준 · 부재 최적화 · 최소 재단) 같은 BOM 에서도 배치가 달라진다.
 * 그 배치로 작업지시서의 재단 꾸러미가 나가므로, 방식이나 배치가 바뀌면 새 리비전이어야 한다.
 *
 * 넣는 것은 재단 결과를 정하는 값뿐이다: 방식, 원판마다 번호 · 자재 · 두께 · 색 · 크기, 조각마다 partId · 자리 · 치수 · 눕힘.
 * 수율 · 자르는 횟수 · 후보 수 같은 셈값은 넣지 않는다 (같은 배치에서 파생된다).
 * 재단 방식이 없으면 null — 그때 snapshotHash 는 예전과 같은 값을 낸다.
 */
export function cutDigestOf(cutPlan) {
  if (!cutPlan || typeof cutPlan !== 'object' || typeof cutPlan.strategy !== 'string' || !cutPlan.strategy) return null;
  const sheets = Array.isArray(cutPlan.sheets) ? cutPlan.sheets : [];
  // 재단기 파일 (cutPlan.cnc — 2026-11-19) — 있을 때만 넣는다: 파일 이름 · 화면 값이 지시서에 실리므로, 처음 실어 보낸 판은 새 리비전이다.
  //   없는 배치(옛 플래너)는 예전과 같은 값이다
  const cnc = cutPlan.cnc && typeof cutPlan.cnc === 'object' && Array.isArray(cutPlan.cnc.files)
    ? {
        files: cutPlan.cnc.files.map((f) => ({ name: f && f.name, sheetNos: f && Array.isArray(f.sheetNos) ? f.sheetNos : [], length: f && f.length, width: f && f.width, lead: f && f.lead })),
        problems: (Array.isArray(cutPlan.cnc.problems) ? cutPlan.cnc.problems : []).map((p) => ({ sheetNo: p && p.sheetNo, reason: p && p.reason })),
      }
    : null;
  // 소부품 더하기 · 빼기 (cutPlan.smallMode · bandStock — 2026-11-20) — 있을 때만: 재고에서 꺼낼 밴드가 지시서에 실린다. 없는 배치는 예전과 같은 값이다
  const band = cutPlan.bandStock && typeof cutPlan.bandStock === 'object' && Array.isArray(cutPlan.bandStock.groups)
    ? {
        width: cutPlan.bandStock.width,
        length: cutPlan.bandStock.length,
        groups: cutPlan.bandStock.groups.map((g) => ({
          color: g && g.color != null ? g.color : '',
          cuts: (g && Array.isArray(g.cuts) ? g.cuts : []).map((c) => (c && Array.isArray(c.pieces) ? c.pieces : []).map((p) => ({ partId: p && p.partId, len: p && p.len }))),
        })),
      }
    : null;
  return {
    ...(cnc ? { cnc } : {}),
    ...(typeof cutPlan.smallMode === 'string' && cutPlan.smallMode ? { smallMode: cutPlan.smallMode } : {}),
    ...(band ? { bandStock: band } : {}),
    strategy: cutPlan.strategy,
    sheets: sheets.map((s) => ({
      no: s.no,
      material: s.material,
      thickness: s.thickness,
      color: s.color == null ? '' : s.color,
      size: s.size ? { w: s.size.w, h: s.size.h } : null,
      parts: (Array.isArray(s.parts) ? s.parts : []).map((p) => ({ partId: p.partId, x: p.x, y: p.y, w: p.w, h: p.h, rot: Boolean(p.rot) })),
    })),
  };
}

/**
 * 스냅샷 content_hash.
 * 설계와 BOM 을 함께 해싱한다 — BOM 산출 로직이 바뀌면 같은 설계라도
 * 다른 자재 목록이 나오므로 새 리비전이어야 한다.
 * cutDigest (cutDigestOf — 재단 방식을 고른 배치) 가 있으면 그것도 함께. 없으면 예전과 같은 값이다.
 */
export async function snapshotHash(designPayload, bomPayload, cutDigest = null) {
  const body = { design: designPayload, bom: bomPayload };
  if (cutDigest) body.cut = cutDigest;
  return sha256Hex(canonicalJson(body));
}

/**
 * pepper 를 섞은 단방향 해시 (공유 토큰 / PIN / IP 용).
 *
 * 각 조각에 길이를 접두한 뒤 합친다. 단순 연결이면 ('ab','c') 와 ('a','bc') 가
 * 같은 해시를 내는데, PIN 검증에 (documentId, pin) 을 함께 넣는 용도라
 * 경계가 모호해지면 다른 문서의 PIN 이 통과할 수 있다.
 */
export async function pepperedHash(pepper, ...parts) {
  const payload = [pepper || '', ...parts]
    .map((p) => {
      const s = String(p ?? '');
      return `${s.length}:${s}`;
    })
    .join('|');
  return sha256Hex(payload);
}
