/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * database/migrations/0055_production_recommendation_estimates.sql 정적 시험 (DB 없이).
 *
 *   제작 의뢰 본사 추천(production_recommendations)에 팩토리마다 예상 가격대 · 제작 기간 칸 셋:
 *   price_min · price_max (bigint 원, 0 이상, 최소 ≤ 최대) · lead_days (integer 일, 1 이상) — 셋 다 비워 둘 수 있다.
 *   추천 지킴이는 0050 본문 그대로, 넣은 뒤 바꿀 수 없는 칸(추천 내용)에 셋을 더한다.
 *   워커와 맞물리는 것: production-requests/common.js REC_COLUMNS · factoryView, admin.js parseEstimate · 넣는 줄.
 *   값은 database/probes/0055-production-recommendation-estimates.json 이 실DB 트랜잭션에서 본다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = '0055_production_recommendation_estimates.sql';
const PROBE = 'database/probes/0055-production-recommendation-estimates.json';
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const noComments = (text) =>
  text
    .split('\r\n')
    .join('\n')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
const flat = (text) => text.replace(/\s+/g, ' ').trim();
const f = flat(noComments(read('database', 'migrations', FILE)));
/** 함수 본문을 뺀 위 문장들 */
const top = f.replace(/\$function\$.*?\$function\$/g, '$function$ … $function$');
const statements = top
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);
/** 추천 지킴이 함수 본문 ($function$ 사이) */
const guardBody = (text) => {
  const m =
    /CREATE OR REPLACE FUNCTION public\.production_recommendations_guard\(\) RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS \$function\$(.*?)\$function\$/.exec(
      text
    );
  return m ? m[1].trim() : null;
};
const F0050 = flat(noComments(read('database', 'migrations', '0050_production_requests.sql')));

const PRICE_CHECK =
  'CHECK ((price_min IS NULL OR price_min >= 0) AND (price_max IS NULL OR price_max >= 0) AND (price_min IS NULL OR price_max IS NULL OR price_min <= price_max))';
const LEAD_CHECK = 'CHECK (lead_days IS NULL OR lead_days >= 1)';

