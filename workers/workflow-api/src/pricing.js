/**
 * 단가 규칙 로드 + 조회.
 *
 * 단가는 코드가 아니라 Supabase 의 pricing_rules 에 있다. 영업/대표가
 * SQL 한 줄로 바꿀 수 있어야 하고, 배포를 기다릴 이유가 없기 때문이다.
 *
 * rule set 은 불변(immutable)이다. 단가를 바꾸려면 새 version 을 만들고
 * is_active 를 옮긴다. 문서에는 rule_set_id 를 핀으로 박으므로 몇 달 뒤에
 * 다시 렌더해도 같은 금액이 나온다.
 */

import { selectOne, selectMany, DbError } from './supabase.js';

/** rule_set_id → pricebook. 불변이라 만료가 필요 없다. */
const bookCache = new Map();

/** 활성 세트 조회 결과만 TTL 을 둔다 (활성 전환을 반영해야 하므로). */
let activeCache = { id: null, at: 0 };

function ttlMs(env) {
  return (parseInt(env.PRICING_CACHE_TTL_SEC || '300', 10) || 300) * 1000;
}

/**
 * 규칙 배열을 조회용 인덱스로 만든다.
 * key 형식: `${kind}|${key}|${grade}`
 */
function indexRules(rules) {
  const map = new Map();
  for (const r of rules) {
    map.set(`${r.kind}|${r.key}|${r.grade}`, Number(r.amount));
  }
  return map;
}

function makePricebook(ruleSet, rules) {
  const idx = indexRules(rules);

  /** grade 전용 값이 없으면 '*' 로 폴백한다. */
  const get = (kind, key, grade = '*') => {
    const exact = idx.get(`${kind}|${key}|${grade}`);
    if (exact !== undefined) return exact;
    const wildcard = idx.get(`${kind}|${key}|*`);
    return wildcard !== undefined ? wildcard : null;
  };

  return {
    ruleSetId: ruleSet.id,
    version: ruleSet.version,
    ruleCount: rules.length,

    /** 캐비닛 본체. position 은 'lower' | 'upper'. */
    cabinet: (category, position) => get('cabinet', `${category}.${position}`),
    countertop: (grade) => get('countertop', 'default', grade),
    fixture: (key, grade) => get('fixture', key, grade),
    labor: (key) => get('labor', key),
    vatRate: () => {
      const v = get('vat', 'rate');
      return v === null ? 0 : v;
    },
    rangeMin: () => get('range', 'min'),
    rangeMax: () => get('range', 'max'),

    /**
     * 기본 도어 단가 (₩/m²).
     * 이 행이 없으면 도어 마감 업차지를 계상하지 않는다 — CABINET_PRICES 에
     * 기본 도어가 포함돼 있다고 보면 baseline 없이 업차지를 더할 경우
     * 도어값이 이중 계상되기 때문. 값이 확정되면 시드에 행을 추가하면 된다.
     */
    doorBaseline: () => get('door_baseline', 'default'),

    /**
     * 도어 자재 코드 → 단가 (₩/m²).
     * mcp-server/src/config/bom-rules.defaults.ts:145 getDoorFinishPrice 포팅.
     * 49 조합을 테이블에 펼치지 않고 base 7 × mult 7 로 조합한다.
     */
    doorFinishPrice: (finishCode) => {
      if (!finishCode || finishCode === 'MDF-DEFAULT') return null;
      const parts = String(finishCode).split('-');
      if (parts.length < 2) return null;

      let baseKey;
      let colorCode;
      if (parts.length === 3) {
        // FINISH-COLOR-TONE (예: PET-OAK-M)
        baseKey = `${parts[0]}-${parts[2]}`;
        colorCode = parts[1];
      } else {
        // FINISH-COLOR (single tone, 예: MFB-WHT)
        baseKey = parts[0];
        colorCode = parts[1];
      }

      const base = get('door_finish_base', baseKey);
      if (base === null) return null;
      const mult = get('door_color_mult', colorCode);
      return Math.round(base * (mult === null ? 1.0 : mult));
    },
  };
}

/** 특정 rule set 의 pricebook. 없으면 조회 후 캐시. */
export async function getPricebookById(env, ruleSetId) {
  if (bookCache.has(ruleSetId)) return bookCache.get(ruleSetId);

  const ruleSet = await selectOne(env, 'pricing_rule_sets', {
    id: `eq.${ruleSetId}`,
    select: '*',
  });
  if (!ruleSet) throw new DbError(`단가 규칙 세트를 찾을 수 없습니다: ${ruleSetId}`, 500);

  const rules = await selectMany(env, 'pricing_rules', {
    rule_set_id: `eq.${ruleSetId}`,
    select: 'kind,key,grade,unit,amount',
    limit: '2000',
  });

  const book = makePricebook(ruleSet, rules || []);
  bookCache.set(ruleSetId, book);
  return book;
}

/** 현재 활성 rule set 의 pricebook. */
export async function getActivePricebook(env) {
  const now = Date.now();
  if (activeCache.id && now - activeCache.at < ttlMs(env)) {
    const cached = bookCache.get(activeCache.id);
    if (cached) return cached;
  }

  const ruleSet = await selectOne(env, 'pricing_rule_sets', {
    is_active: 'eq.true',
    select: '*',
  });
  if (!ruleSet) {
    throw new DbError(
      '활성 단가 규칙 세트가 없습니다. database/workflow-pricing-seed.sql 을 실행하세요.',
      500,
    );
  }

  activeCache = { id: ruleSet.id, at: now };
  return getPricebookById(env, ruleSet.id);
}

/** 테스트용 — 순수 함수로 pricebook 을 만든다. */
export { makePricebook };
