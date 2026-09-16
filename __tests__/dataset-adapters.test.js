/**
 * @jest-environment node
 *
 * 다담 DB 행 → dataset_samples 계약 (workers/dataset-api/src/adapters.js).
 *
 * 고정하는 것:
 *   1) 어댑터가 낼 수 있는 축 값은 전부 SQL 의 CHECK 안에 있다 — 여기가 어긋나면
 *      워커가 조용히 실패하는 게 아니라 수집이 통째로 멈춘다
 *   2) 생성물은 media='generated' 로 격리, 고객 현장 사진은 user-uploaded + needs_review
 *   3) group_key: 설계가 있으면 설계 단위, 연출컷은 재생성 계보의 뿌리 단위
 *   4) 동의(consent_training)는 그대로 옮긴다 — 워커가 동의 없는 행을 거르지만
 *      값 자체도 남아야 나중에 "왜 빠졌나" 를 설명할 수 있다
 *
 * ESM 을 jest(CJS) 에서 읽기 위해 export 를 떼고 평가한다 (generate-layout.test.js 방식).
 */

const fs = require('fs');
const path = require('path');

function loadEsm(rel, names) {
  const src = fs
    .readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/^export /gm, '');
  return new Function(src + `\nreturn { ${names.join(', ')} };`)();
}

const A = loadEsm('workers/dataset-api/src/adapters.js', [
  'TAXONOMY_VERSION',
  'COLLECTION_CATEGORY',
  'GENERATION_CATEGORY',
  'LAYOUT_SHAPES',
  'fromCollectionPost',
  'fromGeneration',
  'rootOf',
]);

const SQL = fs.readFileSync(path.join(__dirname, '..', 'database', 'dataset-schema.sql'), 'utf8');

/** dataset_samples 의 `col … CHECK (col IN (...))` 값 목록 */
function allowed(col) {
  const m = SQL.match(new RegExp(`\\b${col}\\s+TEXT[^;]*?CHECK\\s*\\(\\s*${col}\\s+IN\\s*\\(([^)]*)\\)`, 's'));
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
}

const POST = {
  id: '11111111-1111-1111-1111-111111111111',
  image_url: 'https://cdn/x.jpg',
  storage_path: 'collection/x.jpg',
  title: '수성구 34평',
  description: 'ㄷ자 주방',
  category: 'kitchen',
  region: '대구 수성구',
  design_id: null,
  item_unique_id: null,
  consent_training: true,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-02T00:00:00Z',
};

const GEN = {
  id: '22222222-2222-2222-2222-222222222222',
  parent_id: null,
  category: 'sink',
  options: { design_style: 'modern' },
  inputs: { room: { url: 'https://cdn/room.jpg', path: 'uploads/room.jpg' } },
  images: [
    { slot: 'base', url: 'https://cdn/base.png', finish_key: 'W01' },
    { slot: 'v1', url: 'https://cdn/v1.png' },
  ],
  layout: { lowerLayoutShape: 'U' },
  consent_training: true,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-03T00:00:00Z',
};

describe('어댑터가 내는 축 값은 전부 SQL 이 받는다', () => {
  const samples = [
    ...Object.keys(A.COLLECTION_CATEGORY).map((c) => A.fromCollectionPost({ ...POST, category: c })),
    ...Object.keys(A.GENERATION_CATEGORY).flatMap((c) => A.fromGeneration({ ...GEN, category: c }, GEN.id)),
    ...A.fromGeneration({ ...GEN, category: '없는품목', layout: null, options: {} }, GEN.id),
  ];

  test.each(['media', 'phase', 'space', 'furniture', 'layout_shape', 'label_source', 'license', 'source'])(
    '%s',
    (col) => {
      const ok = allowed(col);
      samples.forEach((s) => expect(ok).toContain(s[col]));
    }
  );

  test('layout_shape 후보가 SQL 과 같다', () => {
    expect(A.LAYOUT_SHAPES).toEqual(allowed('layout_shape'));
  });

  test('sample_id 는 비지 않고 서로 다르다', () => {
    const ids = samples.map((s) => s.sample_id);
    expect(ids.every(Boolean)).toBe(true);
    // 같은 행을 여러 품목으로 돌린 것이라 중복이 있다 — 한 행 안에서만 유일하면 된다
    const one = A.fromGeneration(GEN, GEN.id).map((s) => s.sample_id);
    expect(new Set(one).size).toBe(one.length);
  });
});

