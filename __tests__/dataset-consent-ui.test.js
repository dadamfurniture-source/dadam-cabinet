/**
 * @jest-environment node
 *
 * 학습 사용 동의 — 받는 곳(업로드)과 바꾸는 곳(목록)이 둘 다 있어야 한다.
 *
 * 왜 테스트하나: 동의가 없으면 수집 워커가 한 건도 넣지 않는다(설계 의도). 그래서
 * 체크박스 하나가 빠지면 파이프라인 전체가 조용히 0건이 된다 — 에러도 안 난다.
 * 그 침묵을 여기서 막는다.
 */

const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const MYPAGE = read('mypage.html');
const DESIGNS = read('my-designs.html');
const SQL = read('database/dataset-schema.sql');

describe('시공사례 업로드 (mypage.html)', () => {
  test('업로드 폼에 동의 체크박스가 있다', () => {
    expect(MYPAGE).toMatch(/id="caseConsent"/);
    expect(MYPAGE).toMatch(/type="checkbox"/);
  });

  test('체크 상태를 consent_training 으로 저장한다', () => {
    const insert = MYPAGE.slice(MYPAGE.indexOf("from('collection_posts').insert("));
    expect(insert.slice(0, 700)).toMatch(/consent_training:\s*document\.getElementById\('caseConsent'\)\.checked/);
  });

  test('기본값은 해제 — checked 를 미리 박아두지 않는다', () => {
    const el = MYPAGE.match(/<input[^>]*id="caseConsent"[^>]*>/)[0];
    expect(el).not.toMatch(/\bchecked\b/);
  });

  test('목록에서 동의 상태를 읽고 바꾼다', () => {
    expect(MYPAGE).toMatch(/\.select\('id, image_url, storage_path, region, created_at, consent_training'\)/);
    expect(MYPAGE).toMatch(/from\('collection_posts'\)\s*\n?\s*\.update\(\{ consent_training: next \}\)/);
    expect(MYPAGE).toMatch(/function toggleCaseConsent/);
  });
});

describe('연출컷 (my-designs.html)', () => {
  test('카드에 동의 토글이 있고 동작이 연결돼 있다', () => {
    expect(DESIGNS).toMatch(/data-act="consent"/);
    expect(DESIGNS).toMatch(/act === 'consent'\) toggleConsent/);
  });

  test('generations.consent_training 을 읽고 쓴다', () => {
    expect(DESIGNS).toMatch(/is_favorite,consent_training,/);
    expect(DESIGNS).toMatch(/from\('generations'\)\.update\(\{ consent_training: next \}\)/);
  });

  test('true 일 때만 켜진 것으로 본다 — NULL 을 동의로 읽으면 안 된다', () => {
    expect(DESIGNS).toMatch(/r\.consent_training === true/);
    expect(DESIGNS).not.toMatch(/if \(r\.consent_training\)\s*\{/);
  });
});

describe('스키마', () => {
  test('collection_posts 에 updated_at 자동 갱신이 붙는다', () => {
    // 없으면 동의를 켜도 updated_at 이 그대로라 워터마크가 영영 그 행을 못 본다
    expect(SQL).toMatch(/CREATE TRIGGER trg_collection_posts_updated_at/);
    expect(SQL).toMatch(/BEFORE UPDATE ON collection_posts/);
  });

  test('동의 컬럼은 NULL 을 허용한다 — 아직 묻지 않은 옛 글', () => {
    expect(SQL).toMatch(/ALTER TABLE collection_posts ADD COLUMN IF NOT EXISTS consent_training BOOLEAN;/);
    expect(SQL).toMatch(/ALTER TABLE generations\s+ADD COLUMN IF NOT EXISTS consent_training BOOLEAN;/);
  });
});

describe('수집 워커가 동의를 실제로 본다', () => {
  const INGEST = read('workers/dataset-api/src/ingest.js');

  test('true 인 행만 넣는다', () => {
    expect(INGEST).toMatch(/consent_training === true/);
  });

  test('동의를 내린 행은 이미 넣은 샘플을 지운다', () => {
    expect(INGEST).toMatch(/consent_training !== true/);
    expect(INGEST).toMatch(/remove\(env, `dataset_samples\?src_table=eq\.\$\{table\}&src_id=eq\.\$\{r\.id\}`\)/);
  });
});
