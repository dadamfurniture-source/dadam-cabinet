/**
 * @jest-environment node
 *
 * 사슬 ④ — 시공 후 피드백 (database/dataset-feedback.sql, mypage.html).
 *
 * 고정하는 것:
 *   1) 평가는 **시공이 끝난 설계**에만 남긴다 (orders.status='completed')
 *   2) 평가는 본인 이름으로 들어가고, 축 값은 표의 CHECK 안에 있다
 *   3) 관리자가 읽을 수 있어야 집계·검수가 된다 — 기존 정책은 본인만이었다
 *   4) dataset_chains 가 만족도를 값으로 낸다. 개수만 세면 학습 라벨이 안 된다
 */

const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const SQL = read('database/dataset-feedback.sql');
const SCHEMA = read('database/schema.sql');
const MYPAGE = read('mypage.html');

describe('스키마', () => {
  test('어느 완성 사진에 대한 평가인지 가리킬 수 있다', () => {
    expect(SQL).toMatch(/ALTER TABLE design_feedback ADD COLUMN IF NOT EXISTS post_id UUID REFERENCES collection_posts\(id\)/);
    expect(SQL).toMatch(/ON DELETE SET NULL/);   // 사진을 지워도 평가는 남는다
  });

  test('관리자 읽기 정책을 연다 — 쓰기는 본인만 그대로', () => {
    expect(SQL).toMatch(/CREATE POLICY "admins read design feedback" ON design_feedback/);
    expect(SQL).toMatch(/FOR SELECT/);
    expect(SQL).not.toMatch(/admins.*FOR ALL ON design_feedback/);
  });

  test('재실행 안전 · 파괴적 문장 없음', () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS/);
    expect(SQL).toMatch(/CREATE INDEX IF NOT EXISTS/);
    expect(SQL).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/);
  });
});

describe('dataset_chains 가 만족도를 값으로 낸다', () => {
  const view = SQL.slice(SQL.indexOf('CREATE OR REPLACE VIEW dataset_chains'));

  test('정확도·편의성 평균과 수정 여부', () => {
    expect(view).toMatch(/accuracy_avg/);
    expect(view).toMatch(/usability_avg/);
    expect(view).toMatch(/bool_or\(coalesce\(was_modified, FALSE\)\)/);
  });

  test('완료된 수주만, security_invoker 로', () => {
    expect(view).toMatch(/WHERE o\.status = 'completed'/);
    expect(view).toMatch(/WITH \(security_invoker = on\)/);
  });

  test('평가가 없는 현장도 줄이 사라지지 않는다 (LEFT JOIN LATERAL)', () => {
    expect(view).toMatch(/LEFT JOIN LATERAL/);
    expect(view).toMatch(/\) f ON TRUE/);
  });
});

describe('평가 화면 (mypage.html)', () => {
  test('시공 완료된 설계만 목록에 올린다', () => {
    expect(MYPAGE).toMatch(/function loadMyProjects/);
    expect(MYPAGE).toMatch(/\.from\('orders'\)/);
    expect(MYPAGE).toMatch(/\.eq\('status', 'completed'\)/);
  });

  test('첫 화면에서 함께 불린다', () => {
    expect(MYPAGE).toMatch(/await loadMyCases\(\);\s*\n\s*await loadMyProjects\(\);/);
  });

  test('평가 항목이 표의 컬럼과 맞는다', () => {
    const insert = MYPAGE.slice(MYPAGE.indexOf('const row = {'), MYPAGE.indexOf("from('design_feedback').insert"));
    ['design_id', 'user_id', 'feedback_type', 'accuracy_score', 'usability_score', 'was_modified', 'modification_reason', 'feedback_text', 'post_id'].forEach(
      (col) => expect(insert).toContain(col + ':')
    );
  });

  test('feedback_type 값이 CHECK 안에 있다', () => {
    const allowed = SCHEMA.match(/feedback_type TEXT CHECK \(feedback_type IN \(([^)]*)\)\)/)[1]
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''));
    const options = [...MYPAGE.matchAll(/<option value="(completion|praise|complaint|revision)"/g)].map((m) => m[1]);
    expect(options.length).toBeGreaterThan(0);
    options.forEach((v) => expect(allowed).toContain(v));
  });

  test('점수는 1~5 — 표의 CHECK 와 같은 범위', () => {
    expect(SCHEMA).toMatch(/accuracy_score INT CHECK \(accuracy_score BETWEEN 1 AND 5\)/);
    expect(MYPAGE).toMatch(/id="fbAccuracy" min="1" max="5"/);
    expect(MYPAGE).toMatch(/id="fbUsability" min="1" max="5"/);
  });

  test('본인 이름으로 남긴다 — RLS 가 그것만 받는다', () => {
    expect(MYPAGE).toMatch(/user_id: currentUser\.id/);
  });

  test('수정 사유는 고쳤다고 했을 때만 보낸다', () => {
    expect(MYPAGE).toMatch(/modification_reason: modified \? document\.getElementById\('fbReason'\)/);
  });
});