describe('시공사례', () => {
  test('주방은 공간이 확정이라 검수가 필요 없다', () => {
    const s = A.fromCollectionPost(POST);
    expect(s).toMatchObject({
      sample_id: `dadam:post:${POST.id}`,
      source: 'dadam_collection',
      group_key: `dadam:post:${POST.id}`,
      media: 'photo',
      phase: 'after',
      space: 'kitchen',
      furniture: 'sink',
      label_source: 'structured',
      license: 'owned',
      needs_review: false,
      consent: true,
      src_table: 'collection_posts',
      src_id: POST.id,
      src_updated_at: POST.updated_at,
      taxonomy_version: A.TAXONOMY_VERSION,
    });
  });

  test('붙박이장·수납장은 공간을 모른다 — 지어내지 않고 검수로 보낸다', () => {
    ['builtin', 'storage', 'interior', 'other'].forEach((category) => {
      const s = A.fromCollectionPost({ ...POST, category });
      expect(s.space).toBe('unknown');
      expect(s.needs_review).toBe(true);
    });
    expect(A.fromCollectionPost({ ...POST, category: 'builtin' }).furniture).toBe('builtin');
  });

  test('설계가 연결돼 있으면 그룹은 설계 단위 — 같은 집 사진이 train/test 로 갈리면 안 된다', () => {
    const design_id = '33333333-3333-3333-3333-333333333333';
    expect(A.fromCollectionPost({ ...POST, design_id }).group_key).toBe(`dadam:design:${design_id}`);
  });

  test('모르는 category 도 터지지 않는다', () => {
    const s = A.fromCollectionPost({ ...POST, category: 'zzz' });
    expect(s.space).toBe('unknown');
    expect(s.attrs.raw_label).toBe('zzz');
  });

  test('동의 값을 그대로 옮긴다', () => {
    expect(A.fromCollectionPost({ ...POST, consent_training: false }).consent).toBe(false);
    expect(A.fromCollectionPost({ ...POST, consent_training: undefined }).consent).toBeNull();
  });
});

describe('연출컷', () => {
  const out = A.fromGeneration(GEN, GEN.id);

  test('생성 이미지는 media=generated 로 격리한다', () => {
    const gen = out.filter((s) => s.media === 'generated');
    expect(gen).toHaveLength(2);
    expect(gen.map((s) => s.sample_id)).toEqual([`dadam:gen:${GEN.id}:base`, `dadam:gen:${GEN.id}:v1`]);
    expect(gen[0]).toMatchObject({ space: 'kitchen', furniture: 'sink', layout_shape: 'U', needs_review: false, license: 'owned' });
  });

  test('고객이 올린 현장 사진은 시공 전 · user-uploaded · 검수 필수', () => {
    const room = out.find((s) => s.sample_id.endsWith(':room'));
    expect(room).toMatchObject({
      media: 'photo',
      phase: 'before',
      furniture: 'none',
      license: 'user-uploaded',
      needs_review: true,
    });
  });

  test('축 밖의 배치 값은 unknown 으로 떨어진다', () => {
    const s = A.fromGeneration({ ...GEN, layout: { lowerLayoutShape: 'ㄷ자' } }, GEN.id)[0];
    expect(s.layout_shape).toBe('unknown');
  });

  test('아일랜드 품목은 배치가 정해진다', () => {
    const s = A.fromGeneration({ ...GEN, category: 'island', layout: null, options: {} }, GEN.id)[0];
    expect(s.layout_shape).toBe('island');
  });

  test('url 없는 이미지는 버린다', () => {
    const s = A.fromGeneration({ ...GEN, images: [{ slot: 'base' }, null], inputs: {} }, GEN.id);
    expect(s).toHaveLength(0);
  });

  test('재생성 계보는 한 그룹 — 뿌리 id 로 묶는다', () => {
    const child = A.fromGeneration({ ...GEN, id: '44444444-4444-4444-4444-444444444444', parent_id: GEN.id }, GEN.id);
    expect(child.every((s) => s.group_key === `dadam:gen:${GEN.id}`)).toBe(true);
  });
});

describe('rootOf', () => {
  test('부모를 타고 올라가 뿌리를 찾는다', () => {
    const parentOf = new Map([['c', 'b'], ['b', 'a'], ['a', null]]);
    expect(A.rootOf('c', parentOf)).toBe('a');
    expect(A.rootOf('a', parentOf)).toBe('a');
  });

  test('모르는 부모에서 멈춘다 (배치 밖이면 그 지점이 뿌리)', () => {
    expect(A.rootOf('x', new Map([['x', null]]))).toBe('x');
  });

  test('순환이 있어도 10 홉에서 끊는다', () => {
    const cyc = new Map([['a', 'b'], ['b', 'a']]);
    expect(['a', 'b']).toContain(A.rootOf('a', cyc));
  });
});
