/**
 * 단가 규칙 로드 + 조회.
 *
 * 단가는 코드가 아니라 Supabase 의 pricing_rules 에 있다. 영업/대표가
 * SQL 한 줄로 바꿀 수 있어야 하고, 배포를 기다릴 이유가 없기 때문이다.
 * 고객 견적은 장당 견적(quote-sheet.js)이라 지금은 범위 배수(range)만 읽는다 — m당 단가 견적은 그만두었다.
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

    /** 확인서의 "최종 금액 범위" 배수 — 장당 견적이 단가표에서 읽는 것은 이것뿐이다 */
    rangeMin: () => get('range', 'min'),
    rangeMax: () => get('range', 'max'),
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
