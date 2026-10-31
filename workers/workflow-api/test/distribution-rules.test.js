/**
 * 상담 분배 — 거르기 · 점수 · 순위 (순수 함수: src/distribution/rules.js · score.js · data.js 의 통계 · catalog.js 검사)
 * 와 새 상담 배정 앱 알림 글 (src/push/messages.js consult_assigned).
 * 시험 데이터는 모두 가짜다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/distribution/rules.js';
import {
  customerItems,
  poolReasons,
  isPoolCompany,
  serviceRegions,
  filterReasons,
  evalScore,
  fitScore,
  otherScore,
  itemRecordCount,
  itemRecordPoints,
  pricePoints,
  designPoints,
  scoreCompany,
  rankCandidates,
  satisfactionOf,
  responseRateOf,
  kstToday,
  kstMonthStartMs,
} from '../src/distribution/score.js';
import { assignmentStats, orderStats } from '../src/distribution/data.js';
import {
  parseEvaluation,
  evaluationCatalog,
  docsOk,
  EQUIPMENT,
  STAFF_ROLES,
  SUPPLIERS,
  SUPPLIER_GROUPS,
  DESIGN,
  ITEM_KEYS,
} from '../src/distribution/catalog.js';
import { evaluationScore, gradeOf, EVAL_AREAS } from '../src/distribution/grade.js';
import {
  buildMessage,
  isValidMessage,
  CONSULT_ITEM_LABELS,
  PARTNER_CONSULTS_URL,
  BODY_MAX,
  charLen,
} from '../src/push/messages.js';
import { FURNITURE_LABELS } from '../src/consult-notify.js';

const NOW = Date.parse('2026-10-30T03:00:00Z'); // KST 10-30 12:00
const DOCS = {
  insurance: { checked_at: '2026-10-01T00:00:00Z', by: 'u' },
  contract: { checked_at: '2026-10-01T00:00:00Z', by: 'u' },
};

const company = (id, extra = {}) => ({
  id,
  kind: 'partner',
  name: id,
  plan: 'agent',
  status: 'active',
  sido: '서울특별시',
  gugun: '강남구',
  ...extra,
});
const settings = (extra = {}) => ({
  regions: [{ sido: '서울특별시', gugun: '강남구' }],
  items: { sink: 'do' },
  monthly_limit: 10,
  lead_days: 10,
  ...extra,
});
const consult = (extra = {}) => ({
  sido: '서울특별시',
  gugun: '강남구',
  furniture_categories: ['sink'],
  door_finish: null,
  wanted_price_tier: null,
  wanted_done_date: null,
  request_detail_design: false,
  ...extra,
});
const stats = (extra = {}) => ({
  monthCount: 0,
  recentCount: 0,
  lastAssignedAt: null,
  respondedCount: 0,
  fastAcceptCount: 0,
  feedbackCount: 0,
  feedbackSum: 0,
  recentOrderCount: 0,
  cleanOrderCount: 0,
  inProgressCount: 0,
  completedItems: [],
  ...extra,
});

// ── 대표 확인 규칙 ─────────────────────────────────────────────

test('위치 — 같은 시/군/구 15 · 같은 시/도 10 · 그 밖 5 (상수는 rules.js)', () => {
  assert.equal(R.LOCATION_SAME_GUGUN, 15);
  assert.equal(R.LOCATION_SAME_SIDO, 10);
  assert.equal(R.LOCATION_OTHER, 5);
  const c = company('a');
  assert.deepEqual(R.locationScore(consult(), c), { sum: 15, why: 'same_gugun' });
  assert.deepEqual(R.locationScore(consult({ gugun: '송파구' }), c), { sum: 10, why: 'same_sido' });
  assert.deepEqual(
    R.locationScore(consult({ sido: '경기도', gugun: '강남구' }), c),
    { sum: 5, why: 'other' },
    '시/도가 다르면 같은 이름 구도 그 밖'
  );
  assert.deepEqual(R.locationScore(consult({ sido: null, gugun: null }), c), {
    sum: 5,
    why: 'other',
  });
  assert.deepEqual(R.locationScore(consult(), company('b', { sido: null, gugun: null })), {
    sum: 5,
    why: 'other',
  });
});

test('고객 가격대 — 같음 5 · 한 칸 1.7 · 그 밖 0, 모름 · 빈 값이면 모든 업체 2.5', () => {
  assert.equal(R.customerPriceTier(consult({ wanted_price_tier: 'mid' })), 'mid');
  assert.equal(R.customerPriceTier(consult({ wanted_price_tier: 'unknown' })), null);
  assert.equal(R.customerPriceTier(consult({ wanted_price_tier: null })), null);
  assert.equal(R.customerPriceTier(consult({ wanted_price_tier: 'premium' })), null);
  const ev = (price_tier) => ({ price_tier });
  assert.equal(pricePoints(consult({ wanted_price_tier: 'mid' }), ev('mid')), 5, '같음');
  assert.equal(pricePoints(consult({ wanted_price_tier: 'mid' }), ev('high')), 1.7, '한 칸');
  assert.equal(pricePoints(consult({ wanted_price_tier: 'basic' }), ev('mid')), 1.7, '한 칸');
  assert.equal(pricePoints(consult({ wanted_price_tier: 'basic' }), ev('high')), 0, '두 칸');
  assert.equal(
    pricePoints(consult({ wanted_price_tier: 'high' }), ev(null)),
    0,
    '업체 가격대 없음'
  );
  assert.equal(pricePoints(consult({ wanted_price_tier: 'high' }), null), 0);
  for (const t of ['unknown', null]) {
    assert.equal(pricePoints(consult({ wanted_price_tier: t }), ev('high')), 2.5);
    assert.equal(pricePoints(consult({ wanted_price_tier: t }), null), 2.5);
  }
});

test('희망 시기 — 마칠 수 있는 날(오늘 + 기간)이 시공 완료 희망 날짜 안 5 · 14일 안 늦음 2.5 · 그 밖 0, 희망 날짜 없으면 5', () => {
  const today = '2026-10-30';
  assert.equal(R.LEAD_DAYS_MIN, 1);
  assert.equal(R.LEAD_DAYS_MAX, 14);
  assert.equal(R.TIMING_LATE_DAYS, 14);
  assert.equal(R.timingScore(null, 14, today), 5);
  assert.equal(R.timingScore('2026-12-31', 14, today), 5);
  assert.equal(R.timingScore('2026-11-09', 10, today), 5, '같은 날');
  assert.equal(R.timingScore('2026-11-09', 11, today), 2.5, '1일 늦음');
  assert.equal(R.timingScore('2026-10-30', 14, today), 2.5, '14일');
  assert.equal(R.timingScore('2026-10-29', 14, today), 0, '15일 — 지난 희망 날짜');
  assert.equal(
    R.timingScore('2026-11-09', null, today),
    0,
    '기간이 없으면 잴 수 없음 (거르기에서 빠진다)'
  );
  assert.equal(R.timingScore('언젠가', 10, today), 5, '날짜 모양이 아니면 희망 날짜 없음');
});

test('한 달 한도 · 고객 확정 ~ 시공 완료 기간을 정하지 않은 업체는 거른다 (limit · period)', () => {
  assert.equal(R.REQUIRE_MONTHLY_LIMIT, true);
  assert.equal(R.REQUIRE_LEAD_DAYS, true);
  const base = {
    consult: consult(),
    items: ['sink'],
    company: company('a'),
    evaluation: { docs: DOCS },
    stats: stats(),
  };
  assert.deepEqual(filterReasons({ ...base, settings: settings({ monthly_limit: null }) }), [
    'limit',
  ]);
  assert.deepEqual(filterReasons({ ...base, settings: settings({ lead_days: null }) }), ['period']);
  assert.deepEqual(
    filterReasons({ ...base, settings: null }),
    ['item', 'limit', 'period'],
    '설정이 없으면 지역은 주소로, 품목 · 한도 · 기간 없음'
  );
});

test('거친 업체 — 같은 상담을 못 받음 · 무응답으로 돌려보낸 업체는 거른다 (tried)', () => {
  assert.deepEqual(R.TRIED_STATES, ['declined', 'expired']);
  assert.ok(R.FILTER_REASONS.includes('tried'));
  const base = {
    consult: consult(),
    items: ['sink'],
    company: company('a'),
    settings: settings(),
    evaluation: { grade: 'B', docs: DOCS },
    stats: stats(),
  };
  assert.deepEqual(filterReasons(base), []);
  assert.deepEqual(filterReasons({ ...base, tried: true }), ['tried']);
  assert.deepEqual(
    filterReasons({ ...base, company: company('a', { plan: 'expert' }), tried: true }),
    ['tier'],
    '풀 밖 업체는 풀 이유만'
  );

  const companies = [company('a', { name: '가' }), company('b', { name: '나' })];
  const by = (v) => new Map(companies.map((c) => [c.id, v]));
  const { ranked, filtered } = rankCandidates({
    consult: consult(),
    items: ['sink'],
    companies,
    settingsBy: by(settings()),
    evaluationBy: by({ grade: 'B', docs: DOCS }),
    statsBy: by(stats()),
    triedIds: new Set(['a']),
    nowMs: NOW,
  });
  assert.deepEqual(
    ranked.map((c) => [c.company.id, c.rank]),
    [['b', 1]]
  );
  assert.deepEqual(filtered, [{ company_id: 'a', company_name: '가', reasons: ['tried'] }]);
});

// ── 거르기 ────────────────────────────────────────────────────

test('업체 풀 — 다담 공장 · 활동 중 Agent. Expert 는 tier, 정지 · 해지 · 신청 중은 inactive', () => {
  assert.deepEqual(poolReasons({ kind: 'hq', plan: null, status: 'active' }), []);
  assert.deepEqual(poolReasons(company('a')), []);
  assert.deepEqual(poolReasons(company('e', { plan: 'expert' })), ['tier']);
  assert.deepEqual(poolReasons(company('s', { status: 'suspended' })), ['inactive']);
  assert.deepEqual(poolReasons(company('x', { plan: 'expert', status: 'closed' })), [
    'tier',
    'inactive',
  ]);
  assert.deepEqual(poolReasons(company('m', { status: 'meeting' })), ['inactive']);
  assert.equal(
    isPoolCompany({ kind: 'platform', status: 'active' }),
    false,
    '다담 본사는 풀이 아니다'
  );
  assert.equal(isPoolCompany({ kind: 'hq', status: 'active' }), true);
});

test('풀 밖 업체는 풀 이유만 싣는다', () => {
  const r = filterReasons({
    consult: consult({ sido: '부산광역시' }),
    items: ['sink'],
    company: company('e', { plan: 'expert' }),
    settings: null,
    evaluation: null,
    stats: null,
  });
  assert.deepEqual(r, ['tier']);
});

test('지역 — 설정한 지역, 비면 업체 주소 시/군/구 하나. 고객 지역이 없으면 탈락', () => {
  const c = company('a');
  assert.deepEqual(serviceRegions(settings({ regions: [] }), c), [
    { sido: '서울특별시', gugun: '강남구' },
  ]);
  assert.deepEqual(serviceRegions(null, company('b', { sido: null })), []);
  const base = { items: ['sink'], company: c, evaluation: { docs: DOCS }, stats: stats() };
  assert.deepEqual(
    filterReasons({ ...base, consult: consult(), settings: settings({ regions: [] }) }),
    [],
    '주소로 통과'
  );
  assert.deepEqual(
    filterReasons({
      ...base,
      consult: consult({ gugun: '송파구' }),
      settings: settings({ regions: [] }),
    }),
    ['region']
  );
  // 설정한 지역이 있으면 주소는 보지 않는다
  assert.deepEqual(
    filterReasons({
      ...base,
      consult: consult(),
      settings: settings({ regions: [{ sido: '서울특별시', gugun: '송파구' }] }),
    }),
    ['region']
  );
  assert.deepEqual(
    filterReasons({
      ...base,
      consult: consult({ gugun: '송파구' }),
      settings: settings({ regions: [{ sido: '서울특별시', gugun: '송파구' }] }),
    }),
    []
  );
  assert.deepEqual(
    filterReasons({ ...base, consult: consult({ gugun: null }), settings: settings() }),
    ['region']
  );
});

test('품목 — 함 · 외주 통과, 안 함 · 빈 값 탈락, 고객 품목이 여럿이면 모두', () => {
  const base = {
    consult: consult(),
    company: company('a'),
    evaluation: { docs: DOCS },
    stats: stats(),
  };
  assert.deepEqual(
    filterReasons({
      ...base,
      items: ['sink'],
      settings: settings({ items: { sink: 'outsource' } }),
    }),
    []
  );
  assert.deepEqual(
    filterReasons({ ...base, items: ['sink'], settings: settings({ items: { sink: 'no' } }) }),
    ['item']
  );
  assert.deepEqual(filterReasons({ ...base, items: ['sink'], settings: settings({ items: {} }) }), [
    'item',
  ]);
  assert.deepEqual(
    filterReasons({
      ...base,
      items: ['sink', 'wardrobe'],
      settings: settings({ items: { sink: 'do' } }),
    }),
    ['item']
  );
  assert.deepEqual(
    filterReasons({
      ...base,
      items: ['sink', 'wardrobe'],
      settings: settings({ items: { sink: 'do', wardrobe: 'outsource' } }),
    }),
    []
  );
  assert.deepEqual(
    filterReasons({ ...base, items: [], settings: settings({ items: {} }) }),
    [],
    '고객 품목이 없으면 거를 품목이 없다'
  );
});

test('여유 — 이번 달 배정 수 < 한 달 한도', () => {
  const base = {
    consult: consult(),
    items: ['sink'],
    company: company('a'),
    evaluation: { docs: DOCS },
  };
  assert.deepEqual(
    filterReasons({
      ...base,
      settings: settings({ monthly_limit: 3 }),
      stats: stats({ monthCount: 2 }),
    }),
    []
  );
  assert.deepEqual(
    filterReasons({
      ...base,
      settings: settings({ monthly_limit: 3 }),
      stats: stats({ monthCount: 3 }),
    }),
    ['limit']
  );
  assert.deepEqual(
    filterReasons({ ...base, settings: settings({ monthly_limit: 0 }), stats: stats() }),
    ['limit']
  );
});

test('서류 — 보험 · 계약서 둘 다 본사 확인', () => {
  assert.equal(docsOk({ docs: DOCS }), true);
  assert.equal(docsOk({ docs: { insurance: DOCS.insurance } }), false);
  assert.equal(docsOk({ docs: { insurance: DOCS.insurance, contract: {} } }), false);
  assert.equal(docsOk(null), false);
  const base = {
    consult: consult(),
    items: ['sink'],
    company: company('a'),
    settings: settings(),
    stats: stats(),
  };
  assert.deepEqual(filterReasons({ ...base, evaluation: { docs: { contract: DOCS.contract } } }), [
    'docs',
  ]);
  assert.deepEqual(filterReasons({ ...base, evaluation: null }), ['docs']);
  assert.deepEqual(R.REQUIRED_DOCS, ['insurance', 'contract']);
});

test('이유는 모두 싣는다 — 지역 · 품목 · 한도 · 기간 · 서류', () => {
  const r = filterReasons({
    consult: consult({ gugun: '송파구' }),
    items: ['sink'],
    company: company('a'),
    settings: settings({ items: {}, monthly_limit: null, lead_days: null }),
    evaluation: null,
    stats: stats(),
  });
  assert.deepEqual(r, ['region', 'item', 'limit', 'period', 'docs']);
  for (const x of r) assert.ok(R.FILTER_REASONS.includes(x));
});

// ── 점수 ──────────────────────────────────────────────────────

test('본사 평가 — 등급 S16 · A13 · B10 · C4, 등급 없음 0', () => {
  assert.deepEqual(R.GRADE_POINTS, { S: 16, A: 13, B: 10, C: 4 });
  for (const [g, p] of [
    ['S', 16],
    ['A', 13],
    ['B', 10],
    ['C', 4],
    [null, 0],
    ['Z', 0],
  ]) {
    const e = evalScore({ grade: g }, stats());
    assert.equal(e.grade, p, String(g));
    assert.equal(e.grade_letter, p ? g : null, '등급 글자는 따로');
  }
  assert.equal(evalScore(null, stats()).grade, R.NO_GRADE_POINTS);
  assert.equal(evalScore(null, stats()).grade_letter, null);
});

test('본사 평가 — 자료가 없으면 만족 · 재작업 · 응답은 만점의 절반', () => {
  const e = evalScore({ grade: 'A' }, stats());
  assert.deepEqual(e, {
    grade: 13,
    grade_letter: 'A',
    satisfaction: 6,
    rework: 3,
    response: 3,
    sum: 25,
    raw: 25,
  });
  assert.equal(evalScore({ grade: 'A' }, null).sum, 25);
});

test('본사 평가 — 만족 = 설치 후 문항 평균(0~10 → 0~5) ÷ 5 × 12 · 재작업 비율 × 6 · 24시간 안 받기 비율 × 6', () => {
  const s = stats({
    feedbackCount: 2,
    feedbackSum: 16,
    recentOrderCount: 4,
    cleanOrderCount: 3,
    respondedCount: 4,
    fastAcceptCount: 1,
  });
  assert.equal(satisfactionOf(s), 4);
  assert.equal(responseRateOf(s), 0.25);
  const e = evalScore({ grade: 'B' }, s);
  assert.equal(e.satisfaction, 9.6);
  assert.equal(e.rework, 4.5);
  assert.equal(e.response, 1.5);
  assert.equal(e.sum, 25.6);
  assert.equal(
    evalScore(
      { grade: 'S' },
      stats({
        feedbackCount: 1,
        feedbackSum: 10,
        recentOrderCount: 1,
        cleanOrderCount: 1,
        respondedCount: 1,
        fastAcceptCount: 1,
      })
    ).sum,
    40,
    '만점 40'
  );
  assert.equal(satisfactionOf(stats()), null);
  assert.equal(responseRateOf(stats()), null);
});

test('품목 실적 — 0건 3.8 · 1~4건 7.5 · 5건 이상 15, 고객 품목이 하나라도 든 완료 수주', () => {
  assert.deepEqual([0, 1, 4, 5, 9].map(itemRecordPoints), [3.8, 7.5, 7.5, 15, 15]);
  const done = [
    new Set(['sink']),
    new Set(['sink', 'island']),
    new Set(['wardrobe']),
    new Set(['door']),
  ];
  assert.equal(itemRecordCount(['sink'], stats({ completedItems: done })), 2);
  assert.equal(
    itemRecordCount(['sink', 'wardrobe'], stats({ completedItems: done })),
    3,
    '한 수주는 한 번만'
  );
  assert.equal(itemRecordCount([], stats({ completedItems: done })), 0);
});

test('도어 마감은 점수에 넣지 않는다 — 고객이 고른 마감 · 업체 거래 회사와 상관없이 같은 적합도', () => {
  const base = {
    items: ['sink'],
    settings: settings({ lead_days: 10 }),
    stats: stats(),
    today: '2026-10-30',
  };
  const withDoor = fitScore({
    ...base,
    consult: consult({ door_finish: 'pet' }),
    evaluation: { finishes: { door: [{ key: 'cratech', main: true }] } },
  });
  const without = fitScore({
    ...base,
    consult: consult({ door_finish: 'ceramic' }),
    evaluation: {},
  });
  assert.deepEqual(withDoor, without);
  assert.ok(!('finish' in withDoor));
});

test('상세 설계 — 요청이 있으면 설계 인원 1명 이상 + 플래너 10 · 아니면 0, 요청 없으면 10', () => {
  const req = consult({ request_detail_design: true });
  assert.equal(designPoints(consult(), null), 10);
  assert.equal(designPoints(req, { staff: { design: 1 }, design: { planner: true } }), 10);
  assert.equal(designPoints(req, { staff: { design: 0 }, design: { planner: true } }), 0);
  assert.equal(designPoints(req, { staff: { design: 2 }, design: { planner: false } }), 0);
  assert.equal(designPoints(req, null), 0);
});

test('선택 적합도 — 네 항목 합 (만점 35 = 품목 실적 15 · 가격대 5 · 희망 시기 5 · 상세 설계 10)', () => {
  const f = fitScore({
    consult: consult({
      door_finish: 'pet',
      wanted_price_tier: 'mid',
      wanted_done_date: '2026-12-31',
      request_detail_design: true,
    }),
    items: ['sink'],
    settings: settings({ lead_days: 10 }),
    evaluation: {
      price_tier: 'mid',
      staff: { design: 1 },
      design: { planner: true },
    },
    stats: stats({ completedItems: Array.from({ length: 5 }, () => new Set(['sink'])) }),
    today: '2026-10-30',
  });
  assert.deepEqual(f, { item: 15, price: 5, timing: 5, design: 10, sum: 35, raw: 35 });
});

test('기타 — 일감 고르게(최다 업체 0, 직선) · 처리 여유(진행 중 ÷ 한도, 1 이상 0)', () => {
  assert.equal(otherScore({ settings: settings(), stats: stats(), maxRecent: 0 }).spread, 5);
  assert.equal(
    otherScore({ settings: settings(), stats: stats({ recentCount: 4 }), maxRecent: 4 }).spread,
    0
  );
  assert.equal(
    otherScore({ settings: settings(), stats: stats({ recentCount: 2 }), maxRecent: 4 }).spread,
    2.5
  );
  assert.equal(
    otherScore({ settings: settings({ monthly_limit: 10 }), stats: stats(), maxRecent: 0 })
      .capacity,
    5
  );
  assert.equal(
    otherScore({
      settings: settings({ monthly_limit: 10 }),
      stats: stats({ inProgressCount: 5 }),
      maxRecent: 0,
    }).capacity,
    2.5
  );
  assert.equal(
    otherScore({
      settings: settings({ monthly_limit: 10 }),
      stats: stats({ inProgressCount: 10 }),
      maxRecent: 0,
    }).capacity,
    0
  );
  assert.equal(
    otherScore({
      settings: settings({ monthly_limit: 10 }),
      stats: stats({ inProgressCount: 25 }),
      maxRecent: 0,
    }).capacity,
    0
  );
});

test('점수 모양 — eval · fit · location · other, 총점은 반올림 정수 (0~100)', () => {
  const s = scoreCompany({
    consult: consult(),
    items: ['sink'],
    company: company('a'),
    settings: settings(),
    evaluation: { grade: 'S', docs: DOCS },
    stats: stats(),
    maxRecent: 0,
    today: '2026-10-30',
  });
  assert.deepEqual(Object.keys(s.score), ['eval', 'fit', 'location', 'other']);
  assert.deepEqual(Object.keys(s.score.eval), [
    'grade',
    'grade_letter',
    'satisfaction',
    'rework',
    'response',
    'sum',
  ]);
  assert.deepEqual(Object.keys(s.score.fit), ['item', 'price', 'timing', 'design', 'sum']);
  assert.deepEqual(s.score.location, { sum: 15, why: 'same_gugun' });
  assert.deepEqual(Object.keys(s.score.other), ['spread', 'capacity', 'sum']);
  // eval 16 + 6 + 3 + 3 = 28 (자료 없음은 절반) · fit 3.8 + 2.5 + 5 + 10 = 21.3 · location 15 · other 5 + 5 = 10
  assert.equal(s.score.eval.sum, 28);
  assert.equal(s.score.fit.sum, 21.3);
  assert.equal(s.score.other.sum, 10);
  assert.equal(s.total, 74);
  assert.ok(Number.isInteger(s.total));
});

// ── 순위 ──────────────────────────────────────────────────────

function rankWith(list, extraStats = {}) {
  const companies = list.map((c) => c.company);
  const settingsBy = new Map(
    list.map((c) => [c.company.id, c.settings === undefined ? settings() : c.settings])
  );
  const evaluationBy = new Map(
    list.map((c) => [
      c.company.id,
      c.evaluation === undefined ? { grade: 'B', docs: DOCS } : c.evaluation,
    ])
  );
  const statsBy = new Map(
    list.map((c) => [c.company.id, stats({ ...extraStats, ...(c.stats || {}) })])
  );
  return rankCandidates({
    consult: consult(),
    items: ['sink'],
    companies,
    settingsBy,
    evaluationBy,
    statsBy,
    nowMs: NOW,
  });
}

test('순위 — 총점 높은 순, 걸러진 업체는 이유와 따로', () => {
  const { ranked, filtered } = rankWith([
    { company: company('low', { name: '가' }), evaluation: { grade: 'C', docs: DOCS } },
    { company: company('high', { name: '나' }), evaluation: { grade: 'S', docs: DOCS } },
    { company: company('mid', { name: '다' }), evaluation: { grade: 'A', docs: DOCS } },
    { company: company('exp', { name: '라', plan: 'expert' }) },
    { company: company('nodocs', { name: '마' }), evaluation: { grade: 'S' } },
  ]);
  assert.deepEqual(
    ranked.map((c) => [c.company.id, c.rank]),
    [
      ['high', 1],
      ['mid', 2],
      ['low', 3],
    ]
  );
  assert.deepEqual(filtered, [
    { company_id: 'exp', company_name: '라', reasons: ['tier'] },
    { company_id: 'nodocs', company_name: '마', reasons: ['docs'] },
  ]);
});

test('동점 — 마지막 배정이 오래된 업체 먼저 (배정이 없던 업체가 맨 앞), 그다음 이름', () => {
  const { ranked } = rankWith([
    {
      company: company('recent', { name: '가' }),
      stats: { lastAssignedAt: '2026-10-20T00:00:00Z' },
    },
    { company: company('old', { name: '나' }), stats: { lastAssignedAt: '2026-08-01T00:00:00Z' } },
    { company: company('never2', { name: '라' }) },
    { company: company('never1', { name: '다' }) },
  ]);
  assert.equal(new Set(ranked.map((c) => c.total)).size, 1, '모두 동점');
  assert.deepEqual(
    ranked.map((c) => c.company.id),
    ['never1', 'never2', 'old', 'recent']
  );
});

test('순위 — 일감 고르게는 순위 대상 업체 중 최근 30일 배정이 가장 많은 업체를 0 으로', () => {
  const { ranked } = rankWith([
    { company: company('busy', { name: '가' }), stats: { recentCount: 4 } },
    { company: company('half', { name: '나' }), stats: { recentCount: 2 } },
    { company: company('free', { name: '다' }) },
  ]);
  const spread = Object.fromEntries(ranked.map((c) => [c.company.id, c.score.other.spread]));
  assert.deepEqual(spread, { busy: 0, half: 2.5, free: 5 });
});

// ── 고객 품목 ─────────────────────────────────────────────────

test('고객 품목 — furniture_categories 중 품목 키 목록(FURNITURE_LABELS)에 있는 것만', () => {
  assert.deepEqual(
    customerItems({ furniture_categories: ['sink', 'hack<script>', 'sink', 'wardrobe'] }),
    ['sink', 'wardrobe']
  );
  assert.deepEqual(customerItems({ furniture_categories: null, generation_id: 'g' }), []);
  assert.deepEqual(
    customerItems({ furniture_categories: ['shoe'] }),
    [],
    '앱 연출컷 품목 키는 바꾸지 않는다'
  );
  assert.deepEqual(customerItems({ furniture_categories: ['shoerack', 'other'] }), [
    'shoerack',
    'other',
  ]);
  assert.deepEqual(ITEM_KEYS, Object.keys(FURNITURE_LABELS));
});

// ── 통계 ──────────────────────────────────────────────────────

test('KST 날짜 · 이번 달 시작', () => {
  assert.equal(kstToday(Date.parse('2026-10-31T15:30:00Z')), '2026-11-01');
  assert.equal(new Date(kstMonthStartMs(NOW)).toISOString(), '2026-09-30T15:00:00.000Z');
  assert.equal(
    new Date(kstMonthStartMs(Date.parse('2026-10-31T15:30:00Z'))).toISOString(),
    '2026-10-31T15:00:00.000Z'
  );
});

test('배정 통계 — 이번 달(KST) 수 · 최근 30일 수 · 마지막 배정 · 24시간 안 받기 (기다리는 배정은 응답에서 뺌)', () => {
  const statsBy = new Map([['a', stats()]]);
  assignmentStats(
    [
      {
        company_id: 'a',
        state: 'accepted',
        assigned_at: '2026-10-29T00:00:00Z',
        responded_at: '2026-10-29T05:00:00Z',
      },
      {
        company_id: 'a',
        state: 'accepted',
        assigned_at: '2026-10-02T00:00:00Z',
        responded_at: '2026-10-04T00:00:00Z',
      },
      {
        company_id: 'a',
        state: 'declined',
        assigned_at: '2026-09-30T16:00:00Z',
        responded_at: '2026-09-30T17:00:00Z',
      },
      {
        company_id: 'a',
        state: 'expired',
        assigned_at: '2026-09-30T14:00:00Z',
        responded_at: '2026-10-01T14:00:00Z',
      },
      {
        company_id: 'a',
        state: 'assigned',
        assigned_at: '2026-10-30T01:00:00Z',
        responded_at: null,
      },
      {
        company_id: 'a',
        state: 'accepted',
        assigned_at: '2026-05-01T00:00:00Z',
        responded_at: '2026-05-01T01:00:00Z',
      },
      {
        company_id: 'other',
        state: 'accepted',
        assigned_at: '2026-10-29T00:00:00Z',
        responded_at: '2026-10-29T01:00:00Z',
      },
    ],
    NOW,
    statsBy
  );
  const s = statsBy.get('a');
  assert.equal(s.monthCount, 4, '10-01 KST 0시(09-30 15:00Z) 뒤 — 받기 · 못 받음 · 기다림 모두');
  assert.equal(s.recentCount, 5, '최근 30일 (09-30 03:00Z 뒤)');
  assert.equal(s.lastAssignedAt, '2026-10-30T01:00:00Z');
  assert.equal(s.respondedCount, 4, '최근 90일 끝난 배정 (5월 것 · 기다리는 것 뺌)');
  assert.equal(s.fastAcceptCount, 1, '24시간 안 받기만');
});

test('수주 통계 — 진행 중 · 최근 90일 재작업 없는 수주 · 만족 · 완료 수주 품목', () => {
  const statsBy = new Map([['a', stats()]]);
  orderStats(
    {
      orders: [
        {
          id: 'o1',
          company_id: 'a',
          status: 'confirmed',
          ordered_at: '2026-10-01T00:00:00Z',
          snapshot_id: 's1',
        },
        {
          id: 'o2',
          company_id: 'a',
          status: 'in_production',
          ordered_at: '2026-09-01T00:00:00Z',
          snapshot_id: 's2',
        },
        {
          id: 'o3',
          company_id: 'a',
          status: 'delivered',
          ordered_at: '2026-08-15T00:00:00Z',
          snapshot_id: 's3',
        },
        {
          id: 'o4',
          company_id: 'a',
          status: 'completed',
          ordered_at: '2026-05-01T00:00:00Z',
          snapshot_id: 's4',
        },
        {
          id: 'o5',
          company_id: 'a',
          status: 'completed',
          ordered_at: '2026-10-10T00:00:00Z',
          snapshot_id: 's5',
        },
      ],
      reworkOrderIds: new Set(['o2', 'o4']),
      feedback: [
        { order_id: 'o4', score: 10 },
        { order_id: 'o5', score: 7 },
        { order_id: 'o1', score: null },
        { order_id: 'zz', score: 0 },
      ],
      snapshotItems: new Map([
        ['s4', new Set(['sink'])],
        ['s5', new Set(['wardrobe', 'sink'])],
      ]),
      nowMs: NOW,
    },
    statsBy
  );
  const s = statsBy.get('a');
  assert.equal(s.inProgressCount, 3);
  assert.equal(s.recentOrderCount, 4, '08-01 뒤 수주 (90일)');
  assert.equal(s.cleanOrderCount, 3);
  assert.equal(s.feedbackCount, 2);
  assert.equal(s.feedbackSum, 17);
  assert.equal(s.completedItems.length, 2);
});

// ── 평가표 검사 ────────────────────────────────────────────────

test('평가표 — 항목 목록 (설비 13 · 직무 10 · 거래 회사 4분야 + 분야 메모 4 · 설계 4, 시공 묶음 없음)', () => {
  const c = evaluationCatalog();
  assert.equal(c.equipment.length, 13);
  assert.deepEqual(Object.keys(EQUIPMENT), [
    'table_saw',
    'cnc_cut',
    'edge_bander_body',
    'edge_bander_door',
    'curved_edge_bander',
    'special_door_edge_bander',
    'boring',
    'nesting',
    'conveyor',
    'packing',
    'forklift',
    'panel_lifter',
    'assembly_space',
  ]);
  assert.equal(EQUIPMENT.edge_bander_body, '엣지밴더(몸통용)');
  assert.equal(EQUIPMENT.edge_bander_door, '엣지밴더(도어용)');
  assert.deepEqual(
    c.staff_roles.map((x) => x.key),
    [
      'design',
      'measure',
      'cutting',
      'edge',
      'assembly',
      'packing',
      'inspection',
      'install',
      'sales',
      'as',
    ]
  );
  assert.deepEqual(c.staff_total, [{ key: 'total', name: '전체 인원 (실제 사람 수)' }]);
  assert.deepEqual(c.staff_dedicated, [{ key: 'dedicated', name: '전담' }]);
  assert.ok(!STAFF_ROLES.total, '전체 인원은 직무가 아니다');
  assert.ok(!('finishes' in c), '마감 · 자재는 거래 회사 목록(suppliers)으로');
  assert.deepEqual(
    c.suppliers.map((g) => [g.key, g.name, g.companies.length]),
    [
      ['door', '도어', 20],
      ['body', '몸통', 8],
      ['hw', '하드웨어', 22],
      ['top', '상판', 25],
    ]
  );
  assert.deepEqual(Object.keys(SUPPLIERS), Object.keys(SUPPLIER_GROUPS));
  for (const g of c.suppliers)
    for (const s of g.companies) assert.ok(s.key && s.name && s.kind, `${g.key}.${s.key}`);
  assert.deepEqual(
    c.suppliers[0].companies.find((s) => s.key === 'cratech'),
    { key: 'cratech', name: '크라텍', kind: 'PET · 하이그로시 · 도장(UV)' }
  );
  assert.deepEqual(c.finish_notes, [
    { key: 'door', name: '도어' },
    { key: 'body', name: '몸통' },
    { key: 'hw', name: '하드웨어' },
    { key: 'top', name: '상판' },
  ]);
  assert.deepEqual(
    c.finish_notes.map((n) => n.key),
    c.suppliers.map((g) => g.key),
    '메모 분야 = 거래 회사 분야'
  );
  assert.deepEqual(c.limits, {
    supplier_rows: 20,
    supplier_name: 50,
    finish_note: 500,
    hq_comm: 20,
  });
  assert.deepEqual(c.design, [
    { key: 'hand_drawing', name: '손도면' },
    { key: 'cad', name: 'CAD' },
    { key: 'sketchup', name: '스케치업' },
    { key: 'planner', name: '가구 전문 플래너' },
  ]);
  assert.ok(!('install' in c), '시공 묶음은 뺐다');
  assert.deepEqual(c.docs, [
    { key: 'insurance', name: '배상 책임 보험' },
    { key: 'contract', name: '표준 계약서' },
  ]);
  for (const group of Object.values(c))
    if (Array.isArray(group))
      for (const e of group) if (typeof e === 'object') assert.ok(e.key && e.name);
});

test('평가표 — 목록 밖 키는 422 (어느 키인지), 틀린 값도 422', () => {
  const opts = { existing: null, userId: 'u1', today: '2026-10-30' };
  assert.throws(
    () =>
      parseEvaluation(
        { equipment: { laser: 'have' }, staff: { chef: 1 }, docs: { license: true } },
        opts
      ),
    (e) =>
      e.statusCode === 422 &&
      JSON.stringify(e.details.unknown_keys) ===
        JSON.stringify(['equipment.laser', 'staff.chef', 'docs.license'])
  );
  assert.throws(
    () => parseEvaluation({ equipment: { boring: 'maybe' } }, opts),
    (e) => e.statusCode === 422 && e.details.invalid[0] === 'equipment.boring'
  );
  assert.throws(
    () => parseEvaluation({ staff: { design: -1 } }, opts),
    (e) => e.statusCode === 422
  );
  assert.throws(
    () => parseEvaluation({ install: { demolition: true, install_years: 7 } }, opts),
    (e) =>
      e.statusCode === 422 &&
      JSON.stringify(e.details.unknown_keys) ===
        JSON.stringify(['install.demolition', 'install.install_years'])
  );
  assert.throws(
    () => parseEvaluation({ design: { measure: true, render_3d: true } }, opts),
    (e) =>
      e.statusCode === 422 &&
      JSON.stringify(e.details.unknown_keys) ===
        JSON.stringify(['design.measure', 'design.render_3d'])
  );
  // 등급은 받지 않는다 — 저장할 때 서버가 점수로 매긴다
  assert.equal(parseEvaluation({ grade: 'S+' }, opts).grade, undefined);
  assert.throws(
    () => parseEvaluation({ price_tier: 'premium' }, opts),
    (e) => e.statusCode === 422
  );
  assert.throws(
    () => parseEvaluation({ as_months: 300 }, opts),
    (e) => e.statusCode === 422
  );
  assert.throws(
    () => parseEvaluation({ equipment: ['boring'] }, opts),
    (e) => e.statusCode === 422
  );
  assert.throws(
    () => parseEvaluation(null, opts),
    (e) => e.statusCode === 422
  );
});

test('평가표 — 마감 · 자재 분야별 메모 finishes.notes (앞뒤 빈칸 지움 · 빈 글 뺌 · 500자) — 거래 회사 줄과 섞이지 않는다', () => {
  const opts = { existing: null, userId: 'u1', today: '2026-10-30' };
  const out = parseEvaluation(
    {
      finishes: {
        door: [{ key: 'cratech', main: true }],
        notes: { door: '  PET 는 외주  ', top: '   ', hw: '블룸 재고' },
      },
    },
    opts
  );
  assert.deepEqual(out.finishes, {
    door: [{ key: 'cratech', main: true }],
    notes: { door: 'PET 는 외주', hw: '블룸 재고' },
  });
  assert.deepEqual(parseEvaluation({ finishes: { notes: { top: '' } } }, opts).finishes, {});
  assert.equal(
    parseEvaluation({ finishes: { door: [{ key: 'cratech' }] } }, opts).finishes.notes,
    undefined
  );
  assert.throws(
    () => parseEvaluation({ finishes: { notes: { frame: '틀' } } }, opts),
    (e) => e.statusCode === 422 && e.details.unknown_keys[0] === 'finishes.notes.frame'
  );
  for (const bad of ['가'.repeat(501), 3, true]) {
    assert.throws(
      () => parseEvaluation({ finishes: { notes: { body: bad } } }, opts),
      (e) => e.statusCode === 422 && e.details.invalid[0] === 'finishes.notes.body'
    );
  }
  assert.equal(
    parseEvaluation({ finishes: { notes: { body: '가'.repeat(500) } } }, opts).finishes.notes.body
      .length,
    500
  );
  assert.throws(
    () => parseEvaluation({ finishes: { notes: '메모' } }, opts),
    (e) => e.statusCode === 422
  );
});

test('평가표 — 마감 · 자재 거래 회사 (목록 키 또는 직접 적기 · 주력), 분야마다 20줄 · 같은 회사 한 번', () => {
  const opts = { existing: null, userId: 'u1', today: '2026-10-30' };
  const out = parseEvaluation(
    {
      finishes: {
        door: [
          { key: 'cratech', main: true },
          { key: 'homegreen' },
          { name: '  동네 도어  ', main: false },
        ],
        hw: [{ key: 'blum', main: true }],
        body: [],
        top: null,
      },
    },
    opts
  );
  assert.deepEqual(out.finishes, {
    door: [
      { key: 'cratech', main: true },
      { key: 'homegreen', main: false },
      { name: '동네 도어', main: false },
    ],
    hw: [{ key: 'blum', main: true }],
  });
  // 목록 밖 분야 · 회사는 「목록에 없는 항목」 — 예전 화면(취급함 · 안함)이 보내는 키도
  assert.throws(
    () => parseEvaluation({ finishes: { door_pet: 'yes', door: [{ key: 'nobody' }] } }, opts),
    (e) =>
      e.statusCode === 422 &&
      JSON.stringify(e.details.unknown_keys) ===
        JSON.stringify(['finishes.door_pet', 'finishes.door.nobody'])
  );
  assert.throws(
    () => parseEvaluation({ finishes: { door: [{ key: 'sungchang' }] } }, opts),
    (e) => e.statusCode === 422 && e.details.unknown_keys[0] === 'finishes.door.sungchang',
    '몸통 회사는 도어 목록에 없다'
  );
  // 모양 · 글자 수
  for (const bad of [
    'cratech',
    {},
    { key: 'cratech', name: '크라텍' },
    { key: 'cratech', main: 'yes' },
    { key: 'cratech', extra: 1 },
    { key: 3 },
    { name: '   ' },
    { name: '가'.repeat(51) },
  ])
    assert.throws(
      () => parseEvaluation({ finishes: { top: [bad] } }, opts),
      (e) => e.statusCode === 422 && e.details.invalid[0] === 'finishes.top.0',
      JSON.stringify(bad)
    );
  assert.equal(
    parseEvaluation({ finishes: { top: [{ name: '가'.repeat(50) }] } }, opts).finishes.top[0].name
      .length,
    50
  );
  // 같은 회사 두 번
  assert.throws(
    () =>
      parseEvaluation(
        { finishes: { door: [{ key: 'cratech' }, { key: 'cratech', main: true }] } },
        opts
      ),
    (e) => e.statusCode === 422 && e.details.invalid[0] === 'finishes.door.1'
  );
  assert.throws(
    () => parseEvaluation({ finishes: { door: [{ name: '동네' }, { name: ' 동네 ' }] } }, opts),
    (e) => e.statusCode === 422 && e.details.invalid[0] === 'finishes.door.1'
  );
  // 분야마다 20줄까지 · 줄 목록이어야
  const many = (n) => Array.from({ length: n }, (_, i) => ({ name: `회사 ${i}` }));
  assert.equal(parseEvaluation({ finishes: { body: many(20) } }, opts).finishes.body.length, 20);
  assert.throws(
    () => parseEvaluation({ finishes: { body: many(21) } }, opts),
    (e) => e.statusCode === 422 && e.details.invalid[0] === 'finishes.body'
  );
  assert.throws(
    () => parseEvaluation({ finishes: { body: { key: 'dongwha' } } }, opts),
    (e) => e.statusCode === 422 && e.details.invalid[0] === 'finishes.body'
  );
  // 거래 회사는 등급 점수에 넣지 않는다
  assert.deepEqual(evaluationScore(out).areas, evaluationScore({}).areas);
});

test('평가표 — 본사 소통 hq_comm { score } 0~20 정수 (비우면 {}) — 등급 「본사 소통」 영역 점수', () => {
  const opts = { existing: null, userId: 'u1', today: '2026-10-30' };
  assert.deepEqual(parseEvaluation({ hq_comm: { score: 12 } }, opts).hq_comm, { score: 12 });
  assert.deepEqual(parseEvaluation({ hq_comm: { score: 0 } }, opts).hq_comm, { score: 0 });
  assert.deepEqual(parseEvaluation({ hq_comm: { score: null } }, opts).hq_comm, {});
  assert.deepEqual(parseEvaluation({}, opts).hq_comm, {});
  for (const bad of [-1, 21, 1.5, '12'])
    assert.throws(
      () => parseEvaluation({ hq_comm: { score: bad } }, opts),
      (e) => e.statusCode === 422 && e.details.invalid[0] === 'hq_comm.score'
    );
  assert.throws(
    () => parseEvaluation({ hq_comm: { items: [] } }, opts),
    (e) => e.statusCode === 422 && e.details.unknown_keys[0] === 'hq_comm.items'
  );
  assert.throws(
    () => parseEvaluation({ hq_comm: 12 }, opts),
    (e) => e.statusCode === 422
  );
  const hq = (v) => evaluationScore({ hq_comm: v }).areas.find((a) => a.key === 'hq_comm');
  assert.deepEqual(hq({ score: 12 }), { key: 'hq_comm', name: '본사 소통', points: 12, max: 20 });
  assert.equal(hq({}).points, 0);
  assert.equal(hq({ score: 25 }).points, 20, '배율보다 크면 배율까지');
  assert.equal(hq({ score: '12' }).points, 0);
});

test('평가표 — 전체 인원 staff.total (실제 사람 수), 직무별 인원과 따로 · 점수에 안 들어감', () => {
  const opts = { existing: null, userId: 'u1', today: '2026-10-30' };
  // 설계 1명이 실측도 한다 — 직무마다 세고 전체 인원은 실제 사람 수
  const out = parseEvaluation({ staff: { total: 4, design: 2, measure: 2 } }, opts);
  assert.deepEqual(out.staff, { design: 2, measure: 2, total: 4 });
  assert.deepEqual(parseEvaluation({ staff: { total: null, design: 1 } }, opts).staff, {
    design: 1,
  });
  assert.deepEqual(parseEvaluation({ staff: { total: 0 } }, opts).staff, { total: 0 });
  for (const bad of [-1, 1.5, '4', 1000])
    assert.throws(
      () => parseEvaluation({ staff: { total: bad } }, opts),
      (e) => e.statusCode === 422 && e.details.invalid[0] === 'staff.total'
    );
  const withTotal = evaluationScore({ staff: { design: 2, measure: 2, total: 40 } });
  const without = evaluationScore({ staff: { design: 2, measure: 2 } });
  assert.deepEqual(withTotal.areas, without.areas, '전체 인원은 등급 점수에 넣지 않는다');
});

test('평가표 — 전담 직무 staff.dedicated (직무 차례로, 인원 있어야, 전체 인원보다 많을 수 없음)', () => {
  const opts = { existing: null, userId: 'u1', today: '2026-10-31' };
  const out = parseEvaluation(
    { staff: { total: 3, design: 1, cutting: 2, sales: 1, dedicated: ['cutting', 'design'] } },
    opts
  );
  assert.deepEqual(out.staff, {
    design: 1,
    cutting: 2,
    sales: 1,
    total: 3,
    dedicated: ['design', 'cutting'],
  });
  assert.deepEqual(parseEvaluation({ staff: { design: 1, dedicated: [] } }, opts).staff, {
    design: 1,
  });
  assert.deepEqual(parseEvaluation({ staff: { design: 1, dedicated: null } }, opts).staff, {
    design: 1,
  });
  assert.throws(
    () => parseEvaluation({ staff: { design: 1, dedicated: ['chef'] } }, opts),
    (e) => e.statusCode === 422 && e.details.unknown_keys[0] === 'staff.dedicated.chef'
  );
  for (const [staff, key] of [
    [{ design: 1, dedicated: 'design' }, 'staff.dedicated'],
    [{ design: 1, dedicated: ['design', 'design'] }, 'staff.dedicated'],
    [{ design: 0, dedicated: ['design'] }, 'staff.dedicated.design'],
    [{ dedicated: ['measure'] }, 'staff.dedicated.measure'],
    [{ total: 1, design: 1, measure: 1, dedicated: ['design', 'measure'] }, 'staff.dedicated'],
  ])
    assert.throws(
      () => parseEvaluation({ staff }, opts),
      (e) => e.statusCode === 422 && e.details.invalid.includes(key),
      JSON.stringify(staff)
    );
  // 전체 인원을 안 넣었으면 전담 수는 따지지 않는다
  assert.deepEqual(
    parseEvaluation({ staff: { design: 1, measure: 1, dedicated: ['design', 'measure'] } }, opts)
      .staff.dedicated,
    ['design', 'measure']
  );
  // 점수: 전담 1 · 겸직 0.3 · 없음 0 → 합 ÷ 10 × 20
  assert.deepEqual(R.STAFF_SCORE, { dedicated: 1, shared: 0.3 });
  const pts = (staff) => evaluationScore({ staff }).areas.find((a) => a.key === 'staff').points;
  const all = (n) => Object.fromEntries(Object.keys(STAFF_ROLES).map((k) => [k, n]));
  assert.equal(pts({ ...all(1), total: 1 }), 6, '한 사람이 열 직무 — 모두 겸직');
  assert.equal(pts({ ...all(2), dedicated: Object.keys(STAFF_ROLES) }), 20, '모두 전담');
  assert.equal(pts({ design: 1, cutting: 1, dedicated: ['design'] }), 2.6, '전담 1 + 겸직 0.3');
  assert.equal(pts({ design: 0, dedicated: ['design'] }), 0, '인원 없는 전담은 0');
});

test('평가표 — 서류는 { checked_at: 확인한 날 }, 확인한 사람은 호출자 (같은 날이면 저장된 기록 그대로), false 면 뺀다', () => {
  const opts = {
    existing: { docs: { insurance: { checked_at: '2026-01-01', by: 'old' } } },
    userId: 'u1',
    today: '2026-10-30',
  };
  const out = parseEvaluation(
    {
      grade: 'A',
      docs: {
        insurance: { checked_at: '2026-01-01', by: 'someone-else' },
        contract: { checked_at: '2026-10-29' },
      },
      note: '  메모  ',
      company_id: 'ignored',
    },
    opts
  );
  assert.deepEqual(out.docs, {
    insurance: { checked_at: '2026-01-01', by: 'old' },
    contract: { checked_at: '2026-10-29', by: 'u1' },
  });
  assert.deepEqual(
    parseEvaluation({ docs: { insurance: { checked_at: '2026-02-01' } } }, opts).docs,
    {
      insurance: { checked_at: '2026-02-01', by: 'u1' },
    }
  );
  assert.deepEqual(parseEvaluation({ docs: { contract: true } }, opts).docs, {
    contract: { checked_at: '2026-10-30', by: 'u1' },
  });
  for (const bad of [{ checked_at: '2026-02-30' }, { checked_at: '어제' }, {}, 'yes']) {
    assert.throws(
      () => parseEvaluation({ docs: { insurance: bad } }, opts),
      (e) => e.statusCode === 422 && e.details.invalid[0] === 'docs.insurance'
    );
  }
  assert.equal(out.note, '메모');
  assert.equal(out.grade, undefined, '등급은 본문에서 읽지 않는다');
  assert.deepEqual(out.install, {}, '시공 묶음은 뺐다 — 늘 비운다');
  assert.deepEqual(parseEvaluation({ docs: { insurance: false } }, opts).docs, {});
  assert.deepEqual(Object.keys(out).sort(), [
    'as_months',
    'design',
    'docs',
    'equipment',
    'finishes',
    'hq_comm',
    'install',
    'note',
    'price_tier',
    'staff',
    'warranty_months',
  ]);
});

// ── 본사 등급 (평가표 영역별 배율) ───────────────────────────────

test('본사 등급 — 영역 배율 합 100 (가격대 · 마감 · 자재 없음), 설계 점수 합 = 설계 배율, 영역 이름', () => {
  assert.deepEqual(R.EVAL_WEIGHTS, {
    equipment: 30,
    staff: 20,
    hq_comm: 20,
    design: 15,
    quality: 10,
    docs: 5,
  });
  assert.equal(
    Object.values(R.EVAL_WEIGHTS).reduce((s, v) => s + v, 0),
    100
  );
  assert.deepEqual(Object.keys(EVAL_AREAS), Object.keys(R.EVAL_WEIGHTS));
  assert.deepEqual(Object.keys(R.DESIGN_SCORE), Object.keys(DESIGN), '설계 항목마다 점수');
  assert.equal(
    Object.values(R.DESIGN_SCORE).reduce((s, v) => s + v, 0),
    R.EVAL_WEIGHTS.design
  );
  assert.deepEqual(Object.keys(R.EQUIPMENT_SCORE), ['have', 'outsource', 'none']);
});

test('본사 등급 — 빈 평가표 0점 C, 다 갖추면 100점 S', () => {
  const empty = evaluationScore({});
  assert.equal(empty.total, 0);
  assert.equal(empty.max, 100);
  assert.equal(empty.grade, 'C');
  assert.deepEqual(
    empty.areas.map((a) => [a.key, a.name, a.points, a.max]),
    [
      ['equipment', '설비', 0, 30],
      ['staff', '인력', 0, 20],
      ['hq_comm', '본사 소통', 0, 20],
      ['design', '설계', 0, 15],
      ['quality', '품질 · 서비스', 0, 10],
      ['docs', '신뢰 · 서류', 0, 5],
    ]
  );
  assert.equal(evaluationScore(null).grade, 'C');
  const full = evaluationScore({
    equipment: Object.fromEntries(Object.keys(EQUIPMENT).map((k) => [k, 'have'])),
    staff: {
      ...Object.fromEntries(Object.keys(STAFF_ROLES).map((k) => [k, 3])),
      dedicated: Object.keys(STAFF_ROLES),
    },
    hq_comm: { score: 20 },
    design: Object.fromEntries(Object.keys(DESIGN).map((k) => [k, true])),
    as_months: 24,
    warranty_months: 36,
    docs: { insurance: { checked_at: '2026-10-01' }, contract: { checked_at: '2026-10-01' } },
  });
  assert.equal(full.total, 100);
  assert.equal(full.grade, 'S');
  assert.deepEqual(
    full.areas.map((a) => a.points),
    [30, 20, 20, 15, 10, 5]
  );
});

test('본사 등급 — 영역 안 점수 (설비 외주 0.5 · 인력 전담 1 · 겸직 0.3 · 본사 소통 · 설계 합 · 기간 · 서류)', () => {
  const s = evaluationScore({
    equipment: { table_saw: 'have', cnc_cut: 'outsource', nesting: 'have', boring: 'none' },
    staff: { design: 2, measure: 1, install: 0, dedicated: ['design'] },
    finishes: {
      door: [{ key: 'cratech', main: true }],
      notes: { door: '거래 회사 · 메모는 셈에 안 넣는다' },
    },
    hq_comm: { score: 7 },
    design: { cad: true, planner: true, sketchup: false },
    as_months: 12,
    warranty_months: 24,
    docs: { insurance: { checked_at: '2026-10-01', by: 'u1' } },
    price_tier: 'high',
    grade: 'S',
  });
  // 설비 (1 + 0.5 + 1) ÷ 13 × 30 = 5.77 · 인력 (설계 전담 1 + 실측 겸직 0.3) ÷ 10 × 20 = 2.6 · 본사 소통 7
  // 설계 CAD 4 + 플래너 5 = 9 · 품질 A/S 12개월 3 + 보증 24개월 5 = 8 · 서류 하나 2.5
  assert.deepEqual(
    s.areas.map((a) => a.points),
    [5.8, 2.6, 7, 9, 8, 2.5]
  );
  assert.equal(s.total, 34.9, '영역 점수(소수 첫째 자리)를 더한 값');
  assert.equal(s.grade, 'C', '저장된 등급 · 가격대는 셈에 넣지 않는다');
  // 기간 점수: 없음 · 0 → 0, 1~11 → 1, 12~23 → 3, 24 이상 → 5
  const q = (m) => evaluationScore({ as_months: m }).areas.find((a) => a.key === 'quality').points;
  assert.deepEqual([null, 0, 1, 11, 12, 23, 24, 240, 1.5].map(q), [0, 0, 1, 1, 3, 3, 5, 5, 0]);
  // 서류는 확인한 날이 있어야
  const d = (docs) => evaluationScore({ docs }).areas.find((a) => a.key === 'docs').points;
  assert.equal(d({ insurance: {}, contract: { checked_at: '2026-10-01' } }), 2.5);
  assert.equal(d({ insurance: true }), 0);
});

test('본사 등급 — 구간 S 85 · A 70 · B 50 이상 · 그 밖 C', () => {
  assert.deepEqual(R.GRADE_CUTS, [
    ['S', 85],
    ['A', 70],
    ['B', 50],
    ['C', 0],
  ]);
  assert.deepEqual([100, 85, 84.9, 70, 69.9, 50, 49.9, 0].map(gradeOf), [
    'S',
    'S',
    'A',
    'A',
    'B',
    'B',
    'C',
    'C',
  ]);
  for (const g of Object.keys(R.GRADE_POINTS))
    assert.ok(
      R.GRADE_CUTS.some(([x]) => x === g),
      `${g} 는 상담 분배 등급 점수와 같은 글자`
    );
});

// ── 앱 알림 글 ─────────────────────────────────────────────────

test('consult_assigned 글 — 「새 상담 배정」, 품목 · 시/군/구만, 업체 › 상담으로', () => {
  assert.deepEqual(CONSULT_ITEM_LABELS, FURNITURE_LABELS);
  const m = buildMessage('consult_assigned', { items: ['sink', 'wardrobe'], gugun: '강남구' });
  assert.deepEqual(m, {
    title: '새 상담 배정',
    body: '싱크대·붙박이장 · 강남구 상담이 배정되었습니다. 24시간 안에 받기 · 못 받음을 골라 주세요.',
    url: '/segan/me.html#partner-consults',
  });
  assert.equal(PARTNER_CONSULTS_URL, m.url);
  assert.ok(isValidMessage(m));
  const odd = buildMessage('consult_assigned', {
    items: ['홍길동 010-1234-5678', 'sink'],
    gugun: '강남구 역삼동 12-3',
    name: '홍길동',
  });
  assert.equal(odd.body, '싱크대 상담이 배정되었습니다. 24시간 안에 받기 · 못 받음을 골라 주세요.');
  const none = buildMessage('consult_assigned', {});
  assert.equal(none.body, '상담이 배정되었습니다. 24시간 안에 받기 · 못 받음을 골라 주세요.');
  const all = buildMessage('consult_assigned', {
    items: Object.keys(FURNITURE_LABELS),
    gugun: '가나다라마바사아자차구',
  });
  assert.ok(charLen(all.body) <= BODY_MAX);
});