describe('0055 — 제작 의뢰 본사 추천 예상 가격대 · 제작 기간', () => {
  test('문장 — 칸 셋 · 제약 둘(지우고 다시) · 설명 · 지킴이 바꾸기 · 권한 거두기뿐, 트랜잭션 · 행 · 표 · 정책 · 권한 주기 없음', () => {
    expect(statements).toEqual([
      'ALTER TABLE public.production_recommendations ADD COLUMN IF NOT EXISTS price_min bigint',
      'ALTER TABLE public.production_recommendations ADD COLUMN IF NOT EXISTS price_max bigint',
      'ALTER TABLE public.production_recommendations ADD COLUMN IF NOT EXISTS lead_days integer',
      'ALTER TABLE public.production_recommendations DROP CONSTRAINT IF EXISTS production_recommendations_price_check',
      `ALTER TABLE public.production_recommendations ADD CONSTRAINT production_recommendations_price_check ${PRICE_CHECK}`,
      'ALTER TABLE public.production_recommendations DROP CONSTRAINT IF EXISTS production_recommendations_lead_days_check',
      `ALTER TABLE public.production_recommendations ADD CONSTRAINT production_recommendations_lead_days_check ${LEAD_CHECK}`,
      expect.stringMatching(
        /^COMMENT ON COLUMN public\.production_recommendations\.price_min IS '/
      ),
      expect.stringMatching(
        /^COMMENT ON COLUMN public\.production_recommendations\.price_max IS '/
      ),
      expect.stringMatching(
        /^COMMENT ON COLUMN public\.production_recommendations\.lead_days IS '/
      ),
      "CREATE OR REPLACE FUNCTION public.production_recommendations_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $function$ … $function$",
      expect.stringMatching(
        /^COMMENT ON FUNCTION public\.production_recommendations_guard\(\) IS '.*\(0050 · 0055\)'$/
      ),
      'REVOKE ALL ON FUNCTION public.production_recommendations_guard() FROM PUBLIC, anon, authenticated, service_role',
    ]);
    expect(top).not.toMatch(/\b(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\b/i);
    expect(top).not.toMatch(
      /\b(DROP TABLE|DROP COLUMN|DROP FUNCTION|DROP TRIGGER|TRUNCATE|POLICY|GRANT)\b/i
    );
    expect(top).not.toMatch(/(^|; )\s*(UPDATE|DELETE|INSERT)\b/i);
    // 의뢰 표 · 그 지킴이 · 알림 종류는 그대로
    expect(f).not.toMatch(
      /production_requests_guard|notification_outbox|ALTER TABLE public\.production_requests\b/
    );
    // 0054(열린 PR — 시공사례 사진 옛 경로 정책)가 다루는 것을 쓰지 않는다
    expect(f).not.toMatch(/collection|storage\./);
  });

  test('제약 — 가격 0 이상 · 둘 다 있으면 최소 ≤ 최대, 제작 기간 1일 이상, 셋 다 비워도 된다 (다른 상한 없음)', () => {
    expect(f).toContain(`production_recommendations_price_check ${PRICE_CHECK}`);
    expect(f).toContain(`production_recommendations_lead_days_check ${LEAD_CHECK}`);
    // 상한을 지어 넣지 않는다 (가격 · 기간 모두 아래만 막는다)
    expect(top).not.toMatch(/price_m(in|ax) <= \d|price_m(in|ax) < \d|lead_days <=? \d|BETWEEN/);
    // 기본값 · NOT NULL 없음 — 적지 않으면 비어 있다
    expect(top).not.toMatch(/(price_min|price_max|lead_days) (bigint|integer) (DEFAULT|NOT NULL)/);
    // 0050 의 제약 이름과 겹치지 않는다
    for (const name of [
      'production_recommendations_price_check',
      'production_recommendations_lead_days_check',
    ])
      expect(F0050).not.toContain(name);
  });

  test('지킴이 — 0050 본문 그대로, 추천 내용 칸에만 price_min · price_max · lead_days 를 더한다', () => {
    const before = guardBody(F0050);
    const after = guardBody(f);
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    const OLD_TUPLE =
      'IF (NEW.id, NEW.request_id, NEW.company_id, NEW.round, NEW.rank, NEW.note, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.request_id, OLD.company_id, OLD.round, OLD.rank, OLD.note, OLD.created_at)';
    const NEW_TUPLE =
      'IF (NEW.id, NEW.request_id, NEW.company_id, NEW.round, NEW.rank, NEW.note, NEW.price_min, NEW.price_max, NEW.lead_days, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.request_id, OLD.company_id, OLD.round, OLD.rank, OLD.note, OLD.price_min, OLD.price_max, OLD.lead_days, OLD.created_at)';
    expect(before).toContain(OLD_TUPLE);
    expect(after).toBe(before.replace(OLD_TUPLE, NEW_TUPLE));
    // 트리거는 0050 것을 그대로 쓴다 (CREATE OR REPLACE — 다시 걸지 않는다)
    expect(F0050).toContain(
      'CREATE TRIGGER trg_production_recommendations_guard BEFORE INSERT OR UPDATE ON public.production_recommendations FOR EACH ROW EXECUTE FUNCTION public.production_recommendations_guard();'
    );
    expect(f).not.toContain('CREATE TRIGGER');
  });

  test('워커와 맞물리는 것 — 읽는 칸 · 넣는 줄 · 검사 코드, 팩토리 화면은 싣지 않는다', () => {
    const common = read('workers', 'workflow-api', 'src', 'production-requests', 'common.js');
    const admin = read('workers', 'workflow-api', 'src', 'production-requests', 'admin.js');
    const factory = read('workers', 'workflow-api', 'src', 'production-requests', 'factory.js');
    const cols = /REC_COLUMNS =\s*'([^']+)'/.exec(common)[1].split(',');
    for (const c of ['price_min', 'price_max', 'lead_days']) expect(cols).toContain(c);
    expect(admin).toContain(
      "export const ESTIMATE_KEYS = Object.freeze(['price_min', 'price_max', 'lead_days']);"
    );
    expect(admin).toContain('...(estimates.get(id) || NO_ESTIMATE),');
    for (const code of ['bad_estimates', 'bad_price', 'price_range', 'bad_lead_days'])
      expect(admin).toContain(`'${code}'`);
    // lead_days 상한은 integer 칸 형식만 (규칙 아님)
    expect(admin).toContain('const INT4_MAX = 2147483647;');
    // Manager 카드(factoryView)에 싣는다 — 팩토리 쪽 파일은 칸 이름을 쓰지 않는다
    expect(common).toMatch(/export function factoryView[\s\S]*?\.\.\.estimateOf\(rec\),/);
    expect(factory).not.toMatch(/price_min|price_max|lead_days|estimateOf/);
  });

  test('프로브 — 칸 형식 · 제약 일곱 · 서버만 읽기 · 적은 값 · 빈 값 · 한쪽만 · 거절(최소 > 최대 · 음수 · 0일) · 바꾸기 거절 · 0050 지킴이 그대로', () => {
    const probe = JSON.parse(read(PROBE));
    expect(probe.title).toContain(`--migration database/migrations/${FILE}`);
    const byName = Object.fromEntries(probe.checks.map((c) => [c.name, c.expect]));
    expect(byName['칸 셋 — price_min · price_max 는 bigint(원), lead_days 는 integer(일)']).toEqual(
      {
        service_role: 'lead_days:integer,price_max:bigint,price_min:bigint',
      }
    );
    // 제약 = 0050 의 검사 제약 다섯 + 이 파일의 둘
    const checks0050 = [
      ...F0050.matchAll(/CONSTRAINT (production_recommendations_\w+_check) CHECK/g),
    ].map((m) => m[1]);
    expect(checks0050).toHaveLength(5);
    expect(
      byName['검사 제약 — 0050 의 다섯 + 가격대 · 제작 기간 둘'].service_role.split(',')
    ).toEqual(
      [
        ...checks0050,
        'production_recommendations_price_check',
        'production_recommendations_lead_days_check',
      ].sort()
    );
    expect(byName['읽기 — 서버만 (익명 · 의뢰한 업체 대표도 deny)']).toEqual({
      anon: 'deny',
      m_owner: 'deny',
      service_role: '12000000',
    });
    expect(byName['최소가 최대보다 크면 거절']).toEqual({ service_role: 'err:23514' });
    expect(byName['제작 기간 0일은 거절']).toEqual({ service_role: 'err:23514' });
    expect(byName['최소 = 최대 · 0 원 · 1일 넣어짐']).toEqual({ service_role: 'ok' });
    for (const k of ['최소', '최대'])
      expect(byName[`음수 가격은 거절 (${k})`]).toEqual({ service_role: 'err:23514' });
    for (const k of [
      '가격대 최소 바꾸기 거절',
      '가격대 최대 바꾸기 거절',
      '제작 기간 바꾸기 거절',
      '비어 있던 칸을 나중에 채우기도 거절',
    ])
      expect(byName[`추천 내용은 그대로 — ${k}`]).toEqual({ service_role: 'err:22023' });
    expect(
      byName['고르기는 그대로 — 기한은 고른 때 + 24시간, 가격대 · 제작 기간은 남는다']
    ).toEqual({
      service_role: '86400/12000000/15000000/20',
    });
    expect(byName['지킴이 함수는 서버도 부르지 못한다 (권한 그대로)']).toEqual({
      service_role: 'false',
    });
    expect(probe.checks.length).toBe(21);
  });
});
