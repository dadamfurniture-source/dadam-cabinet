/**
 * @jest-environment node
 *
 * 학습 데이터 사슬 — 예상 AI 이미지 → 도면 → 완성 사진 → 피드백.
 *
 * 고정하는 것 넷:
 *   1) 사슬의 등뼈는 design_id 다. 연출컷도 설계가 붙으면 그 그룹으로 간다 —
 *      같은 현장 사진이 train/test 로 갈리면 평가가 거짓말을 한다
 *   2) **시공이 끝난 것만** 내보낸다. 판정은 orders.status='completed' 이고,
 *      "사진이 올라왔다" 는 근거가 아니다
 *   3) 연결이 없으면 내보내지 않는다 (design_id NULL → EXISTS 가 거짓)
 *   4) 뷰는 security_invoker 로 돈다 — 기본값이면 로그인한 누구나 전 샘플을 읽는다
 */

const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const SQL = read('database/dataset-chain.sql');
const MYPAGE = read('mypage.html');
const PERSIST = read('js/detaildesign/persistence-init.js');
const INGEST = read('workers/dataset-api/src/ingest.js');

function loadEsm(rel, names) {
  const src = fs
    .readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/^export /gm, '');
  return new Function(src + `\nreturn { ${names.join(', ')} };`)();
}
const A = loadEsm('workers/dataset-api/src/adapters.js', ['fromCollectionPost', 'fromGeneration']);

const DESIGN = '33333333-3333-3333-3333-333333333333';
const POST = {
  id: '11111111-1111-1111-1111-111111111111',
  image_url: 'https://cdn/x.jpg',
  category: 'kitchen',
  consent_training: true,
  updated_at: '2026-09-02T00:00:00Z',
};
const GEN = {
  id: '22222222-2222-2222-2222-222222222222',
  category: 'sink',
  images: [{ slot: 'base', url: 'https://cdn/base.png' }],
  inputs: {},
  consent_training: true,
  updated_at: '2026-09-03T00:00:00Z',
};

describe('사슬의 등뼈는 design_id', () => {
  test('시공사례: 설계가 붙으면 design_id 와 그룹이 설계 단위다', () => {
    const s = A.fromCollectionPost({ ...POST, design_id: DESIGN });
    expect(s.design_id).toBe(DESIGN);
    expect(s.group_key).toBe(`dadam:design:${DESIGN}`);
  });

  test('연출컷: 설계가 붙으면 그룹이 gen 이 아니라 설계다', () => {
    const [s] = A.fromGeneration(GEN, GEN.id, DESIGN);
    expect(s.design_id).toBe(DESIGN);
    expect(s.group_key).toBe(`dadam:design:${DESIGN}`);
  });

  test('연출컷과 완성 사진이 같은 그룹으로 모인다 — 이게 학습 단위다', () => {
    const photo = A.fromCollectionPost({ ...POST, design_id: DESIGN });
    const [shot] = A.fromGeneration(GEN, GEN.id, DESIGN);
    expect(shot.group_key).toBe(photo.group_key);
  });

  test('설계가 없으면 예전대로 — 억지로 묶지 않는다', () => {
    expect(A.fromCollectionPost(POST).group_key).toBe(`dadam:post:${POST.id}`);
    expect(A.fromGeneration(GEN, GEN.id, null)[0].group_key).toBe(`dadam:gen:${GEN.id}`);
    expect(A.fromGeneration(GEN, GEN.id, null)[0].design_id).toBeNull();
  });
});

