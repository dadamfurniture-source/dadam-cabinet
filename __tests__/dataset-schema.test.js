/**
 * 학습 데이터셋 스키마 — database/dataset-schema.sql 이 라벨 체계 v1 과 어긋나지 않게.
 *
 * 축 값은 taxonomy v1 (ohouse-crawl/taxonomy.json, 리포 밖) 과 같아야 한다.
 * 리포가 PUBLIC 이라 taxonomy 파일을 여기 두지 않으므로, 값 목록을 여기 한 번 더 적어
 * SQL 이 그것과 같은지 본다. 값을 **더할** 때는 두 곳을 같이 고친다 — 이름을 바꾸지는 않는다.
 */
const fs = require('fs');
const path = require('path');

const SQL = fs.readFileSync(path.join(__dirname, '..', 'database', 'dataset-schema.sql'), 'utf8');

const AXES = {
  media: ['photo', 'render3d', 'floorplan', 'generated'],
  phase: ['before', 'after', 'in_progress', 'unknown'],
  space: ['kitchen', 'living', 'bedroom', 'bathroom', 'entrance', 'balcony', 'dressing', 'utility', 'corridor', 'study', 'unknown'],
  furniture: ['sink', 'builtin', 'fridge', 'storage', 'none', 'unknown'],
  layout_shape: ['I', 'L', 'U', 'island', 'unknown'],
};

/** `col TEXT … CHECK (col IN ('a', 'b'))` 에서 값 목록을 뽑는다. 첫 번째(dataset_samples) 정의. */
function checkValues(col) {
  const re = new RegExp(`\\b${col}\\s+TEXT[^;]*?CHECK\\s*\\(\\s*${col}\\s+IN\\s*\\(([^)]*)\\)`, 's');
  const m = SQL.match(re);
  if (!m) return null;
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
}

describe('라벨 축 다섯이 taxonomy v1 과 같다', () => {
  Object.entries(AXES).forEach(([col, values]) => {
    test(`${col} — ${values.length}개 값`, () => {
      expect(checkValues(col)).toEqual(values);
    });
  });

  test('dataset_reviews 의 축 값도 같다 — 검수가 축 밖 값을 쓰면 트리거가 그대로 흘려보낸다', () => {
    const reviews = SQL.slice(SQL.indexOf('CREATE TABLE IF NOT EXISTS dataset_reviews'));
    Object.entries(AXES).forEach(([col, values]) => {
      const m = reviews.match(new RegExp(`${col}\\s+IN\\s*\\(([^)]*)\\)`));
      expect(m).not.toBeNull();
      expect(m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''))).toEqual(values);
    });
  });
});

describe('출처 · 라이선스 · 라벨 출처', () => {
  test('source 값', () => {
    expect(checkValues('source')).toEqual(['dadam_collection', 'dadam_generation', 'dadam_planner', 'dadam_design', 'ohouse']);
  });
  test('license 값', () => {
    expect(checkValues('license')).toEqual(['owned', 'user-uploaded', 'restricted-internal', 'cc0']);
  });
  test('label_source 값 — 평가셋은 human 만', () => {
    expect(checkValues('label_source')).toEqual(['caption', 'structured', 'model', 'human']);
  });
});

describe('동의 없는 고객 사진은 내보내지 않는다 — 설정이 아니라 쿼리다', () => {
  const view = SQL.slice(SQL.indexOf('CREATE OR REPLACE VIEW dataset_exportable'));
  test('뷰가 있다', () => { expect(view.length).toBeGreaterThan(50); });
  test('검수 전 · 거부된 것은 뺀다', () => {
    expect(view).toContain('needs_review = FALSE');
    expect(view).toMatch(/rejected/);
  });
  test('생성물은 실사와 섞지 않는다', () => {
    expect(view).toContain("media <> 'generated'");
  });
  test('user-uploaded 는 동의 + 사람 검수', () => {
    expect(view).toMatch(/license <> 'user-uploaded' OR \(consent = TRUE AND label_source = 'human'\)/);
  });
});

describe('기존 표에 붙는 컬럼 — 추가만, 기본 NULL', () => {
  test('시공사례 ↔ 설계 연결', () => {
    expect(SQL).toMatch(/ALTER TABLE collection_posts ADD COLUMN IF NOT EXISTS design_id UUID REFERENCES designs\(id\)/);
    expect(SQL).toMatch(/ALTER TABLE collection_posts ADD COLUMN IF NOT EXISTS item_unique_id BIGINT/);
  });
  test('학습 동의 — 두 표 모두', () => {
    expect(SQL).toMatch(/ALTER TABLE collection_posts ADD COLUMN IF NOT EXISTS consent_training BOOLEAN/);
    expect(SQL).toMatch(/ALTER TABLE generations\s+ADD COLUMN IF NOT EXISTS consent_training BOOLEAN/);
  });
  test('NOT NULL 이나 DEFAULT 로 기존 행을 건드리지 않는다', () => {
    const alters = SQL.match(/ALTER TABLE \w+\s+ADD COLUMN IF NOT EXISTS[^;]*;/g) || [];
    expect(alters.length).toBe(4);
    alters.forEach((a) => { expect(a).not.toMatch(/NOT NULL|DEFAULT/); });
  });
});

describe('검수는 덮어쓰지 않는다', () => {
  const fn = SQL.slice(SQL.indexOf('FUNCTION public.apply_dataset_review'), SQL.indexOf('DROP TRIGGER IF EXISTS on_dataset_review_insert'));
  test('원래 라벨을 attrs.original 에 한 번만 보관한다', () => {
    expect(fn).toMatch(/WHEN s\.attrs \? 'original' THEN s\.attrs/);
    expect(fn).toContain("'original', jsonb_build_object(");
  });
  test('확정되면 human · needs_review 해제', () => {
    expect(fn).toContain("label_source = 'human'");
    expect(fn).toContain('needs_review = FALSE');
  });
  test('reject 는 행을 지우지 않고 표시만 한다', () => {
    expect(fn).toContain("'rejected', TRUE");
    expect(fn).not.toMatch(/DELETE FROM dataset_samples/);
  });
  test('검수 행은 지울 수 없다 — DELETE 정책이 없다', () => {
    const rls = SQL.slice(SQL.indexOf('ALTER TABLE dataset_reviews ENABLE ROW LEVEL SECURITY'));
    expect(rls).not.toMatch(/ON dataset_reviews\s+FOR DELETE/);
    expect(rls).not.toMatch(/ON dataset_reviews\s+FOR ALL/);
  });
});

describe('두 번 돌려도 안전하다', () => {
  test('표 · 인덱스는 IF NOT EXISTS', () => {
    (SQL.match(/CREATE (TABLE|INDEX)\b[^;]*/g) || []).forEach((s) => expect(s).toContain('IF NOT EXISTS'));
  });
  test('정책 · 트리거는 DROP IF EXISTS 뒤에 CREATE', () => {
    const policies = SQL.match(/CREATE POLICY "([^"]+)"/g) || [];
    expect(policies.length).toBeGreaterThan(0);
    policies.forEach((p) => {
      const name = p.match(/"([^"]+)"/)[1];
      expect(SQL).toContain(`DROP POLICY IF EXISTS "${name}"`);
    });
    (SQL.match(/CREATE TRIGGER (\w+)/g) || []).forEach((t) => {
      expect(SQL).toContain(`DROP TRIGGER IF EXISTS ${t.split(' ')[2]}`);
    });
  });
  test('파괴적 문장이 없다', () => {
    expect(SQL).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/);
  });
});
