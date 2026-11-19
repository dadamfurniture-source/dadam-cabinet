/**
 * 설계에서 고른 설비 상품 — 간편 플래너가 벽 품목 사양에 실어 보내는 `specs.fixtureParts`
 * (2026-11-19 사장님 「개수대 모듈 클릭하면 수전, 싱크볼 … 선택 … 후드장도 … 가스대도」 · 질문 창 「앱으로 보낼 때 같이」).
 *
 *   [{ slot: sink|faucet|cooktop|hood, label, name, vendor, option }] — 이름 · 공급 회사 · 옵션 글뿐이다 (값 · 치수 없음).
 *   상품은 그 팩토리의 「철물 · 부속 카탈로그」에서 고른 것이라 공용 가전 카탈로그(appliance_models)의 타공 치수와는 이어지지 않는다 —
 *   지시서에는 이름만 적는다. 모르는 자리 · 깨진 값은 버린다 (동결본은 사람이 못 고치지만 옛 판 · 다른 출처의 설계도 같은 길로 온다).
 */

export const FIXTURE_PART_LABELS = Object.freeze({ sink: '싱크볼', faucet: '수전', cooktop: '쿡탑', hood: '후드' });
/** 품목 하나에서 읽는 상품 수 */
export const FIXTURE_PARTS_MAX = 40;

const text = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

/** 품목 하나의 설비 상품 — [{ slot, label, name, vendor, option }] */
export function fixturePartsOfItem(item) {
  const raw = item && item.specs && Array.isArray(item.specs.fixtureParts) ? item.specs.fixtureParts : [];
  const out = [];
  for (const p of raw.slice(0, FIXTURE_PARTS_MAX)) {
    if (!p || typeof p !== 'object' || !Object.prototype.hasOwnProperty.call(FIXTURE_PART_LABELS, p.slot)) continue;
    const name = text(p.name, 160);
    if (!name) continue;
    out.push({ slot: p.slot, label: FIXTURE_PART_LABELS[p.slot], name, vendor: text(p.vendor, 40), option: text(p.option, 80) });
  }
  return out;
}

/** 한 줄 글 — 「이름 (옵션)」 */
export const fixturePartText = (p) => (p.option ? `${p.name} (${p.option})` : p.name);

/**
 * 품목들에서 자리마다 고른 상품 이름 — { sink?, faucet?, cooktop?, hood? } (서로 다른 상품이 여럿이면 「 / 」로 잇는다).
 * 상판 발주서가 모델(appliance_models)이 없는 타공 줄에 이름을 같이 적는다.
 */
export function fixturePartNames(items) {
  const by = {};
  (Array.isArray(items) ? items : []).forEach((it) => fixturePartsOfItem(it).forEach((p) => {
    const t = fixturePartText(p);
    if (!by[p.slot]) by[p.slot] = [];
    if (!by[p.slot].includes(t)) by[p.slot].push(t);
  }));
  return Object.fromEntries(Object.entries(by).map(([slot, list]) => [slot, list.join(' / ')]));
}