describe('시공 완료만 내보낸다', () => {
  const view = SQL.slice(SQL.indexOf('CREATE OR REPLACE VIEW dataset_exportable'), SQL.indexOf('CREATE OR REPLACE VIEW dataset_chains'));

  test('판정은 orders.status = completed 다', () => {
    expect(view).toMatch(/FROM orders o/);
    expect(view).toMatch(/o\.status = 'completed'/);
    expect(view).toMatch(/o\.design_id = dataset_samples\.design_id/);
  });

  test('다담 출처 넷 모두 완료를 따진다', () => {
    ['dadam_collection', 'dadam_generation', 'dadam_planner', 'dadam_design'].forEach((s) => {
      expect(view).toContain(`'${s}'`);
    });
  });

  test('기존 조건(검수·거절·생성물·동의)은 그대로다', () => {
    expect(view).toMatch(/needs_review = FALSE/);
    expect(view).toMatch(/'rejected'/);
    expect(view).toMatch(/media <> 'generated'/);
    expect(view).toMatch(/consent = TRUE AND label_source = 'human'/);
  });

  test('뷰 둘 다 security_invoker — 기본값이면 RLS 를 지나쳐 전 샘플이 샌다', () => {
    expect(SQL.match(/WITH \(security_invoker = on\)/g) || []).toHaveLength(2);
  });
});

describe('dataset_chains — 완료된 현장 하나가 한 줄', () => {
  const view = SQL.slice(SQL.indexOf('CREATE OR REPLACE VIEW dataset_chains'));

  test('사슬 네 칸을 모두 센다', () => {
    expect(view).toMatch(/generated_n/);      // ① 예상 AI 이미지
    expect(view).toMatch(/before_n/);         // 고객 현장 사진
    expect(view).toMatch(/finished_n/);       // ③ 완성 사진
    expect(view).toMatch(/design_feedback/);  // ④ 피드백
  });

  test('완료된 수주만 줄이 된다', () => {
    expect(view).toMatch(/WHERE o\.status = 'completed'/);
  });

  test('샘플이 없는 현장도 줄은 나온다 — count(*) 가 아니라 count(sample_id)', () => {
    expect(view).toMatch(/LEFT JOIN dataset_samples/);
    expect(view).not.toMatch(/count\(\*\) FILTER/);
  });
});

describe('연결을 만드는 화면·코드', () => {
  test('설계 저장이 출처 연출컷을 기록한다', () => {
    expect(PERSIST).toMatch(/function sourceGenerationId/);
    expect(PERSIST).toMatch(/generation_id: sourceGenerationId\(\)/);
  });

  test('시공사례 업로드에서 설계를 고른다', () => {
    expect(MYPAGE).toMatch(/id="caseDesign"/);
    expect(MYPAGE).toMatch(/design_id: document\.getElementById\('caseDesign'\)\.value \|\| null/);
    expect(MYPAGE).toMatch(/function loadCaseDesigns/);
  });

  test('완료된 설계를 목록 위로 올려 보여준다', () => {
    expect(MYPAGE).toMatch(/\.eq\('status', 'completed'\)/);
    expect(MYPAGE).toMatch(/시공 완료/);
  });

  test('먼저 붙은 설계를 그대로 둔다 — group_key 가 실행마다 뒤집히면 분할이 흔들린다', () => {
    // 한 연출컷으로 설계를 두 번 만들 수 있다. 수집 경로는 먼저 만든 설계를 쓰므로
    // backfill 도 빈 칸만 채워야 둘이 어긋나지 않는다.
    expect(INGEST).toMatch(/&design_id=is\.null/);
  });

  test('뒤늦게 붙은 연결도 기존 샘플에 내려간다', () => {
    // 연출컷을 먼저 수집한 뒤 설계를 만들면 generations.updated_at 은 그대로다
    expect(INGEST).toMatch(/function backfillDesignLinks/);
    expect(INGEST).toMatch(/dataset_samples\?src_table=eq\.generations&src_id=eq\.\$\{d\.generation_id\}/);
    expect(INGEST).toMatch(/order=created_at\.asc/);   // 수집 경로도 먼저 만든 설계를 고른다
    expect(INGEST).toMatch(/group_key: `dadam:design:\$\{d\.id\}`/);
  });
});

describe('스키마 이주는 재실행 안전', () => {
  test('컬럼·인덱스는 IF NOT EXISTS', () => {
    expect(SQL).toMatch(/ALTER TABLE designs ADD COLUMN IF NOT EXISTS generation_id/);
    expect(SQL).toMatch(/ALTER TABLE dataset_samples ADD COLUMN IF NOT EXISTS design_id/);
    expect((SQL.match(/CREATE INDEX IF NOT EXISTS/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test('파괴적 문장이 없다', () => {
    expect(SQL).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/);
  });
});
